const logger = require('./utils/logger');

const MAX_SLOTS = parseInt(process.env.MAX_THREADS) || 5;

// Global queue across all users
let globalQueue = [];
// Map of taskId -> active slot info
let activeSlots = new Map();

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

function enqueueTask(task) {
    task.taskId = task.taskId || _nextTaskId();
    globalQueue.push(task);
    tryStart();
    return getQueuePosition(task.userId);
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
    tryStart(); // Try to fill the slot
}

async function tryStart() {
    if (activeSlots.size >= MAX_SLOTS || globalQueue.length === 0) {
        return;
    }

    // Ambil task pertama di antrean (FIFO), siapapun user-nya (Full Concurrency ON)
    // Sekarang 1 user bisa menjalankan banyak task berbarengan sebanyak jumlah slot MAX_SLOTS
    const taskIndex = 0;

    if (taskIndex === -1) {
        // Semua task di antrian milik user yang sedang aktif running task lain
        return;
    }

    // Remove task from queue
    const task = globalQueue.splice(taskIndex, 1)[0];
    const userIdStr = task.userId.toString();
    const taskId = task.taskId;

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
        // Run asynchronously, catch errors, and ensure releaseSlot is called
        processTaskCallback(task).then(result => {
             // Teruskan result ke telegramHandler untuk batch/single reporting
             // tanpa menampilkan pesan status tambahan (pesan sudah dikirim oleh handleAccountTask)
             const { handleTaskResult } = require('./telegramHandler');
             if (handleTaskResult) handleTaskResult(userIdStr, result);
        }).catch(err => {
            logger.error(`[Pool] Error di task ${taskId} (User ${userIdStr}): ${err.message}`);
            const { handleTaskResult } = require('./telegramHandler');
            if (handleTaskResult) handleTaskResult(userIdStr, { success: false, email: task.email || '', error: err.message });
        }).finally(() => {
            logger.info(`[Pool] Selesai/Release slot untuk task ${taskId} (User ${userIdStr})`);
            releaseSlot(taskId);
        });
    } else {
        logger.error("[Pool] Belum ada prosesor(task runner) yang di-set!");
        releaseSlot(taskId);
    }

    // Try to start another task if there's still room
    tryStart();
}

// Menghapus semua active slot milik user (untuk cancel)
function cancelUserActiveToken(userId) {
    userId = userId.toString();
    for (const [taskId, slot] of activeSlots.entries()) {
        if (slot.userId === userId) {
            activeSlots.delete(taskId);
        }
    }
    tryStart();
}

module.exports = {
    setTaskProcessor,
    getActiveCount,
    isUserActive,
    isUserBusy,
    getQueuePosition,
    enqueueTask,
    cancelUserQueue,
    cancelUserActiveToken,
    getActiveStatus,
    releaseSlot
};

