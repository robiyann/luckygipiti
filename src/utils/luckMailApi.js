const axios = require('axios');
const db = require('../db');
const logger = require('./logger');

const API_KEY = "ak_8d96ef30a1e01a5d095d25a2683a57fc";
const BASE_URL = "https://mails.luckyous.com/api/v1/openapi";

const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
    }
});

/**
 * Membeli slot email baru dari LuckMail (Outlook.de)
 * @returns {Promise<{orderId: string, email: string}>}
 */
async function purchaseEmail() {
    try {
        const response = await apiClient.post('/order/create', {
            project_code: "openai",
            email_type: "ms_imap",
            domain: "outlook.de",
            specified_email: "",
            variant_mode: ""
        });

        const resData = response.data;
        if (resData && resData.data && resData.data.order_no) {
            const orderId = resData.data.order_no;
            const email = resData.data.email_address;
            
            // Simpan riwayat pembelian ke database orders.json
            db.saveOrder(orderId, email, 'purchased');
            logger.info(`[LuckMail] Berhasil membeli email: ${email} (Order: ${orderId})`);
            
            return { orderId, email };
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
 * Melakukan polling tiap 2 detik, maksimal selama 20 detik (10 kali).
 * Menggunakan sistem cache OTP agar tidak mengembalikan kode OTP basi.
 * 
 * @param {string} orderId - ID dari email yang dibeli.
 * @param {string} email - Alamat email (untuk mengecek last_otp cache).
 * @returns {Promise<string|null>} - Kode OTP 6-digit atau null jika timeout.
 */
async function fetchVerificationCode(orderId, email) {
    const maxRetries = 10;
    const delayMs = 2000;
    const lastOtp = db.getOtpCache(email);

    logger.info(`[LuckMail] Memulai pencarian OTP untuk ${email} (Order: ${orderId})...`);
    if (lastOtp) {
        logger.debug(`[LuckMail] Memiliki record otp sebelumnya: ${lastOtp}, akan di-ignore.`);
    }

    for (let i = 0; i < maxRetries; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, delayMs)); // Delay 2 detik
            
            const response = await apiClient.get(`/order/${orderId}/code`);
            
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
 * Membatalkan email order
 * @param {string} orderId
 */
async function cancelEmail(orderId) {
    try {
        const response = await apiClient.post(`/order/${orderId}/cancel`, {});
        if (response.data && response.data.code === 0) {
            logger.info(`[LuckMail] Order ${orderId} berhasil dibatalkan.`);
            db.saveOrder(orderId, "cancelled", 'cancelled');
        }
    } catch (e) {
        logger.debug(`[LuckMail] Gagal membatalkan order ${orderId}: ${e.message}`);
    }
}

module.exports = {
    purchaseEmail,
    fetchVerificationCode,
    cancelEmail
};
