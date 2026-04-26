const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const chalk = require('chalk');

const DB_PATH = path.join(process.cwd(), 'db.sqlite');

const USERS_FILE = path.join(process.cwd(), 'users.json');
const ACCOUNTS_FILE = path.join(process.cwd(), 'accounts.json');
const OTP_CACHE_FILE = path.join(process.cwd(), 'otp_cache.json');
const ORDERS_FILE = path.join(process.cwd(), 'orders.json');

console.log(chalk.cyan("Memulai migrasi dari JSON ke SQLite..."));

// Inisialisasi DB
const db = new Database(DB_PATH);

// Buat Tabel
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'active',
    firstName TEXT,
    registeredAt TEXT,
    points INTEGER DEFAULT 0,
    referralCode TEXT UNIQUE,
    referredBy TEXT,
    referralRewarded INTEGER DEFAULT 0,
    totalAccountsCreated INTEGER DEFAULT 0,
    totalPlusCreated INTEGER DEFAULT 0,
    totalReferralsEarned INTEGER DEFAULT 0,
    maxThreads INTEGER,
    passwordMode TEXT,
    staticPassword TEXT,
    reportFormat TEXT,
    tmailBaseUrl TEXT,
    tmailApiKey TEXT,
    luckMailApiKey TEXT,
    luckMailDomains TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    email TEXT PRIMARY KEY,
    userId TEXT,
    password TEXT,
    accountType TEXT,
    accessToken TEXT,
    refreshToken TEXT,
    mailToken TEXT,
    updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS otp_cache (
    email TEXT PRIMARY KEY,
    otp TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    orderId TEXT PRIMARY KEY,
    email TEXT,
    status TEXT,
    date TEXT
);
`);

console.log("✅ Schema tabel berhasil dibuat.");

// Fungsi Helper Baca JSON
function readSafeJSON(file) {
    if (!fs.existsSync(file)) return {};
    try {
        const raw = fs.readFileSync(file, 'utf8');
        return raw.trim() === '' ? {} : JSON.parse(raw);
    } catch(e) {
        return {};
    }
}

// 1. Migrasi table users
const usersRaw = readSafeJSON(USERS_FILE);
const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (
        id, status, firstName, registeredAt, points, referralCode, referredBy, referralRewarded,
        totalAccountsCreated, totalPlusCreated, totalReferralsEarned, maxThreads, passwordMode, 
        staticPassword, reportFormat, tmailBaseUrl, tmailApiKey, luckMailApiKey, luckMailDomains
    ) VALUES (
        @id, @status, @firstName, @registeredAt, @points, @referralCode, @referredBy, @referralRewarded,
        @totalAccountsCreated, @totalPlusCreated, @totalReferralsEarned, @maxThreads, @passwordMode, 
        @staticPassword, @reportFormat, @tmailBaseUrl, @tmailApiKey, @luckMailApiKey, @luckMailDomains
    )
`);

let uCount = 0;
const migrateUsers = db.transaction((users) => {
    for (const [id, data] of Object.entries(users)) {
        insertUser.run({
            id: id,
            status: data.status || 'active',
            firstName: data.firstName || 'User',
            registeredAt: data.registeredAt || new Date().toISOString(),
            points: data.points || 0,
            referralCode: data.referralCode || null,
            referredBy: data.referredBy || null,
            referralRewarded: data.referralRewarded ? 1 : 0,
            totalAccountsCreated: data.totalAccountsCreated || 0,
            totalPlusCreated: data.totalPlusCreated || 0,
            totalReferralsEarned: data.totalReferralsEarned || 0,
            maxThreads: data.maxThreads || null,
            passwordMode: data.passwordMode || null,
            staticPassword: data.staticPassword || null,
            reportFormat: data.reportFormat || null,
            tmailBaseUrl: data.tmailBaseUrl || null,
            tmailApiKey: data.tmailApiKey || null,
            luckMailApiKey: data.luckMailApiKey || null,
            luckMailDomains: data.luckMailDomains || null
        });
        uCount++;
    }
});
try { migrateUsers(usersRaw); } catch(e) { console.log(chalk.red("Error migrasi users:"), e.message); }
console.log(`✅ ${uCount} data Users dimigrasi.`);


// 2. Migrasi table accounts
const accRaw = readSafeJSON(ACCOUNTS_FILE);
const insertAcc = db.prepare(`
    INSERT OR REPLACE INTO accounts (email, userId, password, accountType, accessToken, refreshToken, mailToken, updatedAt)
    VALUES (@email, @userId, @password, @accountType, @accessToken, @refreshToken, @mailToken, @updatedAt)
`);
let aCount = 0;
const migrateAccs = db.transaction((accs) => {
    for (const [email, data] of Object.entries(accs)) {
        insertAcc.run({
            email,
            userId: data.userId || null,
            password: data.password || null,
            accountType: data.accountType || null,
            accessToken: data.accessToken || null,
            refreshToken: data.refreshToken || null,
            mailToken: data.mailToken || null,
            updatedAt: data.updatedAt || new Date().toISOString()
        });
        aCount++;
    }
});
try { migrateAccs(accRaw); } catch(e) { console.log(chalk.red("Error migrasi accounts:"), e.message); }
console.log(`✅ ${aCount} data Accounts dimigrasi.`);


// 3. Migrasi table otp_cache
const otpRaw = readSafeJSON(OTP_CACHE_FILE);
const insertOtp = db.prepare(`INSERT OR REPLACE INTO otp_cache (email, otp) VALUES (@email, @otp)`);
let oCount = 0;
const migrateOtps = db.transaction((otps) => {
    for (const [email, otp] of Object.entries(otps)) {
        insertOtp.run({ email, otp });
        oCount++;
    }
});
try { migrateOtps(otpRaw); } catch(e) { console.log(chalk.red("Error migrasi OTP:"), e.message); }
console.log(`✅ ${oCount} data OTP Cache dimigrasi.`);


// 4. Migrasi table orders
const orderRaw = readSafeJSON(ORDERS_FILE);
const insertOrder = db.prepare(`INSERT OR REPLACE INTO orders (orderId, email, status, date) VALUES (@orderId, @email, @status, @date)`);
let orCount = 0;
const migrateOrders = db.transaction((orders) => {
    for (const [orderId, data] of Object.entries(orders)) {
        insertOrder.run({
            orderId,
            email: data.email || null,
            status: data.status || null,
            date: data.date || new Date().toISOString()
        });
        orCount++;
    }
});
try { migrateOrders(orderRaw); } catch(e) { console.log(chalk.red("Error migrasi orders:"), e.message); }
console.log(`✅ ${orCount} data Orders dimigrasi.`);


console.log(chalk.green.bold("🎉 MIGRASI SELESAI!"));
console.log("Silakan pastikan tabel db.sqlite sudah terisi benar.");
