const axios = require('axios');
const db = require('../db');
const logger = require('./logger');

// Base URL bisa diganti di .env kalau punya provider T-MAIL lain
const BASE_URL = process.env.TMAIL_BASE_URL || 'https://mail.zyvenox.my.id';

const proxyUrl = process.env.GENERAL_PROXY_URL;
const apiClientOpts = {
    baseURL: BASE_URL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
};

if (proxyUrl) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    apiClientOpts.httpsAgent = new HttpsProxyAgent(proxyUrl);
    apiClientOpts.proxy = false;
}

const apiClient = axios.create(apiClientOpts);

/**
 * Mengambil daftar domain yang tersedia dari T-MAIL API.
 * @returns {Promise<string[]>}
 */
async function getDomains() {
    try {
        const response = await apiClient.get('/api/domains');
        if (response.data && response.data.domains) {
            return response.data.domains;
        }
        throw new Error('Format response domains tidak valid');
    } catch (error) {
        logger.error(`[T-Mail] Gagal ambil daftar domain: ${error.message}`);
        throw error;
    }
}

/**
 * Generate email random dari T-MAIL API.
 * Menggunakan domain pertama yang tersedia.
 * @returns {Promise<{email: string, token: string}>}
 */
async function generateEmail() {
    try {
        // Ambil domain yang tersedia
        const domains = await getDomains();
        if (!domains || domains.length === 0) {
            throw new Error('Tidak ada domain T-Mail yang tersedia');
        }
        const domain = domains[Math.floor(Math.random() * domains.length)];

        logger.info(`[T-Mail] Generating random email dengan domain: ${domain}`);

        const response = await apiClient.post('/api/mailboxes/generate', { domain });

        if (response.data && response.data.address) {
            const email = response.data.address;
            // Simpan ke orders.json (token = email karena T-Mail tidak menggunakan token terpisah)
            db.saveOrder(`tmail_${email}`, email, 'generated');
            logger.info(`[T-Mail] Email berhasil digenerate: ${email}`);
            return { email, token: email };
        }
        throw new Error(response.data ? JSON.stringify(response.data) : 'Unknown T-Mail API error');
    } catch (error) {
        logger.error(`[T-Mail] Gagal generate email: ${error.message}`);
        throw error;
    }
}

/**
 * Polling OTP dari T-MAIL API menggunakan endpoint /otp?service=openai.
 * Poll setiap 2 detik, maksimal 10 kali (20 detik).
 * Menggunakan OTP cache agar tidak mengembalikan kode lama.
 * 
 * @param {string} _token - Token (tidak digunakan di T-Mail, email = token)
 * @param {string} email - Alamat email untuk polling OTP
 * @returns {Promise<string|null>} - Kode OTP 6-digit atau null jika timeout
 */
async function fetchVerificationCode(_token, email) {
    const maxRetries = 10;
    const delayMs = 2000;
    const lastOtp = db.getOtpCache(email);

    logger.info(`[T-Mail] Memulai polling OTP untuk ${email}...`);
    if (lastOtp) {
        logger.debug(`[T-Mail] OTP sebelumnya: ${lastOtp}, akan di-ignore.`);
    }

    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, delayMs));

            const response = await apiClient.get(`/api/mailboxes/${encodeURIComponent(email)}/otp?service=openai`);

            if (response.data && response.data.otp) {
                const extractedOtp = String(response.data.otp);

                // Validasi: jangan kembalikan OTP lama
                if (extractedOtp === lastOtp) {
                    logger.debug(`[T-Mail] OTP ${extractedOtp} adalah kode lama. Lanjut polling... (${i + 1}/${maxRetries})`);
                    continue;
                }

                logger.success(`[T-Mail] Kode verifikasi ditemukan: ${extractedOtp}`);
                db.saveOtpCache(email, extractedOtp);
                return extractedOtp;
            }
        } catch (error) {
            // 404 = belum ada email OTP, itu normal — lanjut polling
            if (error.response && error.response.status === 404) {
                // Normal: OTP belum masuk
            } else {
                logger.debug(`[T-Mail] Exception saat polling: ${error.message}`);
            }
        }

        if (i % 2 === 0) {
            logger.info(`[T-Mail] Menunggu OTP untuk ${email}... (${(i + 1) * 2}s)`);
        }
    }

    logger.warn(`[T-Mail] Timeout 20 detik tercapai. OTP tidak ditemukan untuk ${email}.`);
    return null;
}

module.exports = {
    getDomains,
    generateEmail,
    fetchVerificationCode
};
