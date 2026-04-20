const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const DB_FILE = path.join(process.cwd(), 'users.json');
const ACCOUNTS_FILE = path.join(process.cwd(), 'accounts.json');
const OTP_CACHE_FILE = path.join(process.cwd(), 'otp_cache.json');
const ORDERS_FILE = path.join(process.cwd(), 'orders.json');

// Ensure DB file exists
function initFile(file) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify({}, null, 2), 'utf8');
    }
}

function initDBs() {
    initFile(DB_FILE);
    initFile(ACCOUNTS_FILE);
    initFile(OTP_CACHE_FILE);
    initFile(ORDERS_FILE);
}
initDBs();

function readJSON(file) {
    try {
        initFile(file);
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        logger.error(`[DB] Error reading ${path.basename(file)}: ` + e.message);
        return {};
    }
}

function writeJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        logger.error(`[DB] Error writing ${path.basename(file)}: ` + e.message);
    }
}

// --- USERS ---
function getUser(userId) {
    const db = readJSON(DB_FILE);
    return db[userId] || null;
}

function saveUser(userId, data) {
    const db = readJSON(DB_FILE);
    if (!db[userId]) {
        db[userId] = {};
    }
    db[userId] = { ...db[userId], ...data };
    writeJSON(DB_FILE, db);
    return db[userId];
}

function hasUser(userId) {
    const db = readJSON(DB_FILE);
    return !!db[userId];
}

function getPendingUsers() {
    const db = readJSON(DB_FILE);
    return Object.entries(db)
        .map(([id, data]) => ({ id, ...data }))
        .filter(user => user.status === 'pending');
}

function approveUser(userId) {
    return saveUser(userId, { status: 'approved', approvedAt: new Date().toISOString() });
}

function rejectUser(userId) {
    return saveUser(userId, { status: 'rejected', rejectedAt: new Date().toISOString() });
}

// --- ACCOUNTS ---
function saveAccount(email, data) {
    const accs = readJSON(ACCOUNTS_FILE);
    if (!accs[email]) {
        accs[email] = { email };
    }
    accs[email] = { ...accs[email], ...data, updatedAt: new Date().toISOString() };
    writeJSON(ACCOUNTS_FILE, accs);
    return accs[email];
}

function getAccount(email) {
    const accs = readJSON(ACCOUNTS_FILE);
    return accs[email] || null;
}

// --- OTP CACHE ---
function saveOtpCache(email, otp) {
    const cache = readJSON(OTP_CACHE_FILE);
    cache[email] = otp;
    writeJSON(OTP_CACHE_FILE, cache);
}

function getOtpCache(email) {
    const cache = readJSON(OTP_CACHE_FILE);
    return cache[email] || null;
}

// --- ORDERS ---
function saveOrder(orderId, email, status) {
    const orders = readJSON(ORDERS_FILE);
    orders[orderId] = { orderId, email, status, date: new Date().toISOString() };
    writeJSON(ORDERS_FILE, orders);
}

function getOrderByEmail(email) {
    const orders = readJSON(ORDERS_FILE);
    return Object.values(orders).find(o => o.email === email) || null;
}

module.exports = {
    getUser,
    saveUser,
    hasUser,
    getPendingUsers,
    approveUser,
    rejectUser,
    
    saveAccount,
    getAccount,
    
    saveOtpCache,
    getOtpCache,
    
    saveOrder,
    getOrderByEmail
};
