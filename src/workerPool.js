const logger = require('./utils/logger');

const MAX_SLOTS = parseInt(process.env.MAX_THREADS) || 50;
const DEFAULT_USER_THREADS = parseInt(process.env.DEFAULT_USER_THREADS) || 5;

// Global queue across all users
let globalQueue = [];
// Map of taskId -> active slot info
let activeSlots = new Map();

// Cancellation tokens: userId -> { cancelled: boolean }
const cancellationTokens = new Map();

function createTokenForUser(userId) {
    const token = { cancelled: false };
    cancellationTokens.set(userId.toString(), token);
    return token;
}

function cancelTokenForUser(userId) {
    const token = cancellationTokens.get(userId.toString());
    if (token) token.cancelled = true;
}

function getTokenForUser(userId) {
    return cancellationTokens.get(userId.toString()) || { cancelled: false };
}

function clearTokenForUser(userId) {
    cancellationTokens.delete(userId.toString());
}

// We need a way to track callback for actual task execution
let processTaskCallback = null;

let _taskCounter = 0;
function _nextTaskId() {
    return `task_${++_taskCounter}_${Date.now()}`;
}

function setTaskProcessor(cb) {
    processTaskCallback = cb;
}

function getActiveCount() {
    return activeSlots.size;
}

// Cek apakah user masih punya slot AKTIF (bukan dari queue)
function isUserActive(userId) {
    userId = userId.toString();
    for (const slot of activeSlots.values()) {
        if (slot.userId === userId) return true;
    }
    return false;
}

function getUserActiveCount(userId) {
    let count = 0;
    const userIdStr = userId.toString();
    for (const slot of activeSlots.values()) {
        if (slot.userId === userIdStr) count++;
    }
    return count;
}

function getUserMaxThreads(userId) {
    const db = require('./db');
    const user = db.getUser(userId);
    return (user && user.maxThreads) ? parseInt(user.maxThreads) : DEFAULT_USER_THREADS;
}

// Round-robin: pick first task whose user hasn't hit their thread cap
function getNextFairTaskIndex() {
    const idx = globalQueue.findIndex(t => {
        const userMax = getUserMaxThreads(t.userId);
        const userActive = getUserActiveCount(t.userId);
        return userActive < userMax;
    });
    return idx; // -1 jika semua user sudah di cap (tidak ada yang bisa jalan)
}

// Cek apakah user masih punya task di queue (termasuk yang sedang jalan)
function isUserBusy(userId) {
    userId = userId.toString();
    if (isUserActive(userId)) return true;
    return globalQueue.some(t => t.userId.toString() === userId);
}

function getQueuePosition(userId) {
    userId = userId.toString();
    const pos = globalQueue.findIndex(t => t.userId.toString() === userId);
    return pos !== -1 ? pos + 1 : 0;
}

// Single task enqueue — isi semua slot yang tersedia
function enqueueTask(task) {
    task.taskId = task.taskId || _nextTaskId();
    globalQueue.push(task);
    while (tryStart()) {} // Isi semua slot yang masih bisa diisi
    return getQueuePosition(task.userId);
}

// Batch enqueue — push semua ke queue, lalu langsung isi semua slot yang tersedia
function enqueueBatch(tasks) {
    for (const task of tasks) {
        task.taskId = task.taskId || _nextTaskId();
        globalQueue.push(task);
    }
    while (tryStart()) {} // Langsung jalankan sebanyak mungkin slot sekaligus
    return getQueuePosition(tasks[0]?.userId);
}

function cancelUserQueue(userId) {
    userId = userId.toString();
    globalQueue = globalQueue.filter(t => t.userId.toString() !== userId);
}

function getActiveStatus() {
    return Array.from(activeSlots.values());
}

function releaseSlot(taskId) {
    activeSlots.delete(taskId);
    while (tryStart()) {} // Setelah slot bebas, isi kembali sebanyak mungkin
}

// Returns true jika berhasil memulai 1 task, false jika tidak ada yang bisa dijalankan
function tryStart() {
    if (activeSlots.size >= MAX_SLOTS || globalQueue.length === 0) {
        return false;
    }

    const taskIndex = getNextFairTaskIndex();

    if (taskIndex === -1) {
        // All queued tasks belong to users already at their thread cap — nothing to start
        return false;
    }

    // Remove task from queue
    const task = globalQueue.splice(taskIndex, 1)[0];
    const userIdStr = task.userId.toString();
    const taskId = task.taskId;

    // Create a fresh cancellation token for this task
    const cancelToken = createTokenForUser(userIdStr);

    // Mark slot as active (key = taskId, value simpan userId untuk tracking)
    activeSlots.set(taskId, {
        taskId,
        userId: userIdStr,
        chatId: task.chatId,
        email: task.email,
        mode: task.mode,
        startTime: Date.now()
    });

    logger.info(`[Pool] Menjalankan task ${taskId} untuk User ${userIdStr} - Mode: ${task.mode}`);

    if (processTaskCallback) {
        // Inject cancel token into task object
        task.cancelToken = cancelToken;
        // Run asynchronously, catch errors, and ensure releaseSlot is called
        processTaskCallback(task).then(result => {
             const { handleTaskResult } = require('./telegramHandler');
             if (handleTaskResult) handleTaskResult(userIdStr, result);
        }).catch(err => {
            logger.error(`[Pool] Error di task ${taskId} (User ${userIdStr}): ${err.message}`);
            const { handleTaskResult } = require('./telegramHandler');
            if (handleTaskResult) handleTaskResult(userIdStr, { success: false, email: task.email || '', error: err.message });
        }).finally(() => {
            logger.info(`[Pool] Selesai/Release slot untuk task ${taskId} (User ${userIdStr})`);
            clearTokenForUser(userIdStr);
            releaseSlot(taskId);
        });
    } else {
        logger.error("[Pool] Belum ada prosesor(task runner) yang di-set!");
        releaseSlot(taskId);
    }

    return true; // Berhasil memulai 1 task
}

// Menghapus semua active slot milik user (untuk cancel)
function cancelUserActiveToken(userId) {
    userId = userId.toString();
    for (const [taskId, slot] of activeSlots.entries()) {
        if (slot.userId === userId) {
            activeSlots.delete(taskId);
        }
    }
    while (tryStart()) {} // Isi ulang slot yang terbebas
}

module.exports = {
    setTaskProcessor,
    getActiveCount,
    getUserActiveCount,
    isUserActive,
    isUserBusy,
    getQueuePosition,
    enqueueTask,
    enqueueBatch,
    cancelUserQueue,
    cancelUserActiveToken,
    cancelTokenForUser,
    getTokenForUser,
    getActiveStatus,
    releaseSlot
};

