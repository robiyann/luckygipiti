/**
 * passwordGenerator.js
 * Generate password random yang memenuhi standar OpenAI:
 * - Minimal 12 karakter
 * - Mengandung huruf besar (A-Z)
 * - Mengandung huruf kecil (a-z)
 * - Mengandung angka (0-9)
 */

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS   = '0123456789';
const ALL_CHARS = UPPERCASE + LOWERCASE + NUMBERS;

/**
 * Hasilkan password random 16 karakter yang memenuhi syarat OpenAI.
 * Dijamin mengandung minimal 1 uppercase, 1 lowercase, 1 angka.
 * @returns {string}
 */
function generateStrongPassword() {
    const length = Math.floor(Math.random() * 5) + 12; // random 12–16

    // Pastikan masing-masing kategori terwakili minimal 1x
    const required = [
        UPPERCASE[Math.floor(Math.random() * UPPERCASE.length)],
        UPPERCASE[Math.floor(Math.random() * UPPERCASE.length)],
        LOWERCASE[Math.floor(Math.random() * LOWERCASE.length)],
        LOWERCASE[Math.floor(Math.random() * LOWERCASE.length)],
        NUMBERS[Math.floor(Math.random() * NUMBERS.length)],
        NUMBERS[Math.floor(Math.random() * NUMBERS.length)],
    ];

    // Isi sisa karakter dari pool lengkap
    const rest = [];
    for (let i = required.length; i < length; i++) {
        rest.push(ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]);
    }

    // Gabung lalu acak posisi (Fisher-Yates)
    const chars = [...required, ...rest];
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
}

/**
 * Validasi apakah password memenuhi syarat OpenAI.
 * @param {string} pass
 * @returns {boolean}
 */
function isValidPassword(pass) {
    if (!pass || pass.length < 12) return false;
    if (!/[A-Z]/.test(pass)) return false;
    if (!/[a-z]/.test(pass)) return false;
    if (!/[0-9]/.test(pass)) return false;
    return true;
}

module.exports = { generateStrongPassword, isValidPassword };
