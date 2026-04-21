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
    const maxAttempts = 20;
    const delayMs = 3000;
    const phone = String(gopayPhone).replace(/^0|^\+62/, '');

    logger.info(`[GoPay OTP] Menunggu OTP (Srv #${serverNumber}) untuk nomor: ${phone}...`);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            const response = await axios.get(`${serverUrl}/otp`, {
                params: { server: serverNumber, phone },
                timeout: 5000
            });

            const data = response.data;
            if (data && data.text) {
                const match = String(data.text).match(/\b(\d{4,6})\b/);
                if (match && match[1]) {
                    logger.success(`[GoPay OTP] Kode ditemukan: ${match[1]}`);
                    return match[1];
                }
            }
        } catch (err) {
            // 404 means no OTP yet
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
    const response = await axios.get(`${serverUrl}/trigger-hp`, {
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
    const delayMs = 3000;
    const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / delayMs);

    logger.info(`[GoPay OTP] Menunggu status "reset done" dari HP #${serverNumber}...`);

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await axios.get(`${serverUrl}/otp`, { 
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
    try {
        const response = await axios.get(`${serverUrl}/gopay/claim`, { timeout: 5000 });
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
    try {
        await axios.get(`${serverUrl}/gopay/release`, { 
            params: { id: slotId },
            timeout: 5000 
        });
        return true;
    } catch (err) {
        return false;
    }
}

module.exports = { 
    fetchGopayOtp, 
    triggerMacrodroidWebhook, 
    waitForGopayReset,
    claimGopaySlot,
    releaseGopaySlot
};
