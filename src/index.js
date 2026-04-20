require("dotenv").config();
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const ChatGPTSignup = require("./signup");
const ChatGPTAutopay = require("./autopay");
const { generateRandomName, generateRandomBirthday } = require("./utils/emailGenerator");
const initCycleTLS = require("cycletls");
const logger = require("./utils/logger");
const luckMailApi = require("./utils/luckMailApi");

const db = require("./db");
const workerPool = require("./workerPool");
const telegramHandler = require("./telegramHandler");

const clientId = "app_X8zY6vW2pQ9tR3dE7nK1jL5gH";
const redirectUri = "https://chatgpt.com/api/auth/callback/openai";
const audience = "https://api.openai.com/v1";

// Function to run account creation task in isolation
async function handleAccountTask(task) {
    const { userId, chatId, email, mode } = task;
    
    // Fetch user settings from DB
    const userData = db.getUser(userId);
    if (!userData) {
        telegramHandler.updateStatusFor(chatId, `🚫 <b>SYSTEM ERROR</b>\nData pengguna tidak ditemukan.`);
        return;
    }

    const { password, gopayPhone, gopayPin } = userData;
    const threadId = Math.floor(Math.random() * 900) + 100;

    const modeName = {
        'autopay': 'Signup + Autopay',
        'signup': 'Signup Only',
        'login_autopay': 'Login + Autopay'
    }[mode] || mode;

    const name = generateRandomName();
    const bday = generateRandomBirthday();

    let currentEmail = email;
    let token = null;
    let purchaseId = null;

    if (mode === 'auto_signup' || mode === 'auto_autopay') {
        try {
            telegramHandler.updateStatusFor(chatId, `🛍️ <b>Membeli Email via LuckMail...</b>`);
            const purchase = await luckMailApi.purchaseEmail();
            currentEmail = purchase.email;
            token = purchase.token;
            purchaseId = purchase.purchaseId;
            telegramHandler.updateStatusFor(chatId, `🛍️ <b>Email Didapat:</b> <code>${currentEmail}</code>`);
        } catch (e) {
            telegramHandler.updateStatusFor(chatId, `🚫 <b>LUCKMAIL FAILED</b>\n${e.message}`);
            return;
        }
    } else if (mode === 'auto_loginpay') {
        const existingOrder = db.getOrderByEmail(currentEmail);
        token = existingOrder ? existingOrder.orderId : null;
        if (!token) {
            telegramHandler.updateStatusFor(chatId, `🚫 <b>ORDER NOT FOUND</b>\nTidak bisa auto poll OTP karena data email ini tak ada di riwayat bot.`);
            return;
        }
    }

    telegramHandler.updateStatusFor(chatId, `🚀 <b>Initializing Task...</b>`, { email: currentEmail || email, mode, name });

    logger.account(currentEmail || email);
    logger.info(`Mode: ${modeName} - User: ${userId}`);
    logger.info(`Menginisialisasi engine...`);

    // In multi-user context, we create a fresh CycleTLS instance for this run
    const localCycleTLS = await initCycleTLS();

    // Proxy OTP function based on mode
    let otpFnProxy;
    if (mode.startsWith('auto_')) {
        otpFnProxy = async () => {
            logger.info(`[#${threadId}] Menunggu OTP dari LuckMail untuk ${currentEmail}...`);
            const code = await luckMailApi.fetchVerificationCode(token, currentEmail);
            if (!code) throw new Error("Timeout mengambil OTP dari LuckMail");
            return code;
        };
    } else {
        otpFnProxy = async () => {
            logger.info(`[#${threadId}] Kode verifikasi dikirim ke ${currentEmail} — cek inbox.`);
            return await telegramHandler.askTelegramUser(chatId, `Masukkan kode verifikasi untuk ${currentEmail}: `, `[#${threadId}] `);
        };
    }

    try {
        await telegramHandler.asyncLocalStorage.run(chatId, async () => {
            if (mode === 'retry_autopay') {
                logger.info(`Proses Retry Autopay...`);
                // Load account detail from db
                const acc = db.getAccount(currentEmail);
                if (!acc || !acc.accessToken) {
                    telegramHandler.updateStatusFor(chatId, `⚠️ <b>SESSION EXPIRED</b>\nData akun atau Access Token tidak (lagi) tersedia di database.`);
                    return;
                }
                
                const autopay = new ChatGPTAutopay({
                    email: currentEmail, password, name, gopayPhone, gopayPin,
                    threadId, sharedCycleTLS: localCycleTLS,
                    accessToken: acc.accessToken,
                    skipLogin: true,
                    otpFn: otpFnProxy
                });

                telegramHandler.updateStatusFor(chatId, `💳 <b>Retrying Payment...</b>\n<i>Bypassing login via cached token...</i>`);
                const aRes = await autopay.runAutopay();
                await handleAutopayResult(chatId, currentEmail, password, aRes);

            } else if (mode === 'signup' || mode === 'autopay' || mode === 'auto_signup' || mode === 'auto_autopay') {
                const signup = new ChatGPTSignup({
                    email: currentEmail, password, name, birthdate: bday.full,
                    clientId, redirectUri, audience,
                    webmailProvider: "manual", threadId, 
                    sharedCycleTLS: localCycleTLS,
                    otpFn: otpFnProxy // override otp prompt 
                });

                logger.info(`Proses pendaftaran sedang berjalan...`);
                telegramHandler.updateStatusFor(chatId, `📝 <b>Registering Account...</b>\n<i>Please wait for system response...</i>`);
                
                const sRes = await signup.runSignup();
                if (!sRes.success) {
                    logger.error(`Pendaftaran gagal: ${sRes.error}`);
                    if (purchaseId) luckMailApi.cancelEmail(purchaseId);
                    telegramHandler.updateStatusFor(chatId, `🚫 <b>REGISTRATION FAILED</b>\n━━━━━━━━━━━━━━━━━━\n⚠️ Reason: <code>${sRes.error}</code>`);
                    return;
                }

                db.saveAccount(sRes.email, { userId, password: sRes.password, accountType: 'Free', accessToken: sRes.accessToken });

                if (mode === 'autopay' || mode === 'auto_autopay') {
                    logger.info(`Proses pembayaran GoPay...`);
                    if (!gopayPhone || !gopayPin) {
                        telegramHandler.updateStatusFor(chatId, `⚠️ <b>GOPAY NOT CONFIGURED</b>\nRegistration success, but payment was skipped.`);
                        return;
                    }

                    const autopay = new ChatGPTAutopay({
                        email: currentEmail, password, name, gopayPhone, gopayPin,
                        threadId, sharedCycleTLS: localCycleTLS,
                        accessToken: sRes.accessToken,
                        skipLogin: true,
                        otpFn: otpFnProxy
                    });

                    telegramHandler.updateStatusFor(chatId, `💳 <b>Initiating Payment...</b>\n<i>Processing GoPay transaction...</i>`);
                    const aRes = await autopay.runAutopay();
                    await handleAutopayResult(chatId, currentEmail, password, aRes);
                } else {
                    telegramHandler.updateStatusFor(chatId, `✅ <b>REGISTRATION SUCCESS</b>\n━━━━━━━━━━━━━━━━━━\n📧 Email: <code>${currentEmail}</code>\n🔑 Password: <code>${password}</code>\n💎 Mode: <b>Signup Only</b>`);
                }
            } else if (mode === 'login_autopay' || mode === 'auto_loginpay') {
                logger.info(`Proses Login + Autopay...`);
                if (!gopayPhone || !gopayPin) {
                    telegramHandler.updateStatusFor(chatId, `⚠️ <b>GOPAY NOT CONFIGURED</b>\nLogin cancelled due to missing payment info.`);
                    return;
                }

                const autopay = new ChatGPTAutopay({
                    email: currentEmail, password, name, gopayPhone, gopayPin,
                    threadId, sharedCycleTLS: localCycleTLS,
                    otpFn: otpFnProxy
                });

                telegramHandler.updateStatusFor(chatId, `🔑 <b>Authenticating...</b>\n<i>Checking account credentials...</i>`);
                const aRes = await autopay.runAutopay();
                await handleAutopayResult(chatId, currentEmail, password, aRes);
            }
        });
    } catch (err) {
        logger.error(`Kesalahan: ${err.message}`);
        if (purchaseId) luckMailApi.cancelEmail(purchaseId);
        telegramHandler.updateStatusFor(chatId, `🔥 <b>SYSTEM CRITICAL ERROR</b>\n━━━━━━━━━━━━━━━━━━\n<code>${err.message}</code>`);
    } finally {
        try {
            await localCycleTLS.exit();
        } catch (e) {}
        logger.divider();
    }
}

async function handleAutopayResult(chatId, email, password, aRes) {
    if (aRes.success) {
        logger.success(`Autopay sukses untuk ${email}`);
        
        // Update DB Account to Plus
        const acc = db.getAccount(email);
        if (acc) db.saveAccount(email, { accountType: 'Plus' });

        telegramHandler.updateStatusFor(chatId,
            `🎉 <b>PREMIUM ACTIVATED!</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `📧 Email    : <code>${email}</code>\n` +
            `🔑 Password : <code>${password}</code>\n` +
            `⭐ Status   : <b>ChatGPT Plus (ACTIVE)</b>\n\n` +
            `<i>Account is ready for use. Enjoy!</i>`
        );
    } else {
        logger.warn(`Autopay gagal: ${aRes.error}`);
        // Store account as Free if it doesn't exist
        const acc = db.getAccount(email);
        if (!acc) db.saveAccount(email, { password, accountType: 'Free' });

        // Build inline markup for Retry Pay
        let inlineObj = null;
        if (acc && acc.accessToken) {
            inlineObj = { email, mode: 'failed_autopay' };
            // In telegramHandler, if mode=failed_autopay we attach Retry Pay button
        }

        telegramHandler.updateStatusFor(chatId,
            `⚠️ <b>PAYMENT ISSUE</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `✅ Terdaftar: <b>SUCCESS</b>\n` +
            `❌ Payment  : <b>FAILED</b>\n\n` +
            `📝 Detail   : <i>${aRes.error}</i>\n` +
            `<i>Jika error server, coba lagi dengan "Retry Pay".</i>`,
            inlineObj
        );
    }
}

async function main() {
    console.clear();
    console.log(chalk.cyan.bold(`
   ███████╗██╗   ██╗██╗   ██╗███████╗███╗   ██╗ ██████╗ ██╗  ██╗
      ███╔╝╚██╗ ██╔╝██║   ██║██╔════╝████╗  ██║██╔═══██╗╚██╗██╔╝
     ███╔╝  ╚████╔╝ ██║   ██║█████╗  ██╔██╗ ██║██║   ██║ ╚███╔╝ 
    ███╔╝    ╚██╔╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██║   ██║ ██╔██╗ 
   ███████╗   ██║    ╚████╔╝ ███████╗██║ ╚████║╚██████╔╝██╔╝ ██╗
   ╚══════╝   ╚═╝     ╚═══╝  ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝
    `));
    console.log(chalk.white.bold('        GPT Creator  -  ZYVENOX (MULTI-USER EDITION)'));
    console.log(chalk.gray('  ──────────────────────────────────────────────────────────────'));

    // Setup Worker Pool hook
    workerPool.setTaskProcessor(handleAccountTask);

    // Initialize Telegram Bot 
    telegramHandler.initTelegram();

    // Logger info can remain global, but status updates are per-chat so we don't bind global logger to telegram status
    // Telegram will just log general errors to console
    logger.info('🛰️  <b>SYSTEM ONLINE</b>\nBot siap menerima request multi-user...');
}

// Handle internal restart signals from telegramHandler
telegramHandler.setRestartCallback(() => {
    main().catch(err => logger.error("Fatal Error during reset:", err));
});

// Handle SIGINT (Ctrl+C) for clean exit
process.on('SIGINT', async () => {
    logger.info("Menerima sinyal interupsi (Ctrl+C). Menutup sistem...");
    telegramHandler.stopTelegram();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    telegramHandler.stopTelegram();
    process.exit(0);
});

main().catch(err => {
    logger.error("Fatal Error:", err);
});
