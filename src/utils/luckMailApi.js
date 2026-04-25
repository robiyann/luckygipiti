const axios = require('axios');
const db = require('../db');
const logger = require('./logger');

const API_KEY = process.env.LUCKMAIL_API_KEY;
if (!API_KEY) {
    console.error("\x1b[31m[ERROR] LUCKMAIL_API_KEY tidak ditemukan di .env!\x1b[0m");
    process.exit(1);
}
const BASE_URL = "https://mails.luckyous.com/api/v1/openapi";

const ALLOWED_DOMAINS = ["outlook.jp", "outlook.com"];

const apiClientOpts = {
    baseURL: BASE_URL,
    headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
    }
};

const proxyUrl = process.env.GENERAL_PROXY_URL;
if (proxyUrl) {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    apiClientOpts.httpsAgent = new HttpsProxyAgent(proxyUrl);
    apiClientOpts.proxy = false; // Disable axios default proxy handling
}

const apiClient = axios.create(apiClientOpts);

/**
 * Membeli slot email baru dari LuckMail (Random Outlook Domain)
 * @returns {Promise<{orderId: string, email: string}>}
 */
async function purchaseEmail() {
    try {
        // Pilih domain secara acak
        const randomDomain = ALLOWED_DOMAINS[Math.floor(Math.random() * ALLOWED_DOMAINS.length)];
        logger.info(`[LuckMail] Menyiapkan pembelian email dengan domain: ${randomDomain}`);

        const response = await apiClient.post('/email/purchase', {
            project_code: "openai",
            email_type: "ms_imap",
            domain: randomDomain,
            quantity: 1,
            variant_mode: ""
        });

        const resData = response.data;
        if (resData && resData.data && resData.data.purchases && resData.data.purchases[0]) {
            const purchase = resData.data.purchases[0];
            const token = purchase.token;
            const email = purchase.email_address;
            const purchaseId = purchase.id;

            // Simpan riwayat pembelian ke database orders.json (kita simpan token sebagai ID utilitasnya)
            db.saveOrder(token, email, 'purchased');
            logger.info(`[LuckMail] Berhasil membeli email: ${email} (Token: ${token}, ID: ${purchaseId})`);

            return { token, email, purchaseId };
        } else {
            throw new Error(resData ? resData.message || JSON.stringify(resData) : "Unknown error from LuckMail API");
        }
    } catch (error) {
        logger.error(`[LuckMail] Gagal order email: ${error.message}`);
        throw error;
    }
}

/**
 * Polling untuk mengambil OTP dari order ID LuckMail.
 * Melakukan polling tiap 2 detik, maksimal selama 90 detik (45 kali).
 * Menggunakan sistem cache OTP agar tidak mengembalikan kode OTP basi.
 * 
 * @param {string} token - Token dari email yang dibeli.
 * @param {string} email - Alamat email (untuk mengecek last_otp cache).
 * @returns {Promise<string|null>} - Kode OTP 6-digit atau null jika timeout.
 */
async function fetchVerificationCode(token, email) {
    const maxRetries = 10;
    const delayMs = 2000;
    const lastOtp = db.getOtpCache(email);

    logger.info(`[LuckMail] Memulai pencarian OTP untuk ${email} (Token: ${token})...`);
    if (lastOtp) {
        logger.debug(`[LuckMail] Memiliki record otp sebelumnya: ${lastOtp}, akan di-ignore.`);
    }

    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, delayMs)); // Delay 2 detik

            const response = await apiClient.get(`/email/token/${token}/code`);

            if (response.data && response.data.data && response.data.data.verification_code) {
                const codeRaw = response.data.data.verification_code;

                // Cari angka 6-digit dari kembalian luckmail
                const match = String(codeRaw).match(/\b(\d{6})\b/);
                if (match && match[1]) {
                    const extractedOtp = match[1];

                    // Validasi dengan cache, supaya tidak membaca ulang OTP dari percobaan login/sebelumnya
                    if (extractedOtp === lastOtp) {
                        logger.debug(`[LuckMail] Mendapatkan kode OTP ${extractedOtp} tapi ini adalah kode lama. Melanjutkan polling... (${i + 1}/${maxRetries})`);
                        continue;
                    }

                    // OTP baru didapatkan!
                    logger.success(`[LuckMail] Kode verifikasi ditemukan: ${extractedOtp}`);
                    db.saveOtpCache(email, extractedOtp); // Update chache db
                    return extractedOtp;
                } else if (codeRaw) {
                    // Jika ada tulisan code tapi tidak ketemu angka 6 digit
                    logger.debug(`[LuckMail] Kode respons turun tapi tidak sesuai format 6-digit: ${codeRaw}`);
                }
            }
        } catch (error) {
            logger.debug(`[LuckMail] Exception saat polling kode: ${error.message}`);
        }

        if (i % 2 === 0) {
            logger.info(`[LuckMail] Menunggu OTP untuk ${email}... (${Math.min((i + 1) * 2, 20)}s)`);
        }
    }

    logger.warn(`[LuckMail] Timeout 20 detik tercapai. OTP baru tidak ditemukan untuk ${email}.`);
    return null;
}

/**
 * Mengirimkan appeal karena email tidak menerima OTP
 * @param {number|string} purchaseId
 */
async function cancelEmail(purchaseId) {
    try {
        const response = await apiClient.post(`/appeal/create`, {
            appeal_type: 2,
            purchase_id: purchaseId,
            reason: "no_code",
        });
        if (response.data && response.data.code === 0) {
            logger.info(`[LuckMail] Appeal untuk purchase_id ${purchaseId} berhasil dikirim.`);
            db.saveOrder(purchaseId, "cancelled", 'cancelled');
        }
    } catch (e) {
        logger.debug(`[LuckMail] Gagal appeal purchase_id ${purchaseId}: ${e.message}`);
    }
}

module.exports = {
    purchaseEmail,
    fetchVerificationCode,
    cancelEmail
};
