const path = require('path');
const Database = require('better-sqlite3');
const logger = require('./utils/logger');

// Init SQLite DB
const DB_PATH = path.join(process.cwd(), 'db.sqlite');
let db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    // Runtime migration: tambah kolom baru kalau belum ada
    const existingCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!existingCols.includes('tmailDomains')) {
        db.prepare("ALTER TABLE users ADD COLUMN tmailDomains TEXT").run();
        logger.info('[DB] Kolom tmailDomains ditambahkan ke tabel users.');
    }
} catch (e) {
    logger.error("[DB] Failed to open db.sqlite: " + e.message);
    process.exit(1);
}

// ----------------------
// PREPARED STATEMENTS
// ----------------------
const stmtGetUser = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtHasUser = db.prepare('SELECT 1 FROM users WHERE id = ?');
const stmtGetUserByRef = db.prepare('SELECT * FROM users WHERE referralCode = ?');
const stmtInsertUserBase = db.prepare('INSERT OR IGNORE INTO users (id, firstName, registeredAt, referralCode) VALUES (?, ?, ?, ?)');

const stmtGetAccount = db.prepare('SELECT * FROM accounts WHERE email = ?');
const stmtInsertAccount = db.prepare(`
    INSERT INTO accounts (email, userId, password, accountType, accessToken, refreshToken, mailToken, updatedAt)
    VALUES (@email, @userId, @password, @accountType, @accessToken, @refreshToken, @mailToken, @updatedAt)
    ON CONFLICT(email) DO UPDATE SET
        userId = excluded.userId,
        password = excluded.password,
        accountType = excluded.accountType,
        accessToken = excluded.accessToken,
        refreshToken = excluded.refreshToken,
        mailToken = excluded.mailToken,
        updatedAt = excluded.updatedAt
`);

const stmtGetOtp = db.prepare('SELECT otp FROM otp_cache WHERE email = ?');
const stmtSaveOtp = db.prepare('INSERT OR REPLACE INTO otp_cache (email, otp) VALUES (?, ?)');

const stmtGetOrderByEmail = db.prepare('SELECT * FROM orders WHERE email = ? LIMIT 1');
const stmtSaveOrder = db.prepare('INSERT OR REPLACE INTO orders (orderId, email, status, date) VALUES (?, ?, ?, ?)');

const stmtGetTotalReferrals = db.prepare('SELECT COUNT(*) as c FROM users WHERE referredBy = ?');

// ----------------------
// USERS
// ----------------------
function getUser(userId) {
    const row = stmtGetUser.get(userId.toString());
    if (!row) return null;
    // Map boolean integers back to boolean if needed, though JS considers 1 true and 0 false.
    row.referralRewarded = !!row.referralRewarded;
    return row;
}

function hasUser(userId) {
    return !!stmtHasUser.get(userId.toString());
}

function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getUserByReferralCode(code) {
    const row = stmtGetUserByRef.get(code);
    if (!row) return null;
    row.referralRewarded = !!row.referralRewarded;
    return row;
}

function initUserData(userId, firstName) {
    userId = userId.toString();
    stmtInsertUserBase.run(userId, firstName || 'User', new Date().toISOString(), generateReferralCode());
    // Give every new user 1 welcome point
    saveUser(userId, { points: 1 });
}

// saveUser dinamik: Melakukan pembaruan parsial sesuai `data` param
function saveUser(userId, data) {
    userId = userId.toString();
    const existing = stmtGetUser.get(userId);
    if (!existing) {
        // Fallback: create base first if it somehow doesn't exist
        initUserData(userId, 'User');
    }

    const keys = Object.keys(data);
    if (keys.length === 0) return getUser(userId);

    // Filter valid keys to avoid SQL injection on columns
    const allowedKeys = new Set([
        'status', 'firstName', 'registeredAt', 'points', 'referralCode', 'referredBy', 'referralRewarded',
        'totalAccountsCreated', 'totalPlusCreated', 'totalReferralsEarned', 'maxThreads', 'passwordMode',
        'staticPassword', 'reportFormat', 'tmailBaseUrl', 'tmailApiKey', 'tmailDomains', 'luckMailApiKey', 'luckMailDomains'
    ]);

    const updates = [];
    const params = { id: userId };

    for (const key of keys) {
        if (allowedKeys.has(key)) {
            updates.push(`${key} = @${key}`);
            let val = data[key];
            if (typeof val === 'boolean') val = val ? 1 : 0;
            params[key] = val;
        }
    }

    if (updates.length > 0) {
        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = @id`;
        db.prepare(sql).run(params);
    }
    return getUser(userId);
}

function addPoints(userId, amount) {
    const user = getUser(userId);
    if (!user) return null;
    const current = user.points || 0;
    return saveUser(userId, { points: current + amount });
}

function deductPoints(userId, amount) {
    const user = getUser(userId);
    if (!user) throw new Error("User not found");
    const current = user.points || 0;
    if (current < amount) throw new Error("Insufficient points");
    return saveUser(userId, { points: current - amount });
}

function hasEnoughPoints(userId, amount) {
    const user = getUser(userId);
    if (!user) return false;
    return (user.points || 0) >= amount;
}

function incrementStat(userId, field) {
    const user = getUser(userId);
    if (!user) return null;
    const current = user[field] || 0;
    return saveUser(userId, { [field]: current + 1 });
}

function getUserStats(userId) {
    userId = userId.toString();
    const user = getUser(userId);
    if (!user) return null;
    
    // Perbaiki fallback: Jika belum punya referral, generate!
    if (!user.referralCode) {
        const newRef = generateReferralCode();
        saveUser(userId, { referralCode: newRef });
        user.referralCode = newRef;
    }

    const { c: totalReferrals } = stmtGetTotalReferrals.get(userId);

    return {
        points: user.points || 0,
        referralCode: user.referralCode,
        totalReferrals,
        totalAccountsCreated: user.totalAccountsCreated || 0,
        totalPlusCreated: user.totalPlusCreated || 0
    };
}


// ----------------------
// ACCOUNTS
// ----------------------
function getAccount(email) {
    return stmtGetAccount.get(email) || null;
}

function saveAccount(email, data) {
    // Kita baca data lama untuk di-merge
    const existing = getAccount(email) || {};

    const merged = { ...existing, ...data };
    const params = {
        email: email,
        userId: merged.userId || null,
        password: merged.password || null,
        accountType: merged.accountType || null,
        accessToken: merged.accessToken || null,
        refreshToken: merged.refreshToken || null,
        mailToken: merged.mailToken || null,
        updatedAt: new Date().toISOString()
    };
    stmtInsertAccount.run(params);
    return getAccount(email);
}

// ----------------------
// OTP CACHE
// ----------------------
function saveOtpCache(email, otp) {
    stmtSaveOtp.run(email, otp);
}

function getOtpCache(email) {
    const row = stmtGetOtp.get(email);
    return row ? row.otp : null;
}

// ----------------------
// ORDERS
// ----------------------
function getOrderByEmail(email) {
    return stmtGetOrderByEmail.get(email) || null;
}

function saveOrder(orderId, email, status) {
    stmtSaveOrder.run(orderId, email, status, new Date().toISOString());
}

module.exports = {
    getUser,
    saveUser,
    hasUser,
    initUserData,
    getUserByReferralCode,
    addPoints,
    deductPoints,
    hasEnoughPoints,
    incrementStat,
    getUserStats,
    
    saveAccount,
    getAccount,
    
    saveOtpCache,
    getOtpCache,
    
    saveOrder,
    getOrderByEmail
};
