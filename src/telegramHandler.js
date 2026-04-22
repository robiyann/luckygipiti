const TelegramBot = require('node-telegram-bot-api');
const chalk = require('chalk');
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const workerPool = require('./workerPool');
const logger = require('./utils/logger');

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
                
                // Cek syarat data untuk login_autopay
                const uData = db.getUser(chatId);
                if (!uData.password || typeof uData.gopayPhone === 'undefined' || typeof uData.gopayPin === 'undefined' || !uData.gopayPhone || !uData.gopayPin) {
                    bot.sendMessage(chatId, "⚠️ <b>Data Tidak Lengkap</b>\nUntuk mode Login + Autopay, Anda wajib melengkapi: Password, Nomor GoPay, dan PIN GoPay di menu ⚙️ Edit Data Saya.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email, mode: 'login_autopay' });
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
                    bot.sendMessage(tarId, "🎉 <b>Akses Disetujui!</b>\n\nSekarang Anda bisa mendaftar/login akun ChatGPT.\n⚠️ <i>Pastikan mengisi Password, No GoPay & PIN GoPay di menu 'Edit Data Saya' sebelum memilih mode Autopay.</i>", { parse_mode: 'HTML', ...mainMenuKeyboard });
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
            if (data === 'edit_password' || data === 'edit_gopay_phone' || data === 'edit_gopay_pin') {
                bot.answerCallbackQuery(query.id);
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                
                if (data === 'edit_password') {
                    let isValid = false;
                    while (!isValid) {
                        const pass = await askTelegramUser(chatId, "Masukkan <b>Password Master</b> baru untuk akun ChatGPT:\n<i>(Wajib min. 12 karakter, kombinasi huruf besar, huruf kecil, & angka)</i>");
                        if (!pass) break; // User clicked 'cancel'
                        
                        if (pass.length < 12 || !/[A-Z]/.test(pass) || !/[a-z]/.test(pass) || !/[0-9]/.test(pass)) {
                            await bot.sendMessage(chatId, "❌ <b>Password Tidak Memenuhi Syarat!</b>\nHarap buat password yang lebih kuat:\n- Minimal 12 karakter\n- Mengandung huruf besar (A-Z)\n- Mengandung huruf kecil (a-z)\n- Mengandung angka (0-9)", { parse_mode: 'HTML' });
                        } else {
                            isValid = true;
                            db.saveUser(chatId, { password: pass });
                            bot.sendMessage(chatId, "✅ Password master diperbarui.", mainMenuKeyboard);
                        }
                    }
                } else if (data === 'edit_gopay_phone') {
                    const phone = await askTelegramUser(chatId, "Masukkan <b>Nomor GoPay</b> baru (format bebas):");
                    if(phone) {
                        db.saveUser(chatId, { gopayPhone: phone });
                        bot.sendMessage(chatId, "✅ Nomor GoPay diperbarui.", mainMenuKeyboard);
                    }
                } else if (data === 'edit_gopay_pin') {
                    const pin = await askTelegramUser(chatId, "Masukkan <b>PIN GoPay</b> baru (6 digit angka):");
                    if(pin) {
                        db.saveUser(chatId, { gopayPin: pin });
                        bot.sendMessage(chatId, "✅ PIN GoPay diperbarui.", mainMenuKeyboard);
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
            if (data.startsWith('mode_')) {
                const parts = data.split('_');
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

                // Validation
                if (mode.includes('signup') && !mode.includes('autopay')) {
                    if (!uData.password) {
                        bot.sendMessage(chatId, "⚠️ <b>Data Tidak Lengkap</b>\nUntuk mode Signup Only, Anda wajib mengisi <b>Password Master</b> di menu ⚙️ Edit Data Saya.", { parse_mode: "HTML", ...mainMenuKeyboard });
                        return;
                    }
                } else if (mode.includes('pay')) {
                    if (!uData.password || typeof uData.gopayPhone === 'undefined' || typeof uData.gopayPin === 'undefined' || !uData.gopayPhone || !uData.gopayPin) {
                        bot.sendMessage(chatId, "⚠️ <b>Data Tidak Lengkap</b>\nUntuk mode Autopay, Anda wajib melengkapi <b>Password, Nomor GoPay, &amp; PIN GoPay</b> di menu ⚙️ Edit Data Saya.", { parse_mode: "HTML", ...mainMenuKeyboard });
                        return;
                    }
                }
                
                if (mode === 'auto_loginpay') {
                    email = await askTelegramUser(chatId, "Masukkan <b>Alamat Email LuckMail</b> lama:", "<b>[#AUTO-LOGIN]</b> ");
                    if (!validateEmail(email)) {
                        bot.sendMessage(chatId, "❌ Format email tidak valid.");
                        return;
                    }
                }

                // ── BATCH MODE: auto_autopay ──────────────────────────────
                // Jika mode auto_autopay (LuckMail), tanya jumlah akun yang ingin dibuat
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
                    state.batchResults = []; // Reset penampung hasil
                    state.batchPlusCount = 0;
                    state.batchTotalDispatched = jumlah;
                    state.batchTarget = jumlah; // Target = jumlah akun PLUS yang diinginkan
                    state.isBatchMode = true; 
                    for (let bIdx = 0; bIdx < jumlah; bIdx++) {
                        workerPool.enqueueTask({ userId: chatId, chatId, email: '', mode: 'auto_autopay' });
                    }
                    updateStatusFor(chatId,
                        `📥 <b>Batch Antrian Ditambahkan</b>\n` +
                        `🎯 Target: <b>${jumlah} akun PLUS</b>\n` +
                        `💳 Mode: <b>Auto Signup + Autopay</b>\n` +
                        `<i>Bot akan terus membuat akun baru sampai ${jumlah} akun berhasil PLUS...</i>`,
                        { email: 'AUTO-BATCH', mode: 'auto_autopay' }, true
                    );
                    return;
                }
                // ────────────────────────────────────────────────────────────

                // Add to queue (mode selain auto_autopay)
                let mappedMode = mode;
                if (mode === 'loginpay') mappedMode = 'login_autopay';
                if (mode === 'pay') mappedMode = 'autopay';
                
                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email, mode: mappedMode });
                
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
    const text = `⚙️ <b>Edit Data Saya</b>\n\n` + 
                 `🔑 <b>Password:</b> <code>${userData.password ? 'Tersimpan' : 'Kosong'}</code>\n`+
                 `📱 <b>GoPay:</b> <code>${userData.gopayPhone ? userData.gopayPhone.slice(0,4) + '****' + userData.gopayPhone.slice(-3) : 'Kosong'}</code>\n`+
                 `🔢 <b>PIN:</b> <code>****</code>\n\n`+
                 `Silakan pilih apa yang ingin diubah:`;
                 
    bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Ganti Password", callback_data: "edit_password" }],
                [{ text: "📱 Ganti No. GoPay", callback_data: "edit_gopay_phone" }],
                [{ text: "🔢 Ganti PIN GoPay", callback_data: "edit_gopay_pin" }],
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
        const fileName = `account_${ts}.json`;
        const filePath = path.join(process.cwd(), fileName);

        const formattedData = {};
        let plusCount = 0;
        results.forEach(acc => {
            // Hanya masukkan akun yang BERHASIL PLUS ke dalam JSON report agar tidak nyampah
            if (acc && acc.email && acc.accountType === 'Plus') {
                formattedData[acc.email] = {
                    email: acc.email,
                    password: acc.password || 'N/A',
                    accountType: acc.accountType || 'Plus'
                };
                plusCount++;
            }
        });

        if (plusCount === 0) {
            logger.info(`[Bot] Tidak ada akun Plus dalam batch ini. Skip kirim file.`);
            return;
        }

        // Tulis TXT format email:password:type
        const txtFileName = `account_${ts}.txt`;
        const txtFilePath = path.join(process.cwd(), txtFileName);
        const txtContent = Object.values(formattedData)
            .map((acc, i) => `${i + 1}. ${acc.email}:${acc.password}:${acc.accountType.toLowerCase()}`)
            .join('\n');
        fs.writeFileSync(txtFilePath, txtContent);

        const isBatch = results.length > 1;
        const caption = isBatch
            ? `📦 <b>BATCH REPORT</b>\n${results.length} akun telah diproses. Berikut rekapannya:`
            : `📄 <b>DATA AKUN</b>\nProses selesai! Berikut data akun Anda:`;

        await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        await bot.sendDocument(chatId, txtFilePath);

        // Hapus file sementara setelah 30 detik
        setTimeout(() => {
            if (fs.existsSync(txtFilePath)) fs.unlinkSync(txtFilePath);
        }, 30000);

        logger.info(`[Bot] File TXT akun berhasil dikirim ke ${chatId} (${plusCount} akun Plus)`);
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
        } else {
            // Task gagal jadi Plus → enqueue 1 task pengganti jika target belum tercapai
            if (state.batchPlusCount < state.batchTarget) {
                logger.warn(`[Bot] Task gagal (bukan Plus), mengantrikan pengganti untuk ${chatId}...`);
                state.batchTotalDispatched++;
                workerPool.enqueueTask({ userId: chatId, chatId, email: '', mode: 'auto_autopay' });
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

module.exports = {
    initTelegram,
    askTelegramUser,
    askTelegram,
    updateStatusFor,
    handleTaskResult,
    setRestartCallback,
    stopTelegram,
    asyncLocalStorage,
    getUserState
};
