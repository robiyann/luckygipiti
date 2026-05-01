const axios = require('axios');
const db = require('../db');
const logger = require('./logger');

const DEFAULT_BASE_URL = 'https://mail.zyvenox.my.id';

function createApiClient(baseUrl) {
    const proxyUrl = process.env.GENERAL_PROXY_URL;
    const opts = {
        baseURL: (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
    };
    if (proxyUrl) {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        opts.httpsAgent = new HttpsProxyAgent(proxyUrl);
        opts.proxy = false;
    }
    return axios.create(opts);
}

/**
 * Mengambil daftar domain yang tersedia dari T-MAIL API.
 * @param {string} [baseUrl] - Override base URL (dari user settings)
 * @returns {Promise<string[]>}
 */
async function getDomains(baseUrl) {
    try {
        const apiClient = createApiClient(baseUrl);
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
 * Generate email dari T-MAIL API.
 * @param {string} [baseUrl] - Override base URL (dari user settings)
 * @param {string} [apiKey] - API key T-Mail user
 * @param {string[]} [preferredDomains] - Domain pilihan user (dari tmailDomains settings). Jika tidak diset, pakai round-robin server.
 * @returns {Promise<{email: string, token: string}>}
 */
async function generateEmail(baseUrl, apiKey, preferredDomains) {
    try {
        const apiClient = createApiClient(baseUrl);
        const headers = apiKey ? { 'X-API-Key': apiKey } : {};

        let response;
        if (preferredDomains && preferredDomains.length > 0) {
            // Mode: User punya domain pilihan sendiri — pilih secara random dari list mereka
            const domain = preferredDomains[Math.floor(Math.random() * preferredDomains.length)];
            logger.info(`[T-Mail] Menggunakan domain pilihan user: ${domain} (dari ${preferredDomains.length} domain tersedia)`);
            response = await apiClient.post('/api/mailboxes/generate', { domain }, { headers });
        } else {
            // Mode: Tidak ada preferensi — gunakan round-robin server otomatis
            logger.info(`[T-Mail] Tidak ada domain preferensi, menggunakan server round-robin (/generate/auto)`);
            response = await apiClient.post('/api/mailboxes/generate/auto', {}, { headers });
        }

        if (response.data && response.data.address) {
            const email = response.data.address;
            const token = response.data.token || email;
            const domain = response.data.domain || email.split('@')[1];
            db.saveOrder(`tmail_${token}`, email, 'generated');
            logger.info(`[T-Mail] Email digenerate: ${email} | Domain: ${domain} | Token: ${token}`);
            return { email, token };
        }
        throw new Error(response.data ? JSON.stringify(response.data) : 'Unknown T-Mail API error');
    } catch (error) {
        logger.error(`[T-Mail] Gagal generate email: ${error.message}`);
        throw error;
    }
}

/**
 * Pre-check inbox T-Mail sebelum pendaftaran dimulai.
 * Jika sudah ada OTP di inbox (untuk email recycled), simpan ke cache agar di-ignore nanti.
 */
async function prewarmOtpCache(token, email, baseUrl) {
    try {
        const apiClient = createApiClient(baseUrl);
        const urlPath = `/api/mailboxes/token/${encodeURIComponent(token)}/otp?service=openai`;
        const response = await apiClient.get(urlPath);
        if (response.data && response.data.otp) {
            const existingOtp = String(response.data.otp);
            db.saveOtpCache(email, existingOtp);
            logger.info(`[T-Mail] Pre-warm: OTP ${existingOtp} ditemukan di inbox ${email}. Kode ini akan di-ignore.`);
            return existingOtp;
        }
    } catch (e) {
        // Abaikan error (biasanya 404 jika inbox kosong)
    }
    return null;
}

/**
 * Polling OTP dari T-MAIL API menggunakan endpoint /token/:token/otp?service=openai.
 * Poll setiap 3 detik, maksimal 15 kali.
 * Menggunakan OTP cache agar tidak mengembalikan kode lama.
 *
 * @param {string} token - Token untuk akses mail
 * @param {string} email - Alamat email untuk polling OTP
 * @param {string} [baseUrl] - Override base URL (dari user settings)
 * @returns {Promise<string|null>}
 */
async function fetchVerificationCode(token, email, baseUrl) {
    const maxRetries = 15;
    const delayMs = 3000;
    const lastOtp = db.getOtpCache(email);

    logger.info(`[T-Mail] Memulai polling OTP untuk ${email} via token...`);
    if (lastOtp) logger.debug(`[T-Mail] OTP sebelumnya: ${lastOtp}, akan di-ignore.`);
    logger.debug(`[T-Mail] Token yang digunakan: ${token}`);
    logger.debug(`[T-Mail] Base URL: ${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')}`);

    const apiClient = createApiClient(baseUrl);

    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            // Menggunakan token endpoint
            const urlPath = `/api/mailboxes/token/${encodeURIComponent(token)}/otp?service=openai`;
            const response = await apiClient.get(urlPath);
            if (response.data && response.data.otp) {
                const extractedOtp = String(response.data.otp);
                if (extractedOtp === lastOtp) {
                    logger.debug(`[T-Mail] OTP ${extractedOtp} adalah kode lama. Lanjut polling... (${i + 1}/${maxRetries})`);
                    continue;
                }
                logger.success(`[T-Mail] Kode verifikasi ditemukan: ${extractedOtp}`);
                db.saveOtpCache(email, extractedOtp);
                return extractedOtp;
            }
        } catch (error) {
            if (error.response && error.response.status === 404) {
                // Normal: OTP belum masuk, lanjut polling
                logger.debug(`[T-Mail] Belum ada OTP (404) untuk ${email} di iterasi ${i + 1}/${maxRetries}`);
            } else if (error.response) {
                logger.warn(`[T-Mail] Error HTTP ${error.response.status} saat polling OTP: ${JSON.stringify(error.response.data || '')}`);
            } else {
                logger.debug(`[T-Mail] Exception saat polling: ${error.message}`);
            }
        }
        if (i % 5 === 0) logger.info(`[T-Mail] Menunggu OTP untuk ${email}... (${(i + 1) * 2}s / 90s)`);
    }

    logger.warn(`[T-Mail] Timeout 90 detik tercapai. OTP tidak ditemukan untuk ${email}.`);
    return null;
}

module.exports = { getDomains, generateEmail, fetchVerificationCode };
