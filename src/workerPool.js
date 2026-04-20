const logger = require('./utils/logger');

const MAX_SLOTS = parseInt(process.env.MAX_THREADS) || 5;

// Global queue across all users
let globalQueue = [];
// Map of userId -> active slot info
let activeSlots = new Map();

// We need a way to track callback for actual task execution
let processTaskCallback = null;

function setTaskProcessor(cb) {
    processTaskCallback = cb;
}

function getActiveCount() {
    return activeSlots.size;
}

function isUserActive(userId) {
    return activeSlots.has(userId.toString());
}

function getQueuePosition(userId) {
    userId = userId.toString();
    const pos = globalQueue.findIndex(t => t.userId.toString() === userId);
    return pos !== -1 ? pos + 1 : 0;
}

function enqueueTask(task) {
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

function releaseSlot(userId) {
    userId = userId.toString();
    activeSlots.delete(userId);
    tryStart(); // Try to fill the slot
}

async function tryStart() {
    if (activeSlots.size >= MAX_SLOTS || globalQueue.length === 0) {
        return;
    }

    // Find the first task in queue belonging to a user who doesn't currently have an active slot
    const taskIndex = globalQueue.findIndex(t => !activeSlots.has(t.userId.toString()));
    
    if (taskIndex === -1) {
        // All tasks in queue belong to users who are currently running a task
        return;
    }

    // Remove task from queue
    const task = globalQueue.splice(taskIndex, 1)[0];
    const userIdStr = task.userId.toString();

    // Mark slot as active
    activeSlots.set(userIdStr, {
        userId: userIdStr,
        chatId: task.chatId,
        email: task.email,
        mode: task.mode,
        startTime: Date.now()
    });

    logger.info(`[Pool] Menjalankan task untuk User ${userIdStr} - Email: ${task.email}`);

    if (processTaskCallback) {
        // Run asynchronously, catch errors, and ensure releaseSlot is called
        processTaskCallback(task).catch(err => {
            logger.error(`[Pool] Error di task (User ${userIdStr}): ${err.message}`);
        }).finally(() => {
            logger.info(`[Pool] Selesai/Release slot untuk User ${userIdStr}`);
            releaseSlot(userIdStr);
        });
    } else {
        logger.error("[Pool] Belum ada prosesor(task runner) yang di-set!");
        releaseSlot(userIdStr);
    }

    // Since we might have freed a slot and picked a task, try to start another if there's room
    tryStart();
}

// Menghapus state active slot (contoh: jika bot error/cancelled dari luar)
// Berguna untuk kill switch manual per user.
function cancelUserActiveToken(userId) {
    // Di worker pool, kita hanya memutus pencatatan state-nya.
    // Pekerjaan mematikan CycleTLS dll tetap harus jadi tanggung jawab index.js yang menghandle event cancel.
    // Tapi karena code sebelumnya terisolir tanpa kill switch yang baik dari luar, kita minimal bisa hilangkan state-nya.
    const uidStr = userId.toString();
    if (activeSlots.has(uidStr)) {
        activeSlots.delete(uidStr);
        tryStart();
    }
}

module.exports = {
    setTaskProcessor,
    getActiveCount,
    isUserActive,
    getQueuePosition,
    enqueueTask,
    cancelUserQueue,
    cancelUserActiveToken,
    getActiveStatus,
    releaseSlot
};
