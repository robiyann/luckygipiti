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

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

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
            batchTarget: 0,          // Target number of Plus accounts to create
            batchPlusCount: 0,       // Plus accounts successfully created so far
            batchTotalDispatched: 0, // Total tasks dispatched to queue
            isBatchMode: false,
            lastBatchEditTime: 0,
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
    '🚀 Full Auto Plus',
    '💳 Auto Pay Bot',
    '⚙️ My Settings',
    '📊 Server Status',
    '❓ Help',
    '👥 Referral'
]);

const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            ['🚀 Full Auto Plus', '💳 Auto Pay Bot'],
            ['⚙️ My Settings', '📈 My Stats'],
            ['👥 Referral', '📊 Server Status', '❓ Help']
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// Remvoed admin approve function

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
                'autopay': 'SIGNUP+PAY', 'auto_autopay': 'AUTO SIGNUP+PAY',
                'auto_signup': 'AUTO SIGNUP', 'retry_autopay': 'RETRY PAY'
            };
            const modeName = mMap[s.mode] || s.mode.toUpperCase();
            const runTime = Math.floor((Date.now() - s.startTime) / 1000);
            
            const u = db.getUser(s.userId);
            const userName = u && u.firstName ? u.firstName : s.userId.substring(0,4)+'...';
            
            text += `[${idx+1}] 👤 ${userName} | <code>${s.email || 'AUTO'}</code>\n`;
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
            
            // --- 1. User Database Guard & Registration
            if (!db.hasUser(chatId)) {
                if (text.startsWith('/start')) {
                    // Extract referral code if present
                    let referrerCode = null;
                    if (text.includes('REF_')) {
                        referrerCode = text.split(' ')[1].replace('REF_', '');
                    }
                    
                    db.initUserData(chatId, msg.from.first_name);

                    if (referrerCode) {
                        const referrer = db.getUserByReferralCode(referrerCode);
                        if (referrer) {
                            db.saveUser(chatId, { referredBy: referrer.id, referralRewarded: true });
                            db.addPoints(referrer.id, 1);
                            bot.sendMessage(referrer.id, `🎉 <b>New Referral!</b>\nSomeone just registered using your invite link. You received <b>+1 point</b>!`, { parse_mode: 'HTML' }).catch(()=>{});
                        }
                    }

                    const welcomeNew = "👋 <b>Welcome to GPT Creator Bot!</b>\n\nThis is a private automation service for ChatGPT Plus accounts.\n\n⚠️ <i>Before you start, please configure your settings via ⚙️ My Settings.</i>";
                    bot.sendMessage(chatId, welcomeNew, { parse_mode: 'HTML', ...mainMenuKeyboard });
                } else {
                }
                return;
            }

            // Jika user LAMA memencet link referral
            if (text.startsWith('/start REF_')) {
                bot.sendMessage(chatId, "❌ <b>Referral Failed</b>\nYou cannot use an invite link because you are already a registered user.", { parse_mode: 'HTML' });
                return;
            }

            const userData = db.getUser(chatId);
            // User Approved 
            
            // Resolving Prompt manually triggered setup steps
            // Pastikan tombol menu utama TIDAK ikut me-resolve prompt yang sedang menunggu input.
            if (state.activePromptResolve && !MENU_COMMANDS.has(text)) {
                const resolve = state.activePromptResolve;
                state.activePromptResolve = null;
                
                const userMsgId = msg.message_id;
                
                bot.sendMessage(chatId, `✨ <b>Input Received:</b> <code>${text}</code>`, { parse_mode: "HTML" }).then(sentMsg => {
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
            
            // If user presses a menu button while a prompt is active, warn them
            if (state.activePromptResolve && MENU_COMMANDS.has(text)) {
                bot.sendMessage(chatId, "⚠️ <b>A task is waiting for your input.</b>\n<i>Reply to the question above, or click 🛑 Cancel Session to abort.</i>", { parse_mode: 'HTML' }).catch(() => {});
                return;
            }

            // If user explicitly asks to setup/edit
            if (text === '⚙️ My Settings') {
                sendSettingsMenu(chatId, userData);
                return;
            }

            // Commands and Menu Actions
            if (text === '/start' || text.toLowerCase() === 'menu' || text === 'p') {
                const uStats = db.getUserStats(chatId) || { points: 0, referralCode: 'N/A' };
                const welcomeText = `🤖 <b>GPT CREATOR BOT</b>\n━━━━━━━━━━━━━━━━━━\nWelcome to the private automation service.\n\n💎 <b>Points Balance:</b> ${uStats.points}\n🔗 <b>Referral:</b> t.me/${(await bot.getMe()).username}?start=REF_${uStats.referralCode}\n\nPlease choose an option below:`;
                bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            // Admin Command: /setthreads <userId> <amount>
            if (text.startsWith('/setthreads')) {
                const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
                if (!adminIds.includes(chatId)) {
                    bot.sendMessage(chatId, "❌ Access denied.");
                    return;
                }
                const parts = text.split(' ');
                if (parts.length < 3) {
                    bot.sendMessage(chatId, "⚠️ Usage: <code>/setthreads &lt;userId&gt; &lt;amount&gt;</code>", { parse_mode: 'HTML' });
                    return;
                }
                const targetUserId = parts[1];
                const threads = parseInt(parts[2]);
                if (isNaN(threads) || threads < 1) {
                    bot.sendMessage(chatId, "⚠️ Thread count must be a number > 0.");
                    return;
                }
                if (!db.hasUser(targetUserId)) {
                    bot.sendMessage(chatId, "⚠️ User not found in database.");
                    return;
                }
                db.saveUser(targetUserId, { maxThreads: threads });
                bot.sendMessage(chatId, `✅ <b>User ${targetUserId}</b> — max threads set to <b>${threads}</b>`, { parse_mode: 'HTML' });
                return;
            }

            // Admin Command: /addpoints <userId> <amount>
            if (text.startsWith('/addpoints')) {
                const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
                if (!adminIds.includes(chatId)) {
                    bot.sendMessage(chatId, "❌ Access denied.");
                    return;
                }
                const parts = text.split(' ');
                if (parts.length < 3) {
                    bot.sendMessage(chatId, "⚠️ Usage: <code>/addpoints &lt;userId&gt; &lt;amount&gt;</code>", { parse_mode: 'HTML' });
                    return;
                }
                const targetUserId = parts[1];
                const amount = parseInt(parts[2]);
                if (isNaN(amount)) {
                    bot.sendMessage(chatId, "⚠️ Amount must be a number.");
                    return;
                }
                if (!db.hasUser(targetUserId)) {
                    bot.sendMessage(chatId, "⚠️ User not found in database.");
                    return;
                }
                const updated = db.addPoints(targetUserId, amount);
                bot.sendMessage(chatId, `✅ <b>User ${targetUserId}</b>\n+${amount} points added.\n💎 New Balance: <b>${updated.points}</b>`, { parse_mode: 'HTML' });
                return;
            }

            // Admin Command: /setpoints <userId> <amount>
            if (text.startsWith('/setpoints')) {
                const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
                if (!adminIds.includes(chatId)) {
                    bot.sendMessage(chatId, "❌ Access denied.");
                    return;
                }
                const parts = text.split(' ');
                if (parts.length < 3) {
                    bot.sendMessage(chatId, "⚠️ Usage: <code>/setpoints &lt;userId&gt; &lt;amount&gt;</code>", { parse_mode: 'HTML' });
                    return;
                }
                const targetUserId = parts[1];
                const amount = parseInt(parts[2]);
                if (isNaN(amount) || amount < 0) {
                    bot.sendMessage(chatId, "⚠️ Amount must be a non-negative number.");
                    return;
                }
                if (!db.hasUser(targetUserId)) {
                    bot.sendMessage(chatId, "⚠️ User not found in database.");
                    return;
                }
                db.saveUser(targetUserId, { points: amount });
                bot.sendMessage(chatId, `✅ <b>User ${targetUserId}</b>\n💎 Points set to: <b>${amount}</b>`, { parse_mode: 'HTML' });
                return;
            }

            // Admin Command: /userinfo <userId>
            if (text.startsWith('/userinfo')) {
                const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
                if (!adminIds.includes(chatId)) {
                    bot.sendMessage(chatId, "❌ Access denied.");
                    return;
                }
                const parts = text.split(' ');
                if (parts.length < 2) {
                    bot.sendMessage(chatId, "⚠️ Usage: <code>/userinfo &lt;userId&gt;</code>", { parse_mode: 'HTML' });
                    return;
                }
                const targetUserId = parts[1];
                const stats = db.getUserStats(targetUserId);
                const user = db.getUser(targetUserId);
                if (!stats || !user) {
                    bot.sendMessage(chatId, "⚠️ User not found in database.");
                    return;
                }
                bot.sendMessage(chatId,
                    `👤 <b>USER INFO</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 ID        : <code>${targetUserId}</code>\n` +
                    `👋 Name      : ${user.firstName || 'N/A'}\n` +
                    `💎 Points    : <b>${stats.points}</b>\n` +
                    `📧 Accounts  : ${stats.totalAccountsCreated}\n` +
                    `⭐ Plus Made : ${stats.totalPlusCreated}\n` +
                    `👥 Referrals : ${stats.totalReferrals}\n` +
                    `🔗 Ref Code  : <code>${stats.referralCode}</code>\n` +
                    `🔒 Threads   : ${user.maxThreads || 1}\n` +
                    `📅 Joined    : ${user.registeredAt ? user.registeredAt.split('T')[0] : 'N/A'}`,
                    { parse_mode: 'HTML' }
                );
                return;
            }

            // Admin Command: /listadmin — Show all admin commands
            if (text === '/listadmin') {
                const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => id.trim());
                if (!adminIds.includes(chatId)) {
                    bot.sendMessage(chatId, "❌ Access denied.");
                    return;
                }
                bot.sendMessage(chatId,
                    `🛠️ <b>ADMIN COMMANDS</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `<code>/addpoints &lt;userId&gt; &lt;amount&gt;</code>\nAdd points to a user\n\n` +
                    `<code>/setpoints &lt;userId&gt; &lt;amount&gt;</code>\nSet a user's points to exact value\n\n` +
                    `<code>/setthreads &lt;userId&gt; &lt;amount&gt;</code>\nSet max threads for a user\n\n` +
                    `<code>/userinfo &lt;userId&gt;</code>\nView detailed user info`,
                    { parse_mode: 'HTML' }
                );
                return;
            }

            if (text === '📊 Server Status') {
                bot.sendMessage(chatId, getSystemDashboardText(), { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }
            
            if (text === '❓ Help') {
                bot.sendMessage(chatId, "Welcome to GPT Creator. Use the menu buttons to generate ChatGPT Plus accounts automatically. Configure your preferences and API keys in ⚙️ My Settings first.", mainMenuKeyboard);
                return;
            }

            if (text === '👥 Referral' || text === '/referral') {
                const stats = db.getUserStats(chatId) || { totalReferrals: 0, points: 0, referralCode: 'N/A' };
                const botUser = await bot.getMe();
                bot.sendMessage(chatId, 
                    `🔗 <b>YOUR INVITE LINK</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `💎 <b>Points Balance:</b> ${stats.points}\n` +
                    `👥 <b>People Invited:</b> ${stats.totalReferrals}\n\n` +
                    `<b>Link:</b> t.me/${botUser.username}?start=REF_${stats.referralCode}\n\n` +
                    `<i>Share this link to earn +1 point for every referral who successfully creates their first ChatGPT Plus account!</i>`,
                    { parse_mode: 'HTML', ...mainMenuKeyboard }
                );
                return;
            }

            if (text === '/mystat' || text === '📈 My Stats') {
                const stats = db.getUserStats(chatId) || { points: 0, totalAccountsCreated: 0, totalPlusCreated: 0, totalReferrals: 0, referralCode: 'N/A' };
                
                let currentActivity = "<i>Standby / Idle 💤</i>";
                if (state.currentTaskInfo && state.currentTaskInfo.text) {
                    currentActivity = state.currentTaskInfo.text;
                } else if (workerPool.isUserActive(chatId)) {
                    currentActivity = "<i>Processing task... (waiting for live logs) 🚀</i>";
                } else if (workerPool.isUserBusy(chatId)) {
                    currentActivity = "<i>Queued... Waiting for available slot ⏳</i>";
                }

                bot.sendMessage(chatId, 
                    `📊 <b>YOUR STATS & HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `💎 <b>Points Balance :</b> ${stats.points}\n` +
                    `📧 <b>Accounts Made  :</b> ${stats.totalAccountsCreated}\n` +
                    `⭐ <b>Plus Accounts  :</b> ${stats.totalPlusCreated}\n` +
                    `👥 <b>Total Referrals:</b> ${stats.totalReferrals}\n` +
                    `🔗 <b>Referral Code  :</b> <code>${stats.referralCode}</code>\n\n` +
                    `🛠️ <b>CURRENT REALTIME ACTIVITY</b>\n━━━━━━━━━━━━━━━━━━\n${currentActivity}`,
                    { parse_mode: 'HTML', ...mainMenuKeyboard }
                );
                return;
            }

            if (text === '🚀 Full Auto Plus') {
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>A task is already running.</b>\nWait for it to complete or cancel first.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }
                
                // Point Gate
                if (!db.hasEnoughPoints(chatId, 4)) {
                    bot.sendMessage(chatId, `❌ <b>Not Enough Points</b>\n━━━━━━━━━━━━━━━━━━\nRequired : 4 points (Full Auto Plus)\nBalance  : ${db.getUserStats(chatId)?.points || 0} points\n\n💡 <i>Share your referral link to earn more points!</i>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                const buttons = [
                    [{ text: "🍀 LuckMail", callback_data: 'fullpro_luckmail' }, { text: "📬 T-Mail", callback_data: 'fullpro_tmail' }]
                ];
                bot.sendMessage(chatId,
                    `🚀 <b>Full Auto Plus</b>\n━━━━━━━━━━━━━━━━━━\nThe system will automatically sign up, get OTP, and activate ChatGPT Plus. (Cost: <b>4 points/success</b>)\n\nChoose an email provider:`,
                    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
                );
                return;
            }

            if (text === '💳 Auto Pay Bot') {
                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ <b>A task is already running.</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                // Point Gate
                if (!db.hasEnoughPoints(chatId, 1)) {
                    bot.sendMessage(chatId, `❌ <b>Not Enough Points</b>\n━━━━━━━━━━━━━━━━━━\nRequired : 1 point (Auto Pay Bot)\nBalance  : ${db.getUserStats(chatId)?.points || 0} points\n\n💡 <i>Share your referral link to earn more points!</i>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                const uData = db.getUser(chatId);
                if (!uData.passwordMode) {
                    bot.sendMessage(chatId, "⚠️ <b>Password Mode Not Set</b>\nGo to ⚙️ My Settings to configure it first.", { parse_mode: "HTML", ...mainMenuKeyboard });
                    return;
                }
                const emailInput = await askTelegramUser(chatId, "Enter the <b>Email Address</b> to register:", "<b>[#AUTO-PAY]</b> ");
                if (!emailInput || !validateEmail(emailInput)) {
                    bot.sendMessage(chatId, "❌ Invalid email format or cancelled.", mainMenuKeyboard);
                    return;
                }
                let staticPass = null;
                if (uData.passwordMode === 'static') {
                    let isValid = false;
                    while (!isValid) {
                        staticPass = await askTelegramUser(chatId, `🔑 Enter the <b>Password</b> for account <code>${emailInput}</code>:\n<i>(min. 12 chars, uppercase + lowercase + numbers)</i>`);
                        if (!staticPass) return;
                        if (!isValidPassword(staticPass)) {
                            await bot.sendMessage(chatId, "❌ <b>Password does not meet requirements.</b>\nMin. 12 chars, uppercase (A-Z), lowercase (a-z), numbers (0-9).", { parse_mode: 'HTML' });
                        } else {
                            isValid = true;
                        }
                    }
                }
                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email: emailInput, mode: 'autopay', staticPassword: staticPass, mailProvider: 'manual' });
                updateStatusFor(chatId, `📥 <b>Task Queued</b>\n📧 Email: <code>${emailInput}</code>\n📊 Position: ${pos}\n<i>Waiting to be processed...</i>`, { email: emailInput, mode: 'autopay' }, true);
                return;
            }

            bot.sendMessage(chatId, "Use the menu buttons below.", mainMenuKeyboard);
        });

        // Handle Callbacks
        bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id.toString();
            // Ignore callback queries from old messages
            if (query.message && query.message.date < startTime) {
                bot.answerCallbackQuery(query.id, { text: "⚠️ This message has expired, please make a new request." }).catch(() => {});
                return;
            }

            const data = query.data;
            const state = getUserState(chatId);

            // Mencegah bug bot macet: jika bot sedang menunggu ketikan (input), abaikan pencetan tombol (kecuali tombol Cancel)
            if (state.activePromptResolve && data !== 'cancel_process') {
                bot.answerCallbackQuery(query.id, { text: "⚠️ Selesaikan input ketikan Anda terlebih dahulu, atau tekan Cancel.", show_alert: true }).catch(() => {});
                return;
            }

            // ---


            const userData = db.getUser(chatId);

            // User Settings Edit Menu
            if (data === 'edit_password') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                bot.sendMessage(chatId,
                    `🔑 <b>Account Password Mode</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `Choose how account passwords are created:\n\n` +
                    `🔄 <b>Auto (Random)</b> — System generates a unique password each time.\n` +
                    `🔑 <b>Manual (Static)</b> — You input a password each time you start.`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔄 Auto Generate (Random)", callback_data: "set_pass_random" }],
                                [{ text: "🔑 Manual Input (Static)", callback_data: "set_pass_static" }],
                                [{ text: "❌ Cancel", callback_data: "show_main_menu" }]
                            ]
                        }
                    }
                );
                return;
            }

            if (data === 'set_pass_random') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                db.saveUser(chatId, { passwordMode: 'random' });
                bot.sendMessage(chatId, "✅ <b>Password Mode: Auto (Random)</b>\nSystem will generate a unique password each time.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'set_pass_static') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(()=>{});
                db.saveUser(chatId, { passwordMode: 'static' });
                
                // Langsung tanya password yang ingin dipakai
                let isValid = false;
                while (!isValid) {
                    const inputPass = await askTelegramUser(chatId, `🔑 Enter the <b>Password</b> to use for all accounts:\n<i>(min. 12 chars, uppercase + lowercase + numbers)</i>`);
                    if (!inputPass) {
                        bot.sendMessage(chatId, "⚠️ Password not set. Mode remains Static — you'll be prompted each time.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                        return;
                    }
                    if (!isValidPassword(inputPass)) {
                        await bot.sendMessage(chatId, "❌ <b>Password does not meet requirements.</b>\nMin. 12 chars, uppercase (A-Z), lowercase (a-z), numbers (0-9).", { parse_mode: 'HTML' });
                    } else {
                        db.saveUser(chatId, { staticPassword: inputPass });
                        bot.sendMessage(chatId, `✅ <b>Password Mode: Manual (Static)</b>\nPassword saved: <code>${inputPass}</code>\n\n<i>This password will be used for all created accounts.</i>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                        isValid = true;
                    }
                }
                return;
            }
            
            if (data === 'cancel_process') {
                bot.answerCallbackQuery(query.id, { text: "🛑 Cancelling your task..." }).catch(() => {});
                const state = getUserState(chatId);
                // Signal the running task to stop via cancellation token
                workerPool.cancelTokenForUser(chatId);
                // Remove pending queue items and release the pool slot
                workerPool.cancelUserQueue(chatId);
                workerPool.cancelUserActiveToken(chatId);
                
                // Reset batch mode if applicable
                state.isBatchMode = false;
                state.batchResults = [];
                state.batchTarget = 0;
                state.batchPlusCount = 0;
                state.batchTotalDispatched = 0;

                if (state.lastStatusMessageId) {
                    bot.editMessageText(`🛑 <b>SESSION CANCELLED</b>\nYou have cancelled this session.`, {
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
                bot.sendMessage(chatId, "✅ Task successfully cancelled.", mainMenuKeyboard);
                return;
            }
            
            if (data === 'show_main_menu') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                const welcomeText = `🤖 <b>GPT CREATOR BOT</b>\n━━━━━━━━━━━━━━━━━━\nWelcome back to the automation service.\n\nPlease choose an option below:`;
                bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            // Full Auto Plus — provider selection
            if (data === 'fullpro_luckmail' || data === 'fullpro_tmail') {

                const mailProvider = data === 'fullpro_luckmail' ? 'luckmail' : 'tmail';
                const providerName = mailProvider === 'luckmail' ? '🍀 LuckMail' : '📬 T-Mail';
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

                if (workerPool.isUserBusy && workerPool.isUserBusy(chatId)) {
                    bot.sendMessage(chatId, "⚠️ <b>You still have a running task.</b>\nWait for it to complete or cancel first.", { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }

                const uData = db.getUser(chatId);
                
                // Extra checks for Mail Providers
                if (mailProvider === 'luckmail' && !uData.luckMailApiKey) {
                    bot.sendMessage(chatId, "❌ <b>LuckMail API Key not set.</b>\nGo to ⚙️ My Settings to add your key first.", { parse_mode: "HTML", ...mainMenuKeyboard });
                    return;
                }
                if (mailProvider === 'tmail' && !uData.tmailApiKey) {
                    bot.sendMessage(chatId, "❌ <b>T-Mail API Key not set.</b>\nGo to ⚙️ My Settings to add your key first.", { parse_mode: "HTML", ...mainMenuKeyboard });
                    return;
                }

                if (!uData.passwordMode) {
                    bot.sendMessage(chatId, "⚠️ <b>Password Mode Not Set</b>\nGo to ⚙️ My Settings to configure it first.", { parse_mode: "HTML", ...mainMenuKeyboard });
                    return;
                }

                const amountStr = await askTelegramUser(chatId, `How many <b>${providerName}</b> accounts do you want to create?\n<i>(Type a number, e.g. 3)</i>`, "<b>[#BATCH]</b> ");
                const amount = parseInt(amountStr, 10);
                if (!amountStr || isNaN(amount) || amount < 1) {
                    bot.sendMessage(chatId, "❌ Invalid number. Process cancelled.", mainMenuKeyboard);
                    return;
                }

                const state = getUserState(chatId);
                state.batchResults = [];
                state.batchPlusCount = 0;
                state.batchTotalDispatched = amount;
                state.batchTarget = amount;
                state.isBatchMode = true;
                clearBatchProgress(chatId);

                const batchTasks = [];
                for (let bIdx = 0; bIdx < amount; bIdx++) {
                    batchTasks.push({ userId: chatId, chatId, email: '', mode: 'auto_autopay', mailProvider });
                }
                workerPool.enqueueBatch(batchTasks);

                const batchInitText = `📊 <b>FULL AUTO PLUS (${providerName})</b>\n` +
                                      `━━━━━━━━━━━━━━━━━━\n` +
                                      `✅ Plus accounts created: <b>0 / ${amount}</b>\n` +
                                      `📦 Total tasks: <b>0</b>\n` +
                                      `<i>Starting batch...</i>`;
                const reply_markup = { inline_keyboard: [[{ text: "🛑 Cancel Batch", callback_data: "cancel_process" }]] };
                bot.sendMessage(chatId, batchInitText, { parse_mode: 'HTML', reply_markup }).then(sent => {
                    if (sent) {
                        state.lastStatusMessageId = sent.message_id;
                        state.dashboardObscured = false;
                    }
                }).catch(() => {});
                return;
            }

            // Edit T-Mail URL
            if (data === 'edit_tmail_url') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const inputUrl = await askTelegramUser(chatId,
                    `🌐 Enter new <b>T-Mail Base URL</b>:\n<i>(example: https://mail.zyvenox.my.id)</i>\n<i>Send "-" to reset to default</i>`);
                if (!inputUrl) return;
                let finalUrl = inputUrl.trim();
                if (finalUrl === '-' || finalUrl === '') {
                    db.saveUser(chatId, { tmailBaseUrl: null });
                    bot.sendMessage(chatId, `✅ <b>T-Mail URL reset to default</b>\n🌐 URL: <code>https://mail.zyvenox.my.id</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                } else {
                    if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
                    finalUrl = finalUrl.replace(/\/$/, '');
                    db.saveUser(chatId, { tmailBaseUrl: finalUrl });
                    bot.sendMessage(chatId, `✅ <b>T-Mail URL saved</b>\n🌐 URL: <code>${finalUrl}</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                }
                return;
            }

            if (data === 'edit_tmail_key') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const key = await askTelegramUser(chatId, `🔑 Enter your <b>T-Mail API Key</b>:\n<i>Send "-" to remove</i>`);
                if (!key) return;
                if (key.trim() === '-') {
                    db.saveUser(chatId, { tmailApiKey: null });
                    bot.sendMessage(chatId, `✅ <b>T-Mail API Key removed</b>.`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                } else {
                    db.saveUser(chatId, { tmailApiKey: key.trim() });
                    bot.sendMessage(chatId, `✅ <b>T-Mail API Key saved</b>.`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                }
                return;
            }

            if (data === 'edit_luckmail_key') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                let isValid = false;
                while (!isValid) {
                    const key = await askTelegramUser(chatId, `🍀 Enter your <b>LuckMail API Key</b>:\n<i>Send "-" to remove</i>`);
                    if (!key) return;
                    if (key.trim() === '-') {
                        db.saveUser(chatId, { luckMailApiKey: null });
                        bot.sendMessage(chatId, `✅ <b>LuckMail API Key removed</b>.`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                        isValid = true;
                    } else if (!key.trim().startsWith('luck_') && !key.trim().startsWith('ak_')) {
                        bot.sendMessage(chatId, `❌ Invalid LuckMail key format. It usually starts with 'luck_' or 'ak_'. Try again.`);
                    } else {
                        db.saveUser(chatId, { luckMailApiKey: key.trim() });
                        bot.sendMessage(chatId, `✅ <b>LuckMail API Key saved</b>.`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                        isValid = true;
                    }
                }
                return;
            }

            if (data === 'edit_luckmail_domains') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const doms = await askTelegramUser(chatId, `🌐 Enter your preferred <b>LuckMail Domains</b> (comma separated):\n<i>Example: outlook.com, outlook.jp</i>`);
                if (!doms) return;
                const clean = doms.split(',').map(d => d.trim().toLowerCase()).filter(Boolean).join(', ');
                db.saveUser(chatId, { luckMailDomains: clean });
                bot.sendMessage(chatId, `✅ <b>LuckMail Domains saved:</b>\n<code>${clean}</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'edit_tmail_domains') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const doms = await askTelegramUser(chatId,
                    `🌐 Enter preferred <b>T-Mail Domains</b> (comma separated):\n<i>Example: domain1.com, domain2.com</i>\n<i>Send "-" to reset ke auto round-robin</i>`);
                if (!doms) return;
                if (doms.trim() === '-' || doms.trim() === '') {
                    db.saveUser(chatId, { tmailDomains: null });
                    bot.sendMessage(chatId, `✅ <b>T-Mail Domains reset</b>\n🔀 Mode: Auto Round-Robin (semua domain)`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                } else {
                    const clean = doms.split(',').map(d => d.trim().toLowerCase()).filter(Boolean).join(', ');
                    db.saveUser(chatId, { tmailDomains: clean });
                    bot.sendMessage(chatId, `✅ <b>T-Mail Domains saved:</b>\n<code>${clean}</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                }
                return;
            }

            // ── Tmail Luckyous settings ──────────────────────────────────────
            if (data === 'edit_tmailluckyous_domain') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const domInput = await askTelegramUser(chatId,
                    `🌐 Enter <b>Luckyous Domain</b>:\n<i>Example: jungkirbalik.my.id, kuber.com</i>\n<i>Must be a valid domain (no http/https, no spaces)</i>`);
                if (!domInput) return;
                const domClean = domInput.trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/\/$/, '');
                // Validate: must contain at least one dot, no spaces, no slashes
                const domainRegex = /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)+$/i;
                if (!domainRegex.test(domClean)) {
                    bot.sendMessage(chatId, `❌ <b>Invalid domain format.</b>\nExample valid domains: <code>jungkirbalik.my.id</code>, <code>kuber.com</code>\nNo http://, no spaces, must have TLD.`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                    return;
                }
                db.saveUser(chatId, { tmailLuckyousDomain: domClean });
                bot.sendMessage(chatId, `✅ <b>Luckyous Domain saved:</b> <code>${domClean}</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'edit_tmailluckyous_type') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                bot.sendMessage(chatId,
                    `📦 <b>Select Luckyous Email Type</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `Choose the <code>email_type</code> to use when purchasing email:\n\n` +
                    `• <code>ms_graph</code> — Microsoft Graph\n` +
                    `• <code>ms_imap</code> — Microsoft IMAP\n` +
                    `• <code>self_built</code> — Self-built server\n` +
                    `• <code>google_variant</code> — Google Variant`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "ms_graph", callback_data: "set_luckyous_type_ms_graph" }, { text: "ms_imap", callback_data: "set_luckyous_type_ms_imap" }],
                                [{ text: "self_built", callback_data: "set_luckyous_type_self_built" }, { text: "google_variant", callback_data: "set_luckyous_type_google_variant" }],
                                [{ text: "❌ Cancel", callback_data: "show_main_menu" }]
                            ]
                        }
                    }
                );
                return;
            }

            if (data.startsWith('set_luckyous_type_')) {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                const typeValue = data.replace('set_luckyous_type_', '');
                const allowedTypes = ['ms_graph', 'ms_imap', 'self_built', 'google_variant'];
                if (!allowedTypes.includes(typeValue)) {
                    bot.sendMessage(chatId, `❌ Unknown type.`, mainMenuKeyboard);
                    return;
                }
                db.saveUser(chatId, { tmailLuckyousType: typeValue });
                bot.sendMessage(chatId, `✅ <b>Luckyous Email Type set:</b> <code>${typeValue}</code>`, { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            // Retry Autopay
            if (data.startsWith('mode_retrypay_')) {
                const email = data.replace('mode_retrypay_', '');
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});

                if (workerPool.isUserActive(chatId)) {
                    bot.sendMessage(chatId, "❌ A task is already running. Only 1 slot per user.");
                    return;
                }

                const uData = db.getUser(chatId);
                let staticPass = null;
                if (uData.passwordMode === 'static') {
                    let isValid = false;
                    while (!isValid) {
                        staticPass = await askTelegramUser(chatId, `🔑 Enter <b>Password</b> for account <code>${email}</code>:\n<i>(min. 12 chars, uppercase + lowercase + numbers)</i>`);
                        if (!staticPass) return;
                        if (!isValidPassword(staticPass)) {
                            await bot.sendMessage(chatId, "❌ <b>Password does not meet requirements.</b>\nMin. 12 chars, uppercase (A-Z), lowercase (a-z), numbers (0-9).", { parse_mode: 'HTML' });
                        } else {
                            isValid = true;
                        }
                    }
                }
                const pos = workerPool.enqueueTask({ userId: chatId, chatId, email, mode: 'retry_autopay', staticPassword: staticPass, mailProvider: 'manual' });
                updateStatusFor(chatId, `📥 <b>Retry Pay Queued</b>\n📧 Email: <code>${email}</code>\n📊 Position: ${pos}\n<i>Waiting to be processed...</i>`, { email, mode: 'retry_autopay' }, true);
                return;
            }

            // Edit Report Format
            if (data === 'edit_report_format') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                bot.sendMessage(chatId,
                    `📋 <b>Account Report Format</b>\n━━━━━━━━━━━━━━━━━━\n` +
                    `Choose the TXT file format the bot will send:\n\n` +
                    `🔑 <b>Email + Token</b> — <code>email ---- pass ---- type ---- token</code> (Full)\n` +
                    `📧 <b>Email:Password:Token</b> — <code>email:password:token</code>`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔑 Email + Token (Default)", callback_data: "set_format_tokens" }],
                                [{ text: "📧 Email:Password:Token", callback_data: "set_format_email_pw" }],
                                [{ text: "📧 Email|Password", callback_data: "set_format_email_only_pw" }],
                                [{ text: "❌ Cancel", callback_data: "show_main_menu" }]
                            ]
                        }
                    }
                );
                return;
            }

            if (data === 'set_format_tokens') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                db.saveUser(chatId, { reportFormat: 'with_tokens' });
                bot.sendMessage(chatId, "✅ <b>Report Format: Email + Token</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'set_format_email_pw') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                db.saveUser(chatId, { reportFormat: 'email_pw' });
                bot.sendMessage(chatId, "✅ <b>Report Format: Email:Password:Token</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            if (data === 'set_format_email_only_pw') {
                bot.answerCallbackQuery(query.id).catch(() => {});
                bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
                db.saveUser(chatId, { reportFormat: 'email_only_pw' });
                bot.sendMessage(chatId, "✅ <b>Report Format: Email|Password</b>", { parse_mode: 'HTML', ...mainMenuKeyboard });
                return;
            }

            bot.answerCallbackQuery(query.id).catch(() => {});
        });

    } catch (error) {
        console.log(chalk.red("[Bot] Gagal memulai engine: " + error.message));
    }
}

function sendSettingsMenu(chatId, userData) {
    const modeLabel = userData.passwordMode === 'random' ? '🔄 Auto (Random)'
                    : userData.passwordMode === 'static' ? '🔑 Manual (Static)'
                    : '⚠️ Not set';
    const formatLabel = userData.reportFormat === 'email_pw' ? '📧 Email:Password:Token'
                      : userData.reportFormat === 'email_only_pw' ? '📧 Email|Password'
                      : '🔑 Email + Token (Default)';
    const tmailUrl = userData.tmailBaseUrl || 'https://mail.zyvenox.my.id (default)';
    const tmailKey = userData.tmailApiKey ? '✅ Set' : '⚠️ Not set';
    const tmailDomains = userData.tmailDomains || '🔀 Auto Round-Robin (all domains)';
    const luckKey = userData.luckMailApiKey ? '✅ Set' : '⚠️ Not set';
    const luckDomains = userData.luckMailDomains || 'outlook.com, outlook.jp';
    const luckyousDomain = userData.tmailLuckyousDomain || '⚠️ Not set';
    const luckyousType   = userData.tmailLuckyousType   || '⚠️ Not set';

    const text = `⚙️ <b>MY SETTINGS</b>\n━━━━━━━━━━━━━━━━━━\n` +
                 `🔑 <b>Password Mode    :</b> <code>${modeLabel}</code>\n` +
                 `📋 <b>Report Format    :</b> <code>${formatLabel}</code>\n\n` +
                 `🍀 <b>LuckMail Key     :</b> <code>${luckKey}</code>\n` +
                 `🌐 <b>LuckMail Domains :</b> <code>${luckDomains}</code>\n\n` +
                 `📬 <b>T-Mail Base URL  :</b> <code>${tmailUrl}</code>\n` +
                 `🔑 <b>T-Mail Key       :</b> <code>${tmailKey}</code>\n` +
                 `🌐 <b>T-Mail Domains   :</b> <code>${tmailDomains}</code>\n\n` +
                 `🍀 <b>Tmail Luckyous</b>\n` +
                 `   🌐 <b>Domain :</b> <code>${luckyousDomain}</code>\n` +
                 `   📦 <b>Type   :</b> <code>${luckyousType}</code>\n\n` +
                 `<i>Select an option below to change:</i>`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔑 Password Mode", callback_data: "edit_password" }, { text: "📋 Report Format", callback_data: "edit_report_format" }],
                [{ text: "🍀 LuckMail API Key", callback_data: "edit_luckmail_key" }],
                [{ text: "🌐 LuckMail Domains", callback_data: "edit_luckmail_domains" }],
                [{ text: "📬 T-Mail Base URL", callback_data: "edit_tmail_url" }],
                [{ text: "🔑 T-Mail API Key", callback_data: "edit_tmail_key" }],
                [{ text: "🌐 T-Mail Domains", callback_data: "edit_tmail_domains" }],
                [{ text: "🌐 Luckyous Domain", callback_data: "edit_tmailluckyous_domain" }, { text: "📦 Luckyous Type", callback_data: "edit_tmailluckyous_type" }],
                [{ text: "❌ Close", callback_data: "show_main_menu" }]
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

        bot.sendMessage(chatId, `<b>INPUT REQUIRED</b>\n${logTag}${question}\n\n<i>(Reply to this message to respond, or click Cancel if stuck)</i>`, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "🛑 Cancel Session", callback_data: "cancel_process" }]]
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
        // Hitung waktu UTC+7
        const now = new Date();
        const utc7 = new Date(now.getTime() + (7 * 60 * 60 * 1000));
        const dateStr = utc7.getUTCFullYear().toString() + 
                        (utc7.getUTCMonth() + 1).toString().padStart(2, '0') + 
                        utc7.getUTCDate().toString().padStart(2, '0') + '_' + 
                        utc7.getUTCHours().toString().padStart(2, '0') + 
                        utc7.getUTCMinutes().toString().padStart(2, '0') + 
                        utc7.getUTCSeconds().toString().padStart(2, '0');

        const formattedData = {};
        let plusCount = 0;
        let provider = 'mix';
        const providers = new Set();

        results.forEach(acc => {
            // Hanya masukkan akun yang BERHASIL PLUS ke dalam JSON report agar tidak nyampah
            if (acc && acc.email && acc.accountType === 'Plus') {
                formattedData[acc.email] = {
                    email: acc.email,
                    password: acc.password || 'N/A',
                    accountType: acc.accountType || 'Plus',
                    mailToken: acc.mailToken || 'not_available'
                };
                plusCount++;
                if (acc.mailProvider) providers.add(acc.mailProvider);
            }
        });

        if (providers.size === 1) {
            provider = Array.from(providers)[0];
        } else if (providers.size === 0) {
            provider = 'unknown';
        }

        if (plusCount === 0) {
            logger.info(`[Bot] Tidak ada akun Plus dalam batch ini. Skip kirim file.`);
            return;
        }

        // Tulis TXT format sesuai preference user
        // Simpan ke folder reports/ agar tidak hilang
        const uData = db.getUser(chatId);
        const reportFormat = (uData && uData.reportFormat) || 'with_tokens';
        
        const txtFileName = `PLUS_${plusCount}_${provider}_[${chatId}]_${dateStr}.txt`;
        const txtFilePath = path.join(REPORTS_DIR, txtFileName);
        const txtContent = Object.values(formattedData)
            .map((acc, i) => {
                if (reportFormat === 'email_pw') {
                    return `${acc.email}:${acc.password}:${acc.mailToken}`;
                } else if (reportFormat === 'email_only_pw') {
                    return `${acc.email}|${acc.password}`;
                } else {
                    return `${acc.email} ---- ${acc.password} ---- ${acc.accountType} ---- ${acc.mailToken}`;
                }
            })
            .join('\n');
        fs.writeFileSync(txtFilePath, txtContent);

        const isBatch = results.length > 1;
        const caption = isBatch
            ? `📦 <b>BATCH REPORT</b>\n${plusCount} Plus accounts created (from ${results.length} tasks).`
            : `📄 <b>ACCOUNT DATA</b>\nTask complete! Here is your account data:`;

        await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        await bot.sendDocument(chatId, txtFilePath);

        // File TIDAK dihapus — disimpan permanen di folder reports/
        logger.info(`[Bot] File TXT akun berhasil dikirim ke ${chatId} (${plusCount} akun Plus) → ${txtFileName}`);
    } catch (err) {
        logger.error('[Bot] Gagal kirim file akun: ' + err.message);
        bot.sendMessage(chatId, '⚠️ Failed to send report file.').catch(() => {});
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
            // Task gagal jadi Plus → enqueue replacement ONLY within retry cap
            const maxReplacements = state.batchTarget; // multiplier 1x replacement
            const replacementsSoFar = state.batchTotalDispatched - state.batchTarget;

            if (state.batchPlusCount < state.batchTarget && replacementsSoFar < maxReplacements) {
                state.batchTotalDispatched++;
                const replacementsLeft = maxReplacements - replacementsSoFar - 1;
                logger.warn(`[Bot] Task failed, re-queuing replacement for ${chatId} (${replacementsSoFar + 1}/${maxReplacements} retries used, ${replacementsLeft} left)`);
                const mailProvider = result.mailProvider || 'luckmail';
                workerPool.enqueueTask({ userId: chatId, chatId, email: '', mode: 'auto_autopay', mailProvider });
            } else if (state.batchPlusCount < state.batchTarget && replacementsSoFar >= maxReplacements) {
                logger.warn(`[Bot] Batch retry cap reached. No more replacements will be queued.`);
            }
        }

        // Cek jika target tercapai lebih awal, batalkan queue yang belum jalan untuk menghemat resource
        if (state.batchPlusCount >= state.batchTarget) {
            workerPool.cancelUserQueue(chatId);
            // Sesuaikan total dispatched agar sama dengan yang SUDAH SELESAI + YANG SEDANG JALAN
            // Karena queue dibatalkan, total dispatched tidak boleh lebih besar dari itu.
            const { getUserActiveCount } = require('./workerPool');
            const activeRunning = typeof getUserActiveCount === 'function' ? getUserActiveCount(chatId) : 0;
            const newTotal = state.batchResults.length + activeRunning;
            if (state.batchTotalDispatched > newTotal) {
                state.batchTotalDispatched = newTotal;
            }
        }

        // Update dashboard sederhana: cuma counter akun Plus
        const batchText = `📊 <b>BATCH MODE</b>\n` +
                          `━━━━━━━━━━━━━━━━━━\n` +
                          `✅ Plus accounts created: <b>${state.batchPlusCount} / ${state.batchTarget}</b>\n` +
                          `📦 Total tasks: <b>${state.batchResults.length} / ${state.batchTotalDispatched}</b>\n` +
                          `<i>Running...</i>`;

        // Kirim langsung tanpa melalui filter batch di updateStatusFor
        if (bot) {
            const batchState = getUserState(chatId);
            const now = Date.now();
            
            // Debounce: Edit maksimal 1x per 3 detik untuk menghindari 429 Too Many Requests
            if (now - (batchState.lastBatchEditTime || 0) > 3000) {
                batchState.lastBatchEditTime = now;
                const reply_markup = { inline_keyboard: [[{ text: "🛑 Cancel Batch", callback_data: "cancel_process" }]] };
                if (batchState.lastStatusMessageId) {
                    bot.editMessageText(batchText, {
                        chat_id: chatId,
                        message_id: batchState.lastStatusMessageId,
                        parse_mode: 'HTML',
                        reply_markup
                    }).catch(async (err) => {
                        if (err.message.includes('429')) return; // Abaikan log error 429
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
    if (!state.isBatchMode) return;
    
    // Batch BENAR-BENAR SELESAI hanya jika semua task yang didispatch sudah mengembalikan hasil
    const isFinished = state.batchResults.length >= state.batchTotalDispatched;
    if (!isFinished) return;

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
                         `✅ Plus      : <b>${successCount} accounts</b>\n` +
                         `❌ Failed    : <b>${failCount} attempts</b>\n` +
                         `📦 Total     : <b>${totalDispatched} tasks run</b>\n\n` +
                         `<i>Preparing report for ${successCount} Plus accounts...</i>`;
        
        bot.sendMessage(chatId, summaryMsg, { parse_mode: 'HTML' });

        // Beri jeda sedikit agar dashboard status FINISHED terkirim duluan
        setTimeout(() => sendAccountJsonFile(chatId, results), 2500);
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
                    reply_markup.inline_keyboard = [[{ text: "🛑 Cancel This Session", callback_data: "cancel_process" }]];
                } else if (mode === 'failed_autopay') {
                    reply_markup.inline_keyboard = [
                        [{ text: "💳 Retry Pay", callback_data: `mode_retrypay_${email}` }],
                        [{ text: "📋 Show Main Menu", callback_data: "show_main_menu" }]
                    ];
                }
            } else {
                header = `🖥️ <b>SYSTEM DASHBOARD (IDLE)</b>\n` +
                         `━━━━━━━━━━━━━━━━━━\n` +
                         `<i>Ready to accept new tasks...</i>\n\n`;
                reply_markup.inline_keyboard = [[{ text: "📋 Show Main Menu", callback_data: "show_main_menu" }]];
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
                        if (!err.message.includes('429')) {
                            console.log(chalk.red("[Bot] Edit error: " + err.message));
                        }
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
            await new Promise(resolve => setTimeout(resolve, 2500));
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
