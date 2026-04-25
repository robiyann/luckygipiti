const axios = require('axios');
const logger = require('./logger');

/**
 * Polling GoPay OTP dari OTP Server VPS (MacroDroid forwarding).
 *
 * @param {string} gopayPhone - Nomor HP GoPay
 * @param {string} serverUrl  - Base URL OTP server
 * @param {string} serverNumber - ID Server/Slot (default '1')
 */
async function fetchGopayOtp(gopayPhone, serverUrl, serverNumber = '1') {
    const baseUrl = serverUrl.replace(/\/$/, '');
    const maxAttempts = 25;
    const delayMs = 3000;
    const phone = String(gopayPhone).replace(/^0|^\+62/, '');

    logger.info(`[GoPay OTP] Subscribe OTP (Srv #${serverNumber}) untuk nomor: ${phone}...`);

    // 1. Daftar sebagai subscriber
    let requestId;
    try {
        const subRes = await axios.post(`${baseUrl}/otp/subscribe`,
            { phone, server: String(serverNumber) },
            { timeout: 5000 }
        );
        requestId = subRes.data.requestId;
        logger.info(`[GoPay OTP] Subscription aktif: ${requestId}`);
    } catch (err) {
        throw new Error(`[GoPay OTP] Gagal subscribe: ${err.message}`);
    }

    // 2. Poll /otp/claim/:requestId
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            const response = await axios.get(`${baseUrl}/otp/claim/${requestId}`, { timeout: 5000 });
            if (response.data && response.data.otp) {
                logger.success(`[GoPay OTP] Kode ditemukan: ${response.data.otp}`);
                return response.data.otp;
            }
        } catch (err) {
            if (err.response && err.response.status === 404) {
                // Belum ada OTP, lanjut polling
            } else {
                logger.warn(`[GoPay OTP] Poll error: ${err.message}`);
            }
        }
        if (i % 3 === 0) {
            logger.info(`[GoPay OTP] Masih menunggu... (${(i + 1) * delayMs / 1000}s)`);
        }
    }

    throw new Error(`[GoPay OTP] Timeout: OTP tidak diterima dalam ${maxAttempts * delayMs / 1000} detik`);
}

/**
 * Trigger MacroDroid webhook via OTP server.
 */
async function triggerMacrodroidWebhook(serverUrl, action = 'reset-link') {
    const baseUrl = serverUrl.replace(/\/$/, '');
    const response = await axios.get(`${baseUrl}/trigger-hp`, {
        params: { action },
        timeout: 5000
    });
    if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status} for trigger-hp`);
    }
    logger.success(`[GoPay OTP] Webhook "${action}" berhasil di-trigger`);
    return true;
}

/**
 * Menunggu status "reset done" dari server.
 */
async function waitForGopayReset(serverUrl, serverNumber = '1', maxWaitSeconds = 60) {
    const baseUrl = serverUrl.replace(/\/$/, '');
    const delayMs = 3000;
    const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / delayMs);

    logger.info(`[GoPay OTP] Menunggu status "reset done" dari HP #${serverNumber}...`);

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await axios.get(`${baseUrl}/otp`, { 
                params: { server: serverNumber },
                timeout: 5000 
            });
            
            if (response.data && response.data.status === "reset done") {
                logger.success(`[GoPay OTP] HP #${serverNumber} Mengonfirmasi: RESET DONE ✓`);
                return true;
            }
        } catch (err) {
            // Ignore poll errors
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    logger.warn(`[GoPay OTP] Timeout menunggu reset done HP #${serverNumber}. Melanjutkan.`);
    return false;
}

/**
 * Claim slot dari pool OTPServer
 */
async function claimGopaySlot(serverUrl) {
    const baseUrl = serverUrl.replace(/\/$/, '');
    try {
        const response = await axios.get(`${baseUrl}/gopay/claim`, { timeout: 5000 });
        return response.data; // { id, phone, pin, webhook_action }
    } catch (err) {
        if (err.response && err.response.status === 503) {
            return null; // All busy
        }
        throw err;
    }
}

/**
 * Release slot secara manual (biasanya jika autopay gagal total)
 */
async function releaseGopaySlot(serverUrl, slotId) {
    const baseUrl = serverUrl.replace(/\/$/, '');
    try {
        await axios.get(`${baseUrl}/gopay/release`, { 
            params: { id: slotId },
            timeout: 5000 
        });
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Reset SEMUA slot ke available (dipanggil saat bot startup/restart)
 */
async function resetAllGopaySlots(serverUrl) {
    const baseUrl = serverUrl.replace(/\/$/, '');
    try {
        const res = await axios.get(`${baseUrl}/gopay/reset-all`, { timeout: 5000 });
        logger.info(`[Pool] Startup reset: semua slot dikembalikan ke available.`);
        return res.data;
    } catch (err) {
        logger.warn(`[Pool] Startup reset gagal: ${err.message}`);
        return null;
    }
}

module.exports = { 
    fetchGopayOtp, 
    triggerMacrodroidWebhook, 
    waitForGopayReset,
    claimGopaySlot,
    releaseGopaySlot,
    resetAllGopaySlots
};
