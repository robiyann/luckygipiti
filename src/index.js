require("dotenv").config();
require('events').EventEmitter.defaultMaxListeners = 50; // Fix: multi-worker concurrent socket listeners
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const ChatGPTSignup = require("./signup");
const ChatGPTAutopay = require("./autopay");
const { generateRandomName, generateRandomBirthday } = require("./utils/emailGenerator");
const initCycleTLS = require("cycletls");
const logger = require("./utils/logger");
const luckMailApi = require("./utils/luckMailApi");
const tMailApi = require("./utils/tMailApi");
const { claimGopaySlot, releaseGopaySlot, triggerMacrodroidWebhook, resetAllGopaySlots } = require("./utils/gopayOtpFetcher");
const { acquireGopaySlot } = require("./utils/gopayClaimQueue");
const { generateStrongPassword } = require("./utils/passwordGenerator");

const db = require("./db");
const workerPool = require("./workerPool");
const telegramHandler = require("./telegramHandler");

const clientId = "app_X8zY6vW2pQ9tR3dE7nK1jL5gH";
const redirectUri = "https://chatgpt.com/api/auth/callback/openai";
const audience = "https://api.openai.com/v1";

// Function to run account creation task in isolation
async function handleAccountTask(task) {
    const { userId, chatId, email, mode, staticPassword, mailProvider, cancelToken } = task;
    const isTMail = mailProvider === 'tmail';
    
    // Fetch user settings from DB
    const userData = db.getUser(userId);
    if (!userData) {
        telegramHandler.updateStatusFor(chatId, `🚫 <b>SYSTEM ERROR</b>\nUser data not found.`);
        return;
    }

    // Ambil T-Mail URL dari user settings (fallback ke default jika belum diset)
    const tmailBaseUrl = userData.tmailBaseUrl || undefined;

    // Resolve effective password berdasarkan passwordMode user
    let effectivePassword;
    const passwordMode = userData.passwordMode || 'random';
    if (passwordMode === 'static') {
        // Prioritas: password dari task > password dari profil user > generate random
        effectivePassword = staticPassword || userData.staticPassword || generateStrongPassword();
    } else {
        // Mode random: generate baru setiap task
        effectivePassword = generateStrongPassword();
    }

    const threadId = Math.floor(Math.random() * 900) + 100;

    const modeName = {
        'autopay': 'Signup + Autopay',
        'auto_autopay': 'Auto Signup + Autopay',
        'auto_signup': 'Auto Signup Only',
        'retry_autopay': 'Retry Autopay'
    }[mode] || mode;

    const name = generateRandomName();
    const bday = generateRandomBirthday();

    let currentEmail = email;
    let token = null;
    let purchaseId = null;

    if (mode === 'auto_signup' || mode === 'auto_autopay') {
        const maxLuckRetries = 3;
        for (let attempt = 1; attempt <= maxLuckRetries; attempt++) {
            // Check cancellation before each attempt
            if (cancelToken && cancelToken.cancelled) {
                logger.warn(`[#${threadId}] Task cancelled by user before email purchase.`);
                return { success: false, email: '', error: 'Cancelled by user', mailProvider };
            }
            try {
                const providerName = isTMail ? 'T-Mail' : 'LuckMail';
                telegramHandler.updateStatusFor(chatId, `🛒 <b>Purchasing Email via ${providerName}...</b>${attempt > 1 ? ` (Retry ${attempt}/${maxLuckRetries})` : ''}`);
                
                let purchase;
                if (isTMail) {
                    purchase = await tMailApi.generateEmail(tmailBaseUrl, userData.tmailApiKey);
                    purchase.purchaseId = null;
                } else {
                    const luckDomains = userData.luckMailDomains ? userData.luckMailDomains.split(',').map(d => d.trim()).filter(Boolean) : [];
                    purchase = await luckMailApi.purchaseEmail(userData.luckMailApiKey, luckDomains);
                }
                
                currentEmail = purchase.email;
                token = purchase.token;
                purchaseId = purchase.purchaseId;
                telegramHandler.updateStatusFor(chatId, `🛒 <b>Email Acquired:</b> <code>${currentEmail}</code>`);
                break;
            } catch (e) {
                if (attempt === maxLuckRetries) {
                    const providerName = isTMail ? 'T-MAIL' : 'LUCKMAIL';
                    telegramHandler.updateStatusFor(chatId, `🚳 <b>${providerName} FAILED</b>\n${e.message}`);
                    return { success: false, email: '', error: `${providerName}: ${e.message}`, mailProvider };
                }
                logger.warn(`Email purchase attempt ${attempt} failed: ${e.message}. Retrying in 5s...`);
                // Interruptible 5s wait — check cancel every 500ms
                for (let w = 0; w < 10; w++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (cancelToken && cancelToken.cancelled) {
                        return { success: false, email: '', error: 'Cancelled by user', mailProvider };
                    }
                }
            }
        }
    }

    // Check if cancelled before initializing heavy browser engine
    if (cancelToken && cancelToken.cancelled) {
        return { success: false, email: currentEmail, error: 'Cancelled by user', mailProvider };
    }

    telegramHandler.updateStatusFor(chatId, `🚀 <b>Initializing Task...</b>`, { email: currentEmail || email, mode, name });

    logger.account(currentEmail || email);
    logger.info(`Mode: ${modeName} - User: ${userId}`);
    logger.info(`Menginisialisasi engine...`);

    const otpServerUrl = process.env.OTP_SERVER_URL;
    let activeSlot = null;

    // --- GOPAY POOL CLAIM ---
    const isAutopayMode = mode.includes('autopay') || mode.includes('auto_loginpay');
    if (otpServerUrl && isAutopayMode) {
        logger.info(`[Pool] Mencari slot GoPay yang tersedia...`);
        telegramHandler.updateStatusFor(chatId, `⌛ <b>Waiting for GoPay Slot...</b>\nBot is processing in turns, please wait...`);
        
        try {
            // New fair queue system: wait until a slot is granted by coordinator
            activeSlot = await acquireGopaySlot(userId, otpServerUrl);
            logger.success(`[Pool] Berhasil mengunci Slot #${activeSlot.id} (${activeSlot.phone})`);
        } catch (err) {
            telegramHandler.updateStatusFor(chatId, `🚫 <b>POOL ERROR</b>\nPayment system failed to claim a GoPay slot from server: ${err.message}`);
            return { success: false, email: currentEmail, error: "GoPay Pool Error" };
        }
        
        if (!activeSlot) {
            telegramHandler.updateStatusFor(chatId, `🚫 <b>POOL ERROR</b>\nPayment system could not claim a GoPay slot. Please contact admin.`);
            return { success: false, email: currentEmail, error: "GoPay Pool Mandatory but Unavailable" };
        }
    }

    // In multi-user context, we create a fresh CycleTLS instance for this run
    const localCycleTLS = await initCycleTLS();
    
    // FORCED POOL LOGIC: Always use slot data, no fallback to user profile
    const finalGopayPhone = activeSlot ? activeSlot.phone : null;
    const finalGopayPin = activeSlot ? activeSlot.pin : null;
    const finalServerNum = activeSlot ? String(activeSlot.id) : '1';
    const finalWebhook = activeSlot ? activeSlot.webhook_action : 'reset-link';

    if (isAutopayMode && !finalGopayPhone) {
        telegramHandler.updateStatusFor(chatId, `⚠️ <b>SYSTEM ERROR</b>\nGoPay pool is not configured. Autopay cancelled.`);
        await localCycleTLS.exit().catch(()=>{});
        return { success: false, error: "Missing Pool Data" };
    }

    // Proxy OTP function based on mode
    let otpFnProxy;
    if (mode.startsWith('auto_')) {
        otpFnProxy = async () => {
            logger.info(`[#${threadId}] Waiting for OTP from ${isTMail ? 'T-Mail' : 'LuckMail'} for ${currentEmail}...`);
            let code;
            if (isTMail) {
                code = await tMailApi.fetchVerificationCode(token, currentEmail, tmailBaseUrl);
            } else {
                code = await luckMailApi.fetchVerificationCode(token, currentEmail, userData.luckMailApiKey);
            }
            if (!code) throw new Error(`Timeout fetching OTP from ${isTMail ? 'T-Mail' : 'LuckMail'}`);
            return code;
        };
    } else {
        otpFnProxy = async () => {
            logger.info(`[#${threadId}] Verification code sent to ${currentEmail} — check inbox.`);
            return await telegramHandler.askTelegramUser(chatId, `Enter the verification code for ${currentEmail}: `, `[#${threadId}] `);
        };
    }

    try {
        const result = await telegramHandler.asyncLocalStorage.run(chatId, async () => {
            if (mode === 'retry_autopay') {
                logger.info(`Retrying Autopay...`);
                // Load account detail from db
                const acc = db.getAccount(currentEmail);
                if (!acc || !acc.accessToken) {
                    telegramHandler.updateStatusFor(chatId, `⚠️ <b>SESSION EXPIRED</b>\nData akun atau Access Token tidak (lagi) tersedia di database.`);
                    if (activeSlot) await releaseGopaySlot(otpServerUrl, activeSlot.id);
                    return { success: false, email: currentEmail, error: 'Session expired / Access Token tidak ada', mailProvider };
                }
                
                const autopay = new ChatGPTAutopay({
                    email: currentEmail, password: effectivePassword, name, 
                    gopayPhone: finalGopayPhone, gopayPin: finalGopayPin,
                    serverNumber: finalServerNum, webhookAction: finalWebhook,
                    threadId, sharedCycleTLS: localCycleTLS,
                    accessToken: acc.accessToken,
                    skipLogin: true,
                    otpFn: otpFnProxy
                });

                telegramHandler.updateStatusFor(chatId, `💳 <b>Retrying Payment...</b>\n<i>Bypassing login via cached token...</i>`);
                const aRes = await autopay.runAutopay();
                
                // Pool cleanup: hanya release karena unlink sudah diawait 100% di dalam runAutopay()
                if (activeSlot) {
                    await releaseGopaySlot(otpServerUrl, activeSlot.id).catch(() => {});
                }

                await handleAutopayResult(chatId, currentEmail, effectivePassword, aRes, mailProvider);
                // Ekstrak refresh token dari cookie jar jika ada
                let refreshToken = null;
                if (aRes.cookieJar) {
                   const authCookies = aRes.cookieJar.store.get("auth.openai.com");
                   if (authCookies) refreshToken = authCookies.get("__Secure-next-auth.refresh-token");
                }
                // Kembalikan result lengkap dengan accountType yang sudah diupdate
                return { 
                    ...aRes, 
                    email: currentEmail, 
                    password: effectivePassword, 
                    refreshToken,
                    mailToken: token,
                    mailProvider,
                    accountType: aRes.success ? 'Plus' : (aRes.accountType || 'Free') 
                };
            } else if (mode === 'signup' || mode === 'autopay' || mode === 'auto_signup' || mode === 'auto_autopay') {
                const signup = new ChatGPTSignup({
                    email: currentEmail, password: effectivePassword, name, birthdate: bday.full,
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
                    if (activeSlot) await releaseGopaySlot(otpServerUrl, activeSlot.id);
                    telegramHandler.updateStatusFor(chatId, `🚫 <b>REGISTRATION FAILED</b>\n━━━━━━━━━━━━━━━━━━\n⚠️ Reason: <code>${sRes.error}</code>`);
                    return { success: false, email: currentEmail, error: sRes.error, mailProvider };
                }

                let refreshToken = null;
                if (sRes.cookies) {
                    const cookieStr = typeof sRes.cookies === 'string' ? sRes.cookies : JSON.stringify(sRes.cookies);
                    const match = cookieStr.match(/__Secure-next-auth\.session-token=([^;"]+)/);
                    if (match && match[1]) refreshToken = match[1];
                }

                db.saveAccount(sRes.email, { 
                    userId, 
                    password: effectivePassword, 
                    accountType: 'Free', 
                    accessToken: sRes.accessToken,
                    refreshToken: refreshToken 
                });

                if (mode === 'autopay' || mode === 'auto_autopay') {
                    logger.info(`Proses pembayaran GoPay...`);
                    // activeSlot is now mandatory
                    if (!activeSlot) {
                        telegramHandler.updateStatusFor(chatId, `⚠️ <b>POOL SIBUK</b>\nRegistrasi berhasil, tapi slot GoPay tidak tersedia. Silakan lakukan Retry Autopay nanti.`);
                        return { success: false, email: currentEmail, password: effectivePassword, accountType: 'Free', error: "GoPay Pool Not Available", mailProvider };
                    }

                    const autopay = new ChatGPTAutopay({
                        email: currentEmail, password: effectivePassword, name, 
                        gopayPhone: finalGopayPhone, gopayPin: finalGopayPin,
                        serverNumber: finalServerNum, webhookAction: finalWebhook,
                        threadId, sharedCycleTLS: localCycleTLS,
                        accessToken: sRes.accessToken,
                        skipLogin: true,
                        otpFn: otpFnProxy
                    });

                    telegramHandler.updateStatusFor(chatId, `💳 <b>Initiating Payment...</b>\n<i>Processing GoPay transaction...</i>`);
                    const aRes = await autopay.runAutopay();

                    // Pool cleanup: hanya release karena unlink sudah diawait 100% di dalam runAutopay()
                    if (activeSlot) {
                        await releaseGopaySlot(otpServerUrl, activeSlot.id).catch(() => {});
                    }

                    await handleAutopayResult(chatId, currentEmail, effectivePassword, aRes, mailProvider);
                    // Ekstrak refresh token dari cookie jar jika ada
                    let refreshToken = null;
                    if (aRes.cookies) {
                       const authCookies = aRes.cookies.store.get("auth.openai.com");
                       if (authCookies) refreshToken = authCookies.get("__Secure-next-auth.refresh-token");
                    }
                    return { 
                        ...aRes, 
                        email: currentEmail, 
                        password: effectivePassword, 
                        refreshToken,
                        mailToken: token,
                        mailProvider,
                        accountType: aRes.success ? 'Plus' : (aRes.accountType || 'Free') 
                    };
                } else {
                    if (activeSlot) await releaseGopaySlot(otpServerUrl, activeSlot.id);
                    telegramHandler.updateStatusFor(chatId, `✅ <b>REGISTRATION SUCCESS</b>\n━━━━━━━━━━━━━━━━━━\n📧 Email: <code>${currentEmail}</code>\n🔑 Password: <code>${effectivePassword}</code>\n💎 Mode: <b>Signup Only</b>`);
                    return { success: true, email: currentEmail, password: effectivePassword, accountType: 'Free', mailToken: token, mailProvider };
                }
            }
        });
        return result;
    } catch (err) {
        logger.error(`Kesalahan: ${err.message}`);
        if (purchaseId) luckMailApi.cancelEmail(purchaseId);
        if (activeSlot) await releaseGopaySlot(otpServerUrl, activeSlot.id).catch(()=>{});
        telegramHandler.updateStatusFor(chatId, `🔥 <b>SYSTEM CRITICAL ERROR</b>\n━━━━━━━━━━━━━━━━━━\n<code>${err.message}</code>`);
        return { success: false, email: currentEmail, error: err.message, mailProvider };
    } finally {
        try {
            await localCycleTLS.exit();
        } catch (e) {}
        logger.divider();
    }
}

async function handleAutopayResult(chatId, email, password, aRes, mailProvider) {
    const state = telegramHandler.getUserState(chatId);
    
    // Referral Bonus Function
    const checkAndRewardReferrer = (userId) => {
        const u = db.getUser(userId);
        if (u && u.referredBy && !u.referralRewarded) {
            db.addPoints(u.referredBy, 1);
            db.incrementStat(u.referredBy, 'totalReferralsEarned');
            db.saveUser(userId, { referralRewarded: true });
        }
    };

    if (aRes.success) {
        logger.success(`Autopay sukses untuk ${email}`);
        
        // Update DB Account to Plus
        const acc = db.getAccount(email);
        if (acc) db.saveAccount(email, { accountType: 'Plus' });

        // Deduct points on SUCCESS
        const cost = mailProvider === 'manual' ? 1 : 4;
        try {
            db.deductPoints(chatId, cost);
            db.incrementStat(chatId, 'totalPlusCreated');
            checkAndRewardReferrer(chatId);
        } catch (e) {
            logger.error(`[Pool] Gagal memotong point user ${chatId}: ${e.message}`);
        }
        db.incrementStat(chatId, 'totalAccountsCreated');

        // Jika dalam mode batch, jangan kirim pesan PREMIUM ACTIVATED per-akun agar tidak nyampah
        if (state && state.isBatchMode) {
            return;
        }

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
        
        db.incrementStat(chatId, 'totalAccountsCreated'); // Tetap hitung sebagai account created meskipun free

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

    // Reset semua slot GoPay ke available (recovery dari crash/restart sebelumnya)
    const otpServerUrl = process.env.OTP_SERVER_URL;
    if (otpServerUrl) {
        await resetAllGopaySlots(otpServerUrl);
    }

    // Logger info can remain global, but status updates are per-chat so we don't bind global logger to telegram status
    // Telegram will just log general errors to console
    logger.info('🛰️  <b>SYSTEM ONLINE</b>\nBot siap menerima request multi-user...');

    // Recovery: kirim batch progress yang belum selesai dari session sebelumnya
    setTimeout(() => {
        telegramHandler.recoverPendingBatchReports();
    }, 3000);
}

// Handle internal restart signals from telegramHandler
telegramHandler.setRestartCallback(() => {
    main().catch(err => logger.error("Fatal Error during reset:", err));
});

// Handle SIGINT (Ctrl+C) for clean exit
process.on('SIGINT', async () => {
    logger.info("Menerima sinyal interupsi (Ctrl+C). Menutup sistem...");
    telegramHandler.stopTelegram();
    const otpUrl = process.env.OTP_SERVER_URL;
    if (otpUrl) await resetAllGopaySlots(otpUrl).catch(() => {});
    process.exit(0);
});

process.on('SIGTERM', async () => {
    telegramHandler.stopTelegram();
    const otpUrl = process.env.OTP_SERVER_URL;
    if (otpUrl) await resetAllGopaySlots(otpUrl).catch(() => {});
    process.exit(0);
});

main().catch(err => {
    logger.error("Fatal Error:", err);
});
