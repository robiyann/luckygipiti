const TelegramBot = require('node-telegram-bot-api');
const chalk = require('chalk');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const workerPool = require('./workerPool');
const logger = require('./utils/logger');
const { isValidPassword } = require('./utils/passwordGenerator');

// Folder khusus untuk menyimpan file report agar tidak hilang
const REPORTS_DIR = path.join(process.cwd(), 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Batch progress file helpers — persist ke disk agar tidak hilang saat crash
function getBatchProgressPath(chatId) {
    return path.join(REPORTS_DIR, `batch_progress_${chatId}.json`);
}
function saveBatchProgress(chatId, results) {
    try {
        fs.writeFileSync(getBatchProgressPath(chatId), JSON.stringify(results, null, 2), 'utf8');
    } catch (e) {
        logger.error(`[Batch] Gagal simpan progress batch ${chatId}: ${e.message}`);
    }
}
function loadBatchProgress(chatId) {
    const filePath = getBatchProgressPath(chatId);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) { return []; }
    }
    return [];
}
function clearBatchProgress(chatId) {
    const filePath = getBatchProgressPath(chatId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

const asyncLocalStorage = new AsyncLocalStorage();

let bot = null;
let restartCallback = null;

// User state mapping (prompt resolutions, status msg ids, etc)
const userStates = new Map();

function getUserState(chatId) {
    chatId = chatId.toString();
    if (!userStates.has(chatId)) {
        userStates.set(chatId, {
            activePromptResolve: null,
            lastPromptMessageId: null,
            lastStatusMessageId: null,
            dashboardObscured: false,
            messageQueue: [],
            isQueueProcessing: false,
            currentTaskInfo: null,
            batchResults: [], 
            batchTarget: 0,          // Target akun PLUS yang harus berhasil
            batchPlusCount: 0,       // Akun Plus yang sudah berhasil
            batchTotalDispatched: 0, // Total task yang sudah dikirim ke antrian
            isBatchMode: false,
            setupStep: null 
        });
    }
    return userStates.get(chatId);
}

function stopTelegram() {
    if (bot) {
        bot.stopPolling();
        bot = null;
    }
}

function internalReset() {
    console.log(chalk.yellow("[System] Me-refresh state bot..."));
    if (restartCallback) {
        restartCallback();
    } else {
        process.exit(0);
    }
}

function setRestartCallback(fn) {
    restartCallback = fn;
}

// Semua teks tombol keyboard utama — jangan dianggap sebagai input user ketika ada prompt aktif
const MENU_COMMANDS = new Set([
    '/start', 'menu', 'p',
    '🤖 Auto Daftar (LuckMail)',
    '📬 Auto Daftar (T-Mail)',
    '✨ Daftar Akun Baru',
    '🔑 Login Akun',
    '⚙️ Edit Data Saya',
    '📊 Status Server',
    '❓ Bantuan'
]);

const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            ['🤖 Auto Daftar (LuckMail)'],
            ['📬 Auto Daftar (T-Mail)'],
            ['✨ Daftar Akun Baru', '🔑 Login Akun'],
            ['⚙️ Edit Data Saya', '📊 Status Server'],
            ['❓ Bantuan']
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

async function notifyAdminApprovalReq(userId, firstName, username) {
    const adminIds = (process.env.ADMIN_ID || "").split(',').map(id => id.trim()).filter(id => id);
    for (const adminId of adminIds) {
        if (!adminId) continue;
        const msg = `🚨 <b>PERMINTAAN IZIN BARU</b> 🚨\n\nUser ID: <code>${userId}</code>\nName: ${firstName}\nUsername: ${username ? '@'+username : 'none'}\n\nMohon persetujuannya:`;
        try {
            await bot.sendMessage(adminId, msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Approve", callback_data: `admin_approve_${userId}` },
                            { text: "❌ Reject", callback_data: `admin_reject_${userId}` }
                        ]
                    ]
                }
            });
        } catch (e) {
            console.log(chalk.yellow(`[Bot] Gagal notifikasi admin ${adminId}: ${e.message}`));
        }
    }
}

function validateEmail(email) {
    return String(email)
        .toLowerCase()
        .match(
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
        );
}

function getSystemDashboardText() {
    const slots = workerPool.getActiveStatus();
    const queueLen = workerPool.getQueuePosition ? 0 : 0; // placeholder
    let text = `🖥️ <b>SERVER STATUS DASHBOARD</b>\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `🟢 Active Slots: ${slots.length} / ${process.env.MAX_THREADS || 5}\n\n`;
    
    if (slots.length === 0) {
        text += `<i>Server is fully available.</i>\n`;
    } else {
        slots.forEach((s, idx) => {
            const mMap = {
                'login_autopay': 'LOGIN+PAY', 'auto_loginpay': 'AUTO LOGIN+PAY',
                'autopay': 'SIGNUP+PAY', 'auto_autopay': 'AUTO SIGNUP+PAY',
                'auto_signup': 'AUTO SIGNUP', 'signup': 'SIGNUP ONLY'
            };
            const modeName = mMap[s.mode] || s.mode.toUpperCase();
            const runTime = Math.floor((Date.now() - s.startTime) / 1000);
            text += `[${idx+1}] 👤 User ${s.userId.substring(0,4)}... | <code>${s.email || 'AUTO'}</code>\n`;
            text += `      💎 ${modeName} | ⏱️ ${runTime}s\n`;
        });
    }
    
    text += `━━━━━━━━━━━━━━━━━━\n<i>Updated: ${new Date().toLocaleTimeString()}</i>`;
    return text;
}

function initTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        console.log(chalk.yellow("[Bot] Token tidak ditemukan di .env (TELEGRAM_BOT_TOKEN)"));
        return;
    }

    if (bot) {
        console.log(chalk.cyan("[Bot] Re-using existing connection..."));
        return;
    }

    try {
        bot = new TelegramBot(token, { polling: true });
        console.log(chalk.green("[Bot] Engine aktif! Bot siap menerima koneksi multi-user."));

        const startTime = Math.floor(Date.now() / 1000);

        bot.on('polling_error', (error) => {
            if (error.code === 'EFATAL' || error.message.includes('ENOTFOUND')) {
                console.log(chalk.red("[Bot] Koneksi terputus, mencoba bertahan..."));
            } else {
                console.log(chalk.yellow(`[Bot] Peringatan koneksi: ${error.message}`));
            }
        });

        bot.on('message', async (msg) => {
            if (msg.date < startTime) return;

            const chatId = msg.chat.id.toString();
            const text = msg.text ? msg.text.trim() : "";
            
            console.log(chalk.gray(`[Bot] Pesan dari ${chatId}: "${text}"`));
            
            const state = getUserState(chatId);
            state.dashboardObscured = true;

            // --- 0. Admin Flow (Approval / Reject) handled in callback_query, but check basic admin status
            
            // --- 1. User Database Guard
            if (!db.hasUser(chatId)) {
                if (text === '/start') {
                    db.saveUser(chatId, {
                        status: 'pending',
                        firstName: msg.from.first_name || 'User',
                        registeredAt: new Date().toISOString()
                    });
                    bot.sendMessage(chatId, "👋 <b>Selamat Datang di GPT Creator!</b>\n\nSistem kami bersifat private public.\nPermintaan akses telah dikirimkan ke Admin. Harap tunggu persetujuan sebelum menggunakan layanan ini.", { parse_mode: 'HTML' });
                    await notifyAdminApprovalReq(chatId, msg.from.first_name, msg.from.username);
                } else {
                    bot.sendMessage(chatId, "⚠️ <b>Akses Ditolak</b>\nKirimkan /start terlebih dahulu untuk mendaftar.", { parse_mode: 'HTML' });
                }
                return;
            }

            const userData = db.getUser(chatId);

            if (userData.status === 'pending') {
                bot.sendMessage(chatId, "⏳ <b>Akun Pending</b>\nPermintaan Akses Anda masih menunggu persetujuan Admin.", { parse_mode: 'HTML' });
                return;
            }

            if (userData.status === 'rejected') {
                bot.sendMessage(chatId, "❌ <b>Akses Ditolak</b>\nAdmin menolak permintaan Anda.", { parse_mode: 'HTML' });
                return;
            }

            // User Approved 
            
            // Resolving Prompt manually triggered setup steps
            // Pastikan tombol menu utama TIDAK ikut me-resolve prompt yang sedang menunggu input.
            if (state.activePromptResolve && !MENU_COMMANDS.has(text)) {
                const resolve = state.activePromptResolve;
                state.activePromptResolve = null;
                
                const userMsgId = msg.message_id;
                
                bot.sendMessage(chatId, `✨ <b>Input Diterima:</b> <code>${text}</code>`, { parse_mode: "HTML" }).then(sentMsg => {
                    setTimeout(() => {
                        if (state.lastPromptMessageId) bot.deleteMessage(chatId, state.lastPromptMessageId).catch(() => {});
                        bot.deleteMessage(chatId, userMsgId).catch(() => {});
                        bot.deleteMessage(chatId, sentMsg.message_id).catch(() => {});
                        state.dashboardObscured = true;
                    }, 3000);
                }).catch(() => {});

                resolve(text);
                return;
            }
            
            // Jika ada prompt aktif dan user menekan tombol menu, abaikan (jangan ganggu proses)
            if (state.activePromptResolve && MENU_COMMANDS.has(text)) {
                // Kirim peringatan halus agar user tahu ada proses aktif
                bot.sendMessage(chatId, "⚠️ <b>Ada proses yang sedang menunggu input Anda.</b>\n<i>Balas pertanyaan di atas, atau klik 🛑 Batalkan Sesi untuk membatalkan.</i>", { parse_mode: 'HTML' }).catch(() => {});
                return;
            }

            // If user explicitly asks to setup/edit
            if (text === '⚙️ Edit Data Saya') {
                sendSettingsMenu(chatId, userData);
                return;
            }

            // Commands and Menu Actions
            if (text === '/start' || text.toLowerCase() === 'menu' || text === 'p') {
                const welcomeText = `🤖 <b>ZYVENOX GPT CREATOR</b>\n━━━━━━━━━━━━━━━━━━\nSelamat datang di sistem otomatisasi ChatGPT.\n\nSilakan pilih menu di bawah ini untuk memulai:`;
                bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (text === '📊 Status Server') {
                bot.sendMessage(chatId, getSystemDashboardText(), { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }
            
            if (text === '❓ Bantuan') {
                bot.sendMessage(chatId, "Jika Anda butuh bantuan, kirimkan email yang valid ke sistem, dan Anda dapat memilih format pembuatan akun. Data Anda dapat diubah di menu Edit Data Saya.", mainMenuKeyboard);
                return;
            }

            if (text === '✨ Daftar Akun Baru') {
                bot.sendMessage(chatId, "📝 <b>Pendaftaran Akun Baru</b>\n━━━━━━━━━━━━━━━━━━\nSilakan kirimkan alamat email yang ingin diproses:", { parse_mode: "HTML", ...mainMenuKeyboard });
                return;
            }

            if (text === '🤖 Auto Daftar (LuckMail)') {
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>Proses Anda masih berjalan.</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }
                const buttons = [
                    [{ text: "📝 Auto Signup Only", callback_data: `mode_auto_signup` }],
                    [{ text: "💳 Auto Signup + Autopay", callback_data: `mode_auto_autopay` }],
                    [{ text: "🔑 Auto Login + Autopay", callback_data: `mode_auto_loginpay` }]
                ];
                bot.sendMessage(chatId, `🤖 <b>Mode Otomatis (LuckMail)</b>\n━━━━━━━━━━━━━━━━━━\nSistem akan membelikan email via API dan mengerjakan proses hingga selesai tanpa input manual.\n\nSilakan pilih mode:`, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons }});
                return;
            }

            if (text === '📬 Auto Daftar (T-Mail)') {
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>Proses Anda masih berjalan.</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }
                const buttons = [
                    [{ text: "📝 Auto Signup Only", callback_data: `tmail_auto_signup` }],
                    [{ text: "💳 Auto Signup + Autopay", callback_data: `tmail_auto_autopay` }],
                    [{ text: "🔑 Auto Login + Autopay", callback_data: `tmail_auto_loginpay` }]
                ];
                bot.sendMessage(chatId, `📬 <b>Mode Otomatis (T-Mail)</b>\n━━━━━━━━━━━━━━━━━━\nSistem akan generate email via ZYVENOX T-Mail dan mengerjakan proses hingga selesai tanpa input manual.\n\nSilakan pilih mode:`, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons }});
                return;
            }

            if (text === '🔑 Login Akun') {
                const email = await askTelegramUser(chatId, "Masukkan <b>Alamat Email</b> akun lama:", "<b>[#LOGIN]</b> ");
                if (!validateEmail(email)) {
                    bot.sendMessage(chatId, "❌ Format email tidak valid.");
                    return;
                }
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>Proses Anda masih berjalan.</b>\nTunggu proses sebelumnya selesai.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                // Tanya password jika mode static
                const uDataLogin = db.getUser(chatId);
                let staticPassLogin = null;
                if (uDataLogin.passwordMode === 'static') {
                    let isValid = false;
                    while (!isValid) {
                        staticPassLogin = await askTelegramUser(chatId, `🔑 Masukkan <b>Password</b> untuk akun <code>${email}</code>:\n<i>(min. 12 karakter, huruf besar+kecil+angka)</i>`);
                        if (!staticPassLogin) return;
                        if (!isValidPassword(staticPassLogin)) {
                            await bot.sendMessage(chatId, "❌ <b>Password tidak memenuhi syarat.</b>\nMin. 12 karakter, huruf besar (A-Z), huruf kecil (a-z), angka (0-9).", { parse_mode: 'HTML' });
                        } else {
                            isValid = true;
                        }
                    }
                }

                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email, mode: 'login_autopay', staticPassword: staticPassLogin });
                if (pos > 0) {
                    bot.sendMessage(chatId, `📥 <b>Masuk Antrian</b>\nUrutan Anda: ${pos}\n<i>Menunggu persetujuan slot aktif...</i>`, { parse_mode: 'HTML' });
                }
                return;
            }

            // Email Detection - Launch mode buttons
            if (validateEmail(text)) {
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>Proses Anda masih berjalan.</b>\nHanya 1 proses per user yang diizinkan pada satu waktu. Mohon batalkan proses yang sedang berjalan atau tunggu hingga selesai.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                const buttons = [
                    [{ text: "📝 Signup Only", callback_data: `mode_signup_${text}` }],
                    [{ text: "💳 Signup + Autopay", callback_data: `mode_pay_${text}` }],
                    [{ text: "🔑 Login + Autopay", callback_data: `mode_loginpay_${text}` }]
                ];

                bot.sendMessage(chatId, 
                    `📧 <b>Email Terdeteksi</b>\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `Alamat: <code>${text}</code>\n\n` +
                    `Silakan pilih mode operasi:`, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: buttons }
                }).catch(e => console.log(chalk.red("[Bot] Gagal mengirim tombol mode: " + e.message)));
                return;
            }

            bot.sendMessage(chatId, "Silakan gunakan menu di bawah untuk berinteraksi.", mainMenuKeyboard);
        });

        // Handle Callbacks
        bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id.toString();
            // Ignore callback queries from old messages
            if (query.message && query.message.date < startTime) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ Pesan kedaluwarsa, silakan buat permintaan baru." });
                return;
            }

            const data = query.data;

            // Admin Actions
            if (data.startsWith('admin_approve_') || data.startsWith('admin_reject_')) {
                const parts = data.split('_');
                const action = parts[1];
                const tarId = parts[2];

                bot.answerCallbackQuery(query.id, { text: `User ${tarId} diproses.` });
                
                if (action === 'approve') {
                    db.approveUser(tarId);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
                    bot.sendMessage(chatId, `✅ Berhasil setujui User ${tarId}.`);
                    
                    // Notify target user
                    bot.sendMessage(tarId, "🎉 <b>Akses Disetujui!</b>\n\nSekarang Anda bisa mendaftar/login akun ChatGPT.\n⚠️ <i>Sebelum memulai, atur mode password Anda di menu ⚙️ Edit Data Saya.</i>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                } else if (action === 'reject') {
                    db.rejectUser(tarId);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
                    bot.sendMessage(chatId, `❌ Berhasil reject User ${tarId}.`);
                    
                    bot.sendMessage(tarId, "❌ <b>Akses Ditolak</b>", { parse_mode: 'HTML' });
                }
                return;
            }

            const userData = db.getUser(chatId);

            // User Settings Edit Menu
            if (data === 'edit_password') {
                bot.answerCallbackQuery(query.id);
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                bot.sendMessage(chatId,
                    `🔑 <b>Mode Password Akun</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `Pilih cara password akun ChatGPT dibuat:\n\n` +
                    `🔄 <b>Otomatis (Random)</b> — sistem generate password unik setiap proses.\n` +
                    `🔑 <b>Manual (Static)</b> — Anda diminta input password setiap memulai proses.`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 Generate Otomatis (Random)", callback_data: "set_pass_random" }],
                                [{ text: "🔑 Input Manual (Static)", callback_data: "set_pass_static" }],
                                [{ text: "❌ Batal", callback_data: "show_main_menu" }]
                            ]
                        }
                    }
                );
                return;
            }

            if (data === 'set_pass_random') {
                bot.answerCallbackQuery(query.id);
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                db.saveUser(chatId, { passwordMode: 'random' });
                bot.sendMessage(chatId, "✅ <b>Mode Password: Otomatis (Random)</b>\nSistem akan men-generate password unik setiap proses.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'set_pass_static') {
                bot.answerCallbackQuery(query.id);
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                db.saveUser(chatId, { passwordMode: 'static' });
                
                // Langsung tanya password yang ingin dipakai
                let isValid = false;
                while (!isValid) {
                    const inputPass = await askTelegramUser(chatId, `🔑 Masukkan <b>Password</b> yang ingin dipakai untuk semua akun:\n<i>(min. 12 karakter, huruf besar+kecil+angka)</i>`);
                    if (!inputPass) {
                        // User cancel
                        bot.sendMessage(chatId, "⚠️ Password belum diset. Mode tetap Static, tapi Anda akan diminta password setiap kali memulai proses.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                        return;
                    }
                    if (!isValidPassword(inputPass)) {
                        await bot.sendMessage(chatId, "❌ <b>Password tidak memenuhi syarat.</b>\nMin. 12 karakter, huruf besar (A-Z), huruf kecil (a-z), angka (0-9).", { parse_mode: 'HTML' });
                    } else {
                        db.saveUser(chatId, { staticPassword: inputPass });
                        bot.sendMessage(chatId, `✅ <b>Mode Password: Manual (Static)</b>\nPassword disimpan: <code>${inputPass}</code>\n\n<i>Password ini akan dipakai untuk semua akun yang dibuat.</i>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                        isValid = true;
                    }
                }
                return;
            }
            
            if (data === 'cancel_process') {
                bot.answerCallbackQuery(query.id, { text: "🛑 Membatalkan proses Anda..." });
                const state = getUserState(chatId);
                // Kita cabut user dari workerPool dan antrian
                workerPool.cancelUserQueue(chatId);
                workerPool.cancelUserActiveToken(chatId);
                
                if (state.lastStatusMessageId) {
                    bot.editMessageText(`🛑 <b>AKUN DIBATALKAN</b>\nAnda membatalkan sesi ini.`, {
                        chat_id: chatId,
                        message_id: state.lastStatusMessageId,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: [] }
                    }).catch(() => {});
                }
                if (state.activePromptResolve) {
                    const resolve = state.activePromptResolve;
                    state.activePromptResolve = null;
                    resolve(null);
                }
                state.currentTaskInfo = null;
                bot.sendMessage(chatId, "✅ Proses berhasil dibatalkan.", mainMenuKeyboard);
                return;
            }
            
            if (data === 'show_main_menu') {
                bot.answerCallbackQuery(query.id);
                const welcomeText = `🤖 <b>ZYVENOX GPT CREATOR</b>\n━━━━━━━━━━━━━━━━━━\nSelamat datang di sistem otomatisasi ChatGPT.\n\nSilakan pilih menu di bawah ini untuk memulai:`;
                bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }
            
            // Mode Select (Signup / Autopay / dll)
            // Handles both mode_ (LuckMail) and tmail_ (T-Mail) prefixes
            if (data.startsWith('mode_') || data.startsWith('tmail_')) {
                const isTMail = data.startsWith('tmail_');
                const stripped = isTMail ? data.replace('tmail_', 'mode_') : data;
                const parts = stripped.split('_');
                // The format could be "mode_signup_test@x", "mode_auto_signup", "mode_retrypay_test@x"
                let mode = parts[1]; // signup, pay, loginpay, auto, retrypay
                let isAuto = false;
                let email = "";

                if (mode === 'auto') {
                    mode = 'auto_' + parts[2]; // auto_signup, auto_autopay, auto_loginpay
                    isAuto = true;
                } else if (mode === 'retrypay') {
                    mode = 'retry_autopay';
                    email = parts.slice(2).join('_');
                } else {
                    email = parts.slice(2).join('_'); // resync email if it contains underscore
                }

                bot.answerCallbackQuery(query.id);
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});

                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ Proses Anda masih berjalan. Hanya 1 slot per user.");
                    return;
                }

                const uData = db.getUser(chatId);

                // Validation: cek passwordMode sudah diset
                if (!uData.passwordMode) {
                    bot.sendMessage(chatId, "⚠️ <b>Mode Password Belum Diset</b>\nSilakan pilih mode password di menu ⚙️ Edit Data Saya → 🔑 Ganti Mode Password.", { parse_mode: "HTML", ...mainMenuKeyboard });
                    return;
                }

                // Tanya password sebelum masuk antrian jika mode static (hanya mode non-auto)
                let staticPass = null;
                if (uData.passwordMode === 'static' && !mode.startsWith('auto_')) {
                    let isValid = false;
                    while (!isValid) {
                        staticPass = await askTelegramUser(chatId, `🔑 Masukkan <b>Password</b> untuk akun <code>${email || 'baru'}</code>:\n<i>(min. 12 karakter, huruf besar+kecil+angka)</i>`);
                        if (!staticPass) return;
                        if (!isValidPassword(staticPass)) {
                            await bot.sendMessage(chatId, "❌ <b>Password tidak memenuhi syarat.</b>\nMin. 12 karakter, huruf besar (A-Z), huruf kecil (a-z), angka (0-9).", { parse_mode: 'HTML' });
                        } else {
                            isValid = true;
                        }
                    }
                }
                // Untuk auto_* + static, password ditanya per-task di handleAccountTask
                
                if (mode === 'auto_loginpay') {
                    const providerLabel = isTMail ? 'T-Mail' : 'LuckMail';
                    email = await askTelegramUser(chatId, `Masukkan <b>Alamat Email ${providerLabel}</b> lama:`, "<b>[#AUTO-LOGIN]</b> ");
                    if (!validateEmail(email)) {
                        bot.sendMessage(chatId, "❌ Format email tidak valid.");
                        return;
                    }
                }

                // ── BATCH MODE: auto_autopay ──────────────────────────────
                // Jika mode auto_autopay, tanya jumlah akun yang ingin dibuat
                // lalu enqueue sebanyak itu. workerPool akan proses 1-per-1 otomatis (FIFO).
                if (mode === 'auto_autopay') {
                    // Cek jika sudah ada batch berjalan/antri
                    const state = getUserState(chatId);
                    if (workerPool.isUserBusy && workerPool.isUserBusy(chatId)) {
                        bot.sendMessage(chatId, "⚠️ <b>Anda masih punya proses berjalan atau antrian.</b>\nTunggu hingga selesai atau batalkan dulu.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                        return;
                    }
                    const jumlahStr = await askTelegramUser(chatId, "Berapa jumlah akun yang ingin dibuat?\n<i>(Ketik angka, contoh: 3)</i>", "<b>[#BATCH]</b> ");
                    const jumlah = parseInt(jumlahStr, 10);
                    if (!jumlahStr || isNaN(jumlah) || jumlah < 1) {
                        bot.sendMessage(chatId, "❌ Jumlah tidak valid. Proses dibatalkan.", mainMenuKeyboard);
                        return;
                    }
                    // Enqueue semua tasks sekaligus; workerPool proses FIFO
                    state.batchResults = [];
                    state.batchPlusCount = 0;
                    state.batchTotalDispatched = jumlah;
                    state.batchTarget = jumlah;
                    state.isBatchMode = true;
                    clearBatchProgress(chatId); // Reset progress file lama
                    const batchMode = isTMail ? 'auto_autopay' : 'auto_autopay';
                    const mailProvider = isTMail ? 'tmail' : 'luckmail';
                    for (let bIdx = 0; bIdx < jumlah; bIdx++) {
                        workerPool.enqueueTask({ userId: chatId, chatId, email: '', mode: batchMode, mailProvider });
                    }
                    const providerName = isTMail ? 'T-Mail' : 'LuckMail';
                    const batchInitText = `📊 <b>BATCH MODE (${providerName})</b>\n` +
                                          `━━━━━━━━━━━━━━━━━━\n` +
                                          `✅ Akun Plus terbuat: <b>0 / ${jumlah}</b>\n` +
                                          `📦 Total proses: <b>0</b>\n` +
                                          `<i>Memulai batch...</i>`;
                    const reply_markup = { inline_keyboard: [[{ text: "🛑 Batalkan Batch", callback_data: "cancel_process" }]] };
                    bot.sendMessage(chatId, batchInitText, { parse_mode: 'HTML', reply_markup }).then(sent => {
                        if (sent) {
                            state.lastStatusMessageId = sent.message_id;
                            state.dashboardObscured = false;
                        }
                    }).catch(() => {});
                    return;
                }
                // ────────────────────────────────────────────────────────────

                // Add to queue (mode selain auto_autopay)
                let mappedMode = mode;
                if (mode === 'loginpay') mappedMode = 'login_autopay';
                if (mode === 'pay') mappedMode = 'autopay';
                
                const mailProvider = isTMail ? 'tmail' : 'luckmail';
                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email, mode: mappedMode, staticPassword: staticPass, mailProvider });
                
                updateStatusFor(chatId, `📥 <b>Antrian Ditambahkan</b>\n📧 Email: <code>${email || 'AUTO-DRAFT'}</code>\n📊 Urutan: ${pos}\n<i>Menunggu giliran pemrosesan...</i>`, { email: email || 'Menunggu API', mode: mappedMode }, true);
                
                return;
            }
            
            bot.answerCallbackQuery(query.id);
        });

    } catch (error) {
        console.log(chalk.red("[Bot] Gagal memulai engine: " + error.message));
    }
}

function sendSettingsMenu(chatId, userData) {
    const modeLabel = userData.passwordMode === 'random' ? '🔄 Otomatis (Random)'
                    : userData.passwordMode === 'static' ? '🔑 Manual (Static)'
                    : '⚠️ Belum diset';
    const text = `⚙️ <b>Edit Data Saya</b>\n\n` +
                 `🔑 <b>Mode Password:</b> <code>${modeLabel}</code>\n` +
                 `<i>Password dibuat ${userData.passwordMode === 'random' ? 'otomatis setiap proses' : userData.passwordMode === 'static' ? 'dari input Anda setiap proses' : '— silakan set dulu'}</i>\n\n` +
                 `Silakan pilih apa yang ingin diubah:`;
                 
    bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Ganti Mode Password", callback_data: "edit_password" }],
                [{ text: "❌ Tutup", callback_data: "show_main_menu" }]
            ]
        }
    });
}

async function askTelegramUser(chatId, question, logTag = "") {
    chatId = chatId.toString();
    return new Promise((resolve) => {
        if (!bot) {
            resolve("");
            return;
        }

        const state = getUserState(chatId);

        bot.sendMessage(chatId, `<b>INPUT DIBUTUHKAN</b>\n${logTag}${question}\n\n<i>(Balas pesan ini untuk merespon, atau klik batal jika macet)</i>`, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "🛑 Batalkan Sesi", callback_data: "cancel_process" }]]
            }
        }).then(sent => {
            state.lastPromptMessageId = sent.message_id;
            state.dashboardObscured = true;
        }).catch(()=>{});
        state.activePromptResolve = resolve;
    });
}

function updateStatusFor(chatId, text, accountInfo = null, isQueued = false) {
    if (!bot) return;
    chatId = chatId.toString();
    const state = getUserState(chatId);

    // Batch mode: hanya tampilkan message awal (isQueued), skip semua update proses individual
    if (state.isBatchMode && !isQueued) {
        return;
    }

    state.messageQueue.push({ text, accountInfo, isQueued });
    processUserMessageQueue(chatId);
}

/**
 * Kirim file JSON akun ke user (untuk single task maupun batch).
 */
async function sendAccountJsonFile(chatId, results) {
    if (!bot || !results || results.length === 0) return;
    try {
        const ts = new Date().getTime();

        const formattedData = {};
        let plusCount = 0;
        results.forEach(acc => {
            // Hanya masukkan akun yang BERHASIL PLUS ke dalam JSON report agar tidak nyampah
            if (acc && acc.email && acc.accountType === 'Plus') {
                formattedData[acc.email] = {
                    email: acc.email,
                    password: acc.password || 'N/A',
                    accountType: acc.accountType || 'Plus',
                    mailToken: acc.mailToken || 'token_tidak_tersedia'
                };
                plusCount++;
            }
        });

        if (plusCount === 0) {
            logger.info(`[Bot] Tidak ada akun Plus dalam batch ini. Skip kirim file.`);
            return;
        }

        // Tulis TXT format email ---- password ---- type ---- tokenMail
        // Simpan ke folder reports/ agar tidak hilang
        const txtFileName = `${plusCount}_plus_at_${ts}.txt`;
        const txtFilePath = path.join(REPORTS_DIR, txtFileName);
        const txtContent = Object.values(formattedData)
            .map((acc, i) => `${acc.email} ---- ${acc.password} ---- ${acc.accountType} ---- ${acc.mailToken}`)
            .join('\n');
        fs.writeFileSync(txtFilePath, txtContent);

        const isBatch = results.length > 1;
        const caption = isBatch
            ? `📦 <b>BATCH REPORT</b>\n${plusCount} akun berhasil PLUS (dari ${results.length} proses). Berikut rekapannya:`
            : `📄 <b>DATA AKUN</b>\nProses selesai! Berikut data akun Anda:`;

        await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        await bot.sendDocument(chatId, txtFilePath);

        // File TIDAK dihapus — disimpan permanen di folder reports/
        logger.info(`[Bot] File TXT akun berhasil dikirim ke ${chatId} (${plusCount} akun Plus) → ${txtFileName}`);
    } catch (err) {
        logger.error('[Bot] Gagal kirim file akun: ' + err.message);
        bot.sendMessage(chatId, '⚠️ Gagal mengirim file laporan.').catch(() => {});
    }
}


/**
 * Dipanggil oleh workerPool saat task selesai (sukses maupun gagal).
 * Menentukan aksi berdasarkan mode: batch = kumpulkan, single = kirim langsung.
 */
function handleTaskResult(chatId, result) {
    if (!result) return;
    chatId = chatId.toString();
    const state = getUserState(chatId);

    if (state.isBatchMode) {
        // Mode Batch: kumpulkan hasil dan cek apakah target Plus sudah tercapai
        state.batchResults.push(result);
        const isPlus = result && result.accountType === 'Plus';
        if (isPlus) {
            state.batchPlusCount++;
            logger.info(`[Bot] Akun Plus ke-${state.batchPlusCount}/${state.batchTarget} berhasil (${chatId})`);
            // Persist batch progress ke disk agar tidak hilang saat crash
            saveBatchProgress(chatId, state.batchResults.filter(r => r && r.accountType === 'Plus'));
        } else {
            // Task gagal jadi Plus → enqueue 1 task pengganti jika target belum tercapai
            if (state.batchPlusCount < state.batchTarget) {
                logger.warn(`[Bot] Task gagal (bukan Plus), mengantrikan pengganti untuk ${chatId}...`);
                state.batchTotalDispatched++;
                // Preserve mailProvider dari task sebelumnya
                const mailProvider = result.mailProvider || 'luckmail';
                workerPool.enqueueTask({ userId: chatId, chatId, email: '', mode: 'auto_autopay', mailProvider });
            }
        }

        // Update dashboard sederhana: cuma counter akun Plus
        const failCount = state.batchTotalDispatched - state.batchPlusCount - (state.batchTarget - state.batchPlusCount);
        const batchText = `📊 <b>BATCH MODE</b>\n` +
                          `━━━━━━━━━━━━━━━━━━\n` +
                          `✅ Akun Plus terbuat: <b>${state.batchPlusCount} / ${state.batchTarget}</b>\n` +
                          `📦 Total proses: <b>${state.batchResults.length}</b>\n` +
                          `<i>Sedang berjalan...</i>`;

        // Kirim langsung tanpa melalui filter batch di updateStatusFor
        if (bot) {
            const batchState = getUserState(chatId);
            const reply_markup = { inline_keyboard: [[{ text: "🛑 Batalkan Batch", callback_data: "cancel_process" }]] };
            if (batchState.lastStatusMessageId) {
                bot.editMessageText(batchText, {
                    chat_id: chatId,
                    message_id: batchState.lastStatusMessageId,
                    parse_mode: 'HTML',
                    reply_markup
                }).catch(async (err) => {
                    if (!err.message.includes('message is not modified')) {
                        const sent = await bot.sendMessage(chatId, batchText, { parse_mode: 'HTML', reply_markup }).catch(() => null);
                        if (sent) batchState.lastStatusMessageId = sent.message_id;
                    }
                });
            } else {
                bot.sendMessage(chatId, batchText, { parse_mode: 'HTML', reply_markup }).then(sent => {
                    if (sent) batchState.lastStatusMessageId = sent.message_id;
                }).catch(() => {});
            }
        }

        checkAndSendBatchReport(chatId);
    } else {
        // Mode Single: kirim JSON langsung setelah jeda singkat (beri waktu status dashboard diupdate)
        setTimeout(() => sendAccountJsonFile(chatId, [result]), 2000);
    }
}

/**
 * Fungsi mandiri untuk mengirim laporan batch jika target tercapai.
 * Dipanggil tiap kali ada update status (batch mode).
 */
async function checkAndSendBatchReport(chatId) {
    const state = getUserState(chatId);
    
    // Guard: Pastikan dalam mode batch dan target PLUS sudah tercapai
    if (state.isBatchMode && state.batchPlusCount >= state.batchTarget && state.batchTarget > 0) {
        // Ambil data hasil dan segera reset state agar tidak kepanggil dobel
        const results = [...state.batchResults];
        const successCount = state.batchPlusCount;
        const totalDispatched = state.batchTotalDispatched;
        const failCount = totalDispatched - successCount;

        state.isBatchMode = false;
        state.batchResults = [];
        state.batchTarget = 0;
        state.batchPlusCount = 0;
        state.batchTotalDispatched = 0;
        clearBatchProgress(chatId); // Bersihkan file progress setelah batch selesai

        // Kirim ringkasan batch
        const summaryMsg = `📊 <b>BATCH COMPLETED</b>\n` +
                         `━━━━━━━━━━━━━━━━━━\n` +
                         `✅ Plus     : <b>${successCount} akun</b>\n` +
                         `❌ Gagal    : <b>${failCount} percobaan</b>\n` +
                         `📦 Total    : <b>${totalDispatched} task dijalankan</b>\n\n` +
                         `<i>Menyiapkan laporan ${successCount} akun Plus...</i>`;
        
        bot.sendMessage(chatId, summaryMsg, { parse_mode: 'HTML' });

        // Beri jeda sedikit agar dashboard status FINISHED terkirim duluan
        setTimeout(() => sendAccountJsonFile(chatId, results), 2500);
    }
}

// Global legacy fallback mapping
// Karena core API (apiSignup dkk) dari versi sebelum multi-user mungkin mengandalkan `askTelegram`, 
// maka jika chat flow mengharuskan interaksi, fungsi ini perlu memanggil userId yang tepat.
// index.js harus mem-bridge fungsi `askTelegram` (mungkin via options, jika ada)
// Jika tidak via options, kita harus assume dari `currentTask` mana yang sedang jalan...
// Karena di versi sebelumnya `askTelegram` tidak minta chatId, akan lebih baik kalau kita minta di-inject ke `ChatGPTSignup`/dll.
// Namun DILARANG menyentuh file signup.js dll. Jadi kita harus pakai "trick": Global AskTelegram akan mengecek userId mana yang sedang request.
// Mengingat nodeJS itu asynchronous, cara teraman tanpa modif signup dll = ganti parameter di dalam OTPFn callback (di index.js) yang memanggil askTelegram dengan spesifik.

// However, using AsyncLocalStorage we can magically get the chatId from the index.js context wrapper
// without needing to modify the caller's arguments.

async function askTelegram(question, logTag = "", overrideChatId = null) {
    const chatIdLocal = asyncLocalStorage.getStore();
    const targetChatId = overrideChatId || chatIdLocal;
    
    if (targetChatId) {
        return askTelegramUser(targetChatId.toString(), question, logTag);
    }
    
    throw new Error("askTelegram requires overrideChatId or async_hooks context in multi-user mode!"); 
}


async function processUserMessageQueue(chatId) {
    const state = getUserState(chatId);
    if (state.isQueueProcessing || state.messageQueue.length === 0) return;
    state.isQueueProcessing = true;

    while (state.messageQueue.length > 0) {
        let latestEntry = state.messageQueue.shift();
        
        while (state.messageQueue.length > 0) {
            if (state.messageQueue[0].accountInfo) {
                latestEntry.accountInfo = state.messageQueue[0].accountInfo;
            }
            if (typeof state.messageQueue[0].isQueued !== 'undefined') {
                latestEntry.isQueued = state.messageQueue[0].isQueued;
            }
            latestEntry.text = state.messageQueue.shift().text;
        }

        const { text, accountInfo, isQueued } = latestEntry;
        
        try {
            if (accountInfo) state.currentTaskInfo = accountInfo;

            let header = '';
            let reply_markup = { inline_keyboard: [] };

            const isWorkerRunning = workerPool.isUserActive(chatId);
            const isUserBusy = workerPool.isUserBusy(chatId);

            if (state.currentTaskInfo) {
                const { email, mode, name } = state.currentTaskInfo;
                let modeName = mode;
                if (mode === 'login_autopay') modeName = '🔑 LOGIN + AUTOPAY';
                else if (mode === 'autopay') modeName = '💳 SIGNUP + AUTOPAY';
                else if (mode === 'signup') modeName = '📝 SIGNUP ONLY';
                else if (mode === 'failed_autopay') modeName = '❌ AUTOPAY FAILED';
                else if (mode === 'retry_autopay') modeName = '💳 RETRY PAY';
                
                header = `🖥️ <b>SYSTEM DASHBOARD</b>\n` +
                         `━━━━━━━━━━━━━━━━━━\n` +
                         `👤 NAME  : <code>${name || 'ZYVENOX-GEN'}</code>\n` +
                         `📧 EMAIL : <code>${email}</code>\n` +
                         `💎 MODE  : <b>${modeName}</b>\n` +
                         `━━━━━━━━━━━━━━━━━━\n\n`;
                
                if (isWorkerRunning || isQueued) {
                    reply_markup.inline_keyboard = [[{ text: "🛑 Batalkan Sesi Ini", callback_data: "cancel_process" }]];
                } else if (mode === 'failed_autopay') {
                    reply_markup.inline_keyboard = [
                        [{ text: "💳 Retry Pay", callback_data: `mode_retrypay_${email}` }],
                        [{ text: "📋 Tampilkan Menu Utama", callback_data: "show_main_menu" }]
                    ];
                }
            } else {
                header = `🖥️ <b>SYSTEM DASHBOARD (IDLE)</b>\n` +
                         `━━━━━━━━━━━━━━━━━━\n` +
                         `<i>Siap menerima tugas baru...</i>\n\n`;
                reply_markup.inline_keyboard = [[{ text: "📋 Tampilkan Menu Utama", callback_data: "show_main_menu" }]];
            }
            
            let engineStatus = "";
            if (isWorkerRunning) {
                engineStatus = "ACTIVE • PROCESSING 🚀";
            } else if (isQueued) {
                engineStatus = "QUEUED • WAITING ⏳";
            } else if (state.currentTaskInfo) {
                engineStatus = "FINISHED • COMPLETED ✅";
                if (state.currentTaskInfo.mode !== 'failed_autopay') {
                    reply_markup.inline_keyboard = [[{ text: "📋 Tampilkan Menu Utama", callback_data: "show_main_menu" }]];
                }
            } else {
                engineStatus = "STANDBY • IDLE 💤";
            }

            const footer = `\n\n━━━━━━━━━━━━━━━━━━\n<i>Status: ${engineStatus} • Updated: ${new Date().toLocaleTimeString()}</i>`;
            const fullText = header + text + footer;

            if (state.lastStatusMessageId && state.dashboardObscured) {
                bot.deleteMessage(chatId, state.lastStatusMessageId).catch(() => {});
                state.lastStatusMessageId = null;
            }

            if (state.lastStatusMessageId) {
                await bot.editMessageText(fullText, {
                    chat_id: chatId,
                    message_id: state.lastStatusMessageId,
                    parse_mode: 'HTML',
                    reply_markup: reply_markup
                }).then(() => {
                    state.dashboardObscured = false;
                }).catch(async (err) => {
                    if (err.message.includes("message is not modified")) {
                        state.dashboardObscured = false;
                        return;
                    }
                    if (err.message.includes("message to edit not found") || err.message.includes("chat not found")) {
                        const sent = await bot.sendMessage(chatId, fullText, { parse_mode: 'HTML', reply_markup });
                        if (sent) {
                            state.lastStatusMessageId = sent.message_id;
                            state.dashboardObscured = false;
                        }
                    } else {
                        console.log(chalk.red("[Bot] Edit error: " + err.message));
                    }
                });
            } else {
                const sent = await bot.sendMessage(chatId, fullText, { parse_mode: 'HTML', reply_markup });
                if (sent) {
                    state.lastStatusMessageId = sent.message_id;
                    state.dashboardObscured = false;
                }
            }

        } catch (e) {
            console.log(chalk.red("[Bot] Gagal update status Telegram: " + e.message));
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {}
    }

    state.isQueueProcessing = false;
}

/**
 * Recovery: Cek apakah ada batch progress file yang belum dikirim ke user saat bot restart.
 * Dipanggil saat startup (dari index.js).
 */
function recoverPendingBatchReports() {
    if (!bot) return;
    try {
        const files = fs.readdirSync(REPORTS_DIR).filter(f => f.startsWith('batch_progress_') && f.endsWith('.json'));
        for (const file of files) {
            const chatId = file.replace('batch_progress_', '').replace('.json', '');
            const results = loadBatchProgress(chatId);
            if (results && results.length > 0) {
                logger.info(`[Recovery] Ditemukan ${results.length} akun dari batch yang belum dikirim ke ${chatId}. Mengirim sekarang...`);
                sendAccountJsonFile(chatId, results).then(() => {
                    clearBatchProgress(chatId);
                    bot.sendMessage(chatId, `🔄 <b>RECOVERY</b>\nBot baru saja restart. Ditemukan ${results.length} akun Plus dari batch sebelumnya yang belum dikirim. File sudah dikirim ulang di atas.`, { parse_mode: 'HTML', ...mainMenuKeyboard }).catch(() => {});
                }).catch(err => {
                    logger.error(`[Recovery] Gagal kirim recovery batch untuk ${chatId}: ${err.message}`);
                });
            }
        }
    } catch (e) {
        logger.error(`[Recovery] Error saat recovery batch: ${e.message}`);
    }
}

module.exports = {
    initTelegram,
    askTelegramUser,
    askTelegram,
    updateStatusFor,
    handleTaskResult,
    setRestartCallback,
    stopTelegram,
    asyncLocalStorage,
    getUserState,
    recoverPendingBatchReports
};
