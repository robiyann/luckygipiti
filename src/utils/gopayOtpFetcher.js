const axios = require('axios');
const logger = require('./logger');

/**
 * Polling GoPay OTP dari OTP Server VPS (MacroDroid forwarding).
 * Looping tiap 3 detik, maksimal 60 detik (20 attempts).
 *
 * @param {string} gopayPhone - Nomor HP GoPay (tanpa +62), contoh: "85848101010"
 * @param {string} serverUrl  - Base URL OTP server, contoh: "http://146.190.85.126:3000"
 * @returns {Promise<string>} - Kode OTP (string) atau throw Error jika timeout
 */
async function fetchGopayOtp(gopayPhone, serverUrl) {
    const maxAttempts = 20;
    const delayMs = 3000;
    const phone = String(gopayPhone).replace(/^0|^\+62/, '');

    logger.info(`[GoPay OTP] Menunggu OTP dari server untuk nomor: ${phone}...`);

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            const response = await axios.get(`${serverUrl}/otp`, {
                params: { server: '1', phone },
                timeout: 5000
            });

            const data = response.data;
            if (data && data.text) {
                // Ekstrak kode 4–6 digit dari teks notifikasi
                const match = String(data.text).match(/\b(\d{4,6})\b/);
                if (match && match[1]) {
                    logger.success(`[GoPay OTP] Kode ditemukan: ${match[1]}`);
                    return match[1];
                }
            }
        } catch (err) {
            if (err.response && err.response.status === 404) {
                // Belum ada OTP masuk, lanjut polling
            } else {
                logger.debug(`[GoPay OTP] Poll error: ${err.message}`);
            }
        }

        if (i % 3 === 0) {
            logger.info(`[GoPay OTP] Masih menunggu... (${(i + 1) * delayMs / 1000}s/${maxAttempts * delayMs / 1000}s)`);
        }
    }

    throw new Error(`[GoPay OTP] Timeout: OTP tidak diterima dalam ${maxAttempts * delayMs / 1000} detik`);
}

/**
 * Trigger MacroDroid webhook via OTP server.
 * Wajib berhasil (throw error jika gagal agar bisa di-retry oleh caller).
 *
 * @param {string} serverUrl - Base URL OTP server
 * @param {string} action    - Nama action webhook, default: "reset-link"
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
 * Menunggu konfirmasi dari server (MacroDroid) bahwa proses reset/unlink selesai.
 * Melakukan polling ke server menunggu status "reset done".
 * 
 * @param {string} serverUrl - Base URL OTP server
 * @param {number} maxWaitSeconds - Maksimal menunggu (default 60s)
 */
async function waitForGopayReset(serverUrl, maxWaitSeconds = 60) {
    const delayMs = 3000;
    const maxAttempts = Math.ceil((maxWaitSeconds * 1000) / delayMs);

    logger.info(`[GoPay OTP] Menunggu status "reset done" dari HP...`);

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const response = await axios.get(`${serverUrl}/otp`, { 
                params: { server: '1' }, // Cek status terakhir di server
                timeout: 5000 
            });
            
            // Berdasarkan README, status masuk ke log dashboard. 
            // Kita asumsikan server VPS menyimpan status terakhir "reset done"
            // Jika servermu butuh endpoint spesifik (misal /status), sesuaikan di sini.
            // Untuk saat ini kita coba deteksi dari response server:
            if (response.data && response.data.status === "reset done") {
                logger.success(`[GoPay OTP] HP Mengonfirmasi: RESET DONE ✓`);
                return true;
            }
        } catch (err) {
            logger.debug(`[GoPay OTP] Reset poll error: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    logger.warn(`[GoPay OTP] Timeout menunggu reset done (${maxWaitSeconds}s). Melanjutkan dengan asumsi selesai.`);
    return false;
}

module.exports = { fetchGopayOtp, triggerMacrodroidWebhook, waitForGopayReset };
