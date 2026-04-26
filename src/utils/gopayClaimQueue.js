/**
 * Fair GoPay Claim Queue
 * 
 * Instead of each task independently polling /gopay/claim (unfair race),
 * all tasks register here. The coordinator picks one task per user in
 * round-robin order, attempts the claim, and resolves the promise.
 */

const { claimGopaySlot } = require('./gopayOtpFetcher');
const logger = require('./logger');

// Queue: [{ userId, serverUrl, resolve, reject }]
let waitingQueue = [];
let isRunning = false;

async function acquireGopaySlot(userId, serverUrl) {
    return new Promise((resolve, reject) => {
        waitingQueue.push({ userId: userId.toString(), serverUrl, resolve, reject });
        runCoordinator();
    });
}

async function runCoordinator() {
    if (isRunning || waitingQueue.length === 0) return;
    isRunning = true;

    while (waitingQueue.length > 0) {
        // Round-robin: pick next unique userId in order
        const nextEntry = pickNextFair();
        if (!nextEntry) break;

        try {
            const slot = await claimGopaySlot(nextEntry.serverUrl);
            if (slot) {
                // Slot available — grant it to this task
                waitingQueue = waitingQueue.filter(e => e !== nextEntry);
                logger.info(`[GoPay Queue] Granted GoPay slot to user ${nextEntry.userId}`);
                nextEntry.resolve(slot);
            } else {
                // All 13 slots busy — wait 3s then retry whole queue
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) {
            waitingQueue = waitingQueue.filter(e => e !== nextEntry);
            logger.warn(`[GoPay Queue] Error for user ${nextEntry.userId}: ${err.message}`);
            nextEntry.reject(err);
        }
    }

    isRunning = false;
}

// Pick next entry in round-robin order by userId
let lastPickedUserId = null;
function pickNextFair() {
    if (waitingQueue.length === 0) return null;
    const ObjectIsSame = (arr1, arr2) => arr1.length === arr2.length && arr1.every((v, i) => v === arr2[i]);
    
    // Get unique user IDs currently waiting
    const userIds = [...new Set(waitingQueue.map(e => e.userId))];
    
    if (userIds.length === 0) return null;

    let lastIdx = userIds.indexOf(lastPickedUserId);
    let nextIdx = (lastIdx + 1) % userIds.length;
    
    lastPickedUserId = userIds[nextIdx];
    return waitingQueue.find(e => e.userId === lastPickedUserId);
}

module.exports = { acquireGopaySlot };
