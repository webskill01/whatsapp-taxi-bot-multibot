import fs from 'fs';
import path from 'path';
import { log } from './logger.js';
import { GLOBAL_CONFIG } from './globalConfig.js';
import {
  isTaxiRequest,
  extractCitiesForPipelines,
  matchesPipeline,
  getMessageFingerprint,
  hasPhoneNumber,
  containsBlockedNumber,
} from './filter.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const { rateLimits, humanBehavior, circuitBreaker: circuitBreakerConfig, deduplication, validation } = GLOBAL_CONFIG;
const HOURLY_LIMIT = rateLimits.hourly;
const DAILY_LIMIT = rateLimits.daily;
const MIN_MESSAGE_LENGTH = validation.minMessageLength;
const MAX_FINGERPRINT_CACHE = deduplication.maxFingerprintCache;
const SEND_COOLDOWN = deduplication.sendCooldown;

const HUMAN_DELAYS = humanBehavior;
const MAX_FAILURES_BEFORE_BREAK = circuitBreakerConfig.maxFailures;
const CIRCUIT_BREAK_DURATION = circuitBreakerConfig.breakDuration;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const processedFingerprints = new Set();
const inFlightSends = new Map();

let stats = {
  totalMessages: 0,
  processed: 0,
  duplicatesSkipped: 0,
  rejectedNoPhone: 0,
  rejectedNotTaxi: 0,
  rejectedBlockedNumber: 0,
  rejectedTooShort: 0,
  rejectedNotMonitored: 0,
  rejectedFromMe: 0,
  rejectedRateLimit: 0,
  sendSuccesses: 0,
  sendFailures: 0,
  humanPausesTriggered: 0,
  pipelinesMatched: {},
};

let messageCount = {
  hourly: 0,
  daily: 0,
  lastHourReset: Date.now(),
  lastDayReset: Date.now(),
};

// Circuit breaker for API failures
let circuitBreaker = {
  failureCount: 0,
  lastFailureTime: 0,
  isOpen: false,
  resetTimeout: null,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function simulateTyping(textLength) {
  const baseTime = textLength * getRandomDelay(30, 50);
  const typingTime = Math.min(
    Math.max(baseTime, HUMAN_DELAYS.minTypingTime),
    HUMAN_DELAYS.maxTypingTime
  );
  log.info(`⌨️  Typing: ${(typingTime / 1000).toFixed(1)}s`);
  await new Promise(resolve => setTimeout(resolve, typingTime));
}

async function maybeRandomPause() {
  if (Math.random() < HUMAN_DELAYS.randomPauseChance) {
    stats.humanPausesTriggered++;
    const pauseDuration = getRandomDelay(
      HUMAN_DELAYS.randomPauseDuration,
      HUMAN_DELAYS.randomPauseDuration + 3000
    );
    log.info(`☕ Random pause: ${(pauseDuration / 1000).toFixed(1)}s`);
    await new Promise(resolve => setTimeout(resolve, pauseDuration));
    return true;
  }
  return false;
}

function checkRateLimit() {
  const now = Date.now();

  if (now - messageCount.lastHourReset > 3600000) {
    log.info(`♻️  Hourly reset: ${messageCount.hourly} msgs`);
    messageCount.hourly = 0;
    messageCount.lastHourReset = now;
  }

  if (now - messageCount.lastDayReset > 86400000) {
    log.info(`♻️  Daily reset: ${messageCount.daily} msgs`);
    messageCount.daily = 0;
    messageCount.lastDayReset = now;
  }

  return messageCount.hourly < HOURLY_LIMIT && messageCount.daily < DAILY_LIMIT;
}

function canSendToGroup(groupId) {
  const lastSend = inFlightSends.get(groupId);
  if (!lastSend) return true;
  return (Date.now() - lastSend) >= SEND_COOLDOWN;
}

function markSending(groupId) {
  inFlightSends.set(groupId, Date.now());
}

function handleAPIFailure() {
  circuitBreaker.failureCount++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.failureCount >= MAX_FAILURES_BEFORE_BREAK) {
    if (!circuitBreaker.isOpen) {
      circuitBreaker.isOpen = true;
      log.error(`🔴 CIRCUIT BREAKER OPEN - Pausing ${CIRCUIT_BREAK_DURATION / 1000}s`);

      circuitBreaker.resetTimeout = setTimeout(() => {
        circuitBreaker.isOpen = false;
        circuitBreaker.failureCount = 0;
        log.info(`🟢 CIRCUIT BREAKER RESET`);
      }, CIRCUIT_BREAK_DURATION);
    }
  }
}

function handleAPISuccess() {
  if (circuitBreaker.failureCount > 0) {
    circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
  }
}

// ============================================================================
// FINGERPRINT PERSISTENCE
// ============================================================================

function loadFingerprints(fingerprintFile) {
  try {
    if (fs.existsSync(fingerprintFile)) {
      const data = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8'));
      const twoHoursAgo = Date.now() - 7200000;

      let loaded = 0;
      data.forEach((item) => {
        if (item.timestamp > twoHoursAgo) {
          processedFingerprints.add(item.fingerprint);
          loaded++;
        }
      });

      log.info(`📂 Loaded ${loaded} fingerprints (2h cache)`);
    } else {
      fs.writeFileSync(fingerprintFile, JSON.stringify([]), 'utf8');
      log.info(`📂 Created fingerprint cache`);
    }
  } catch (error) {
    log.warn(`⚠️  Cache load failed: ${error.message}`);
  }
}

function saveFingerprints(fingerprintFile) {
  try {
    const data = Array.from(processedFingerprints).map((fp) => ({
      fingerprint: fp,
      timestamp: Date.now(),
    }));
    fs.writeFileSync(fingerprintFile, JSON.stringify(data.slice(-1000)), 'utf8');
  } catch (error) {
    log.warn(`⚠️  Cache save failed: ${error.message}`);
  }
}

// ============================================================================
// MESSAGE SENDING (WITH HUMAN-LIKE BEHAVIOR)
// ============================================================================

async function sendToGroup(sock, groupId, text) {
  if (!sock) {
    throw new Error('WhatsApp not connected');
  }

  try {
    await sock.sendMessage(groupId, { text });
    return true;
  } catch (error) {
    log.error(`❌ Send failed: ${error.message}`);
    throw error;
  }
}

async function sendToMultipleGroups(sock, targetGroups, text) {
  if (circuitBreaker.isOpen) {
    log.warn(`🔴 Circuit breaker OPEN - Aborting send`);
    return { successCount: 0, totalTargets: targetGroups.length };
  }

  // Remove duplicates and filter by cooldown
  const uniqueTargets = [...new Set(targetGroups)].filter(canSendToGroup);

  if (uniqueTargets.length === 0) {
    log.warn(`⚠️  All targets in cooldown`);
    return { successCount: 0, totalTargets: 0 };
  }

  log.info(`📤 Sending to ${uniqueTargets.length} groups...`);

  let successCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < uniqueTargets.length; i++) {
    if (circuitBreaker.isOpen) {
      log.warn(`🔴 Circuit breaker opened - Stopping`);
      break;
    }

    const groupId = uniqueTargets[i];
    const shortId = groupId.substring(0, 15);

    // Simulate typing before first message
    if (i === 0) {
      await simulateTyping(text.length);
    }

    // Add delays between groups
    if (i > 0) {
      const paused = await maybeRandomPause();

      if (!paused) {
        const delay = getRandomDelay(
          HUMAN_DELAYS.MIN_BETWEEN_GROUPS,
          HUMAN_DELAYS.MAX_BETWEEN_GROUPS
        );
        log.info(`⏳ Wait ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    markSending(groupId);
    const sendStartTime = Date.now();

    try {
      const sendPromise = sendToGroup(sock, groupId, text);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout 15s')), 15000)
      );

      await Promise.race([sendPromise, timeoutPromise]);

      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);
      log.info(`✅ ${shortId}... (${sendTime}s)`);

      handleAPISuccess();
      stats.sendSuccesses++;
      successCount++;

    } catch (error) {
      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);

      if (error.message.includes('Timeout') && sendTime < 16) {
        // Retry once on timeout
        try {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await sendToGroup(sock, groupId, text);
          log.info(`✅ ${shortId}... (retry OK)`);
          handleAPISuccess();
          stats.sendSuccesses++;
          successCount++;
        } catch (retryError) {
          log.error(`❌ ${shortId}... FAILED (retry)`);
          handleAPIFailure();
          stats.sendFailures++;
        }
      } else {
        log.error(`❌ ${shortId}... ${error.message}`);
        handleAPIFailure();
        stats.sendFailures++;
      }

      inFlightSends.delete(groupId);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  log.info(`⏱️  Total delivery time: ${totalTime}s`);

  return { successCount, totalTargets: uniqueTargets.length };
}

// ============================================================================
// MULTI-PIPELINE ROUTING LOGIC
// ============================================================================

export async function routeMessage(sock, message, config) {
  stats.totalMessages++;

  const text = message.message?.conversation ||
               message.message?.extendedTextMessage?.text ||
               message.message?.imageMessage?.caption ||
               message.message?.videoMessage?.caption ||
               '';

  const sourceGroup = message.key.remoteJid;
  const messageId = message.key.id;
  const messageTimestamp = message.messageTimestamp || Date.now();

  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`📥 Message #${stats.totalMessages}`);
  log.info(`👤 From: ${sourceGroup}`);
  log.info(`💬 Text: "${text?.substring(0, 60)}${text?.length > 60 ? '...' : ''}"`);

  // ============================================================================
  // VALIDATION FILTERS (Same as old bot)
  // ============================================================================

  // 1. Check if from monitored source group
  if (!config.sourceGroupIds.includes(sourceGroup)) {
    stats.rejectedNotMonitored++;
    log.info(`⚠️  Not from source group - Skipped`);
    return;
  }

  // 2. Check if message is from bot itself
  if (message.key.fromMe) {
    stats.rejectedFromMe++;
    log.info(`🤖 From me - Skipped`);
    return;
  }

  // 3. Check blocked numbers (BEFORE taxi check for efficiency)
  if (containsBlockedNumber(text, config.blockedPhoneNumbers)) {
    stats.rejectedBlockedNumber++;
    log.info(`🚫 BLOCKED NUMBER - Rejected`);
    return;
  }

  // 4. Check if taxi request
  if (!isTaxiRequest(text, config.requestKeywords, config.ignoreIfContains, [])) {
    stats.rejectedNotTaxi++;
    log.info(`⛔ NOT TAXI - Rejected`);
    return;
  }

  // 5. Check for phone number
  if (!hasPhoneNumber(text)) {
    stats.rejectedNoPhone++;
    log.info(`📵 NO PHONE - Rejected`);
    return;
  }

  // 6. Check message length
  if (text.length < MIN_MESSAGE_LENGTH) {
    stats.rejectedTooShort++;
    log.info(`⚠️  Too short (${text.length} chars) - Rejected`);
    return;
  }

  // ============================================================================
  // DUPLICATE DETECTION (Same as old bot)
  // ============================================================================

  const fingerprint = getMessageFingerprint(text, messageId, messageTimestamp);
  log.info(`🔑 Fingerprint: ${fingerprint.substring(0, 40)}...`);

  if (processedFingerprints.has(fingerprint)) {
    stats.duplicatesSkipped++;
    log.info(`🔁 DUPLICATE - Skipped`);
    return;
  }

  processedFingerprints.add(fingerprint);
  if (processedFingerprints.size > MAX_FINGERPRINT_CACHE) {
    const first = processedFingerprints.values().next().value;
    processedFingerprints.delete(first);
  }

  // ============================================================================
  // RATE LIMITING (Same as old bot)
  // ============================================================================

  if (!checkRateLimit()) {
    stats.rejectedRateLimit++;
    log.warn(`🚫 Rate limit: ${messageCount.hourly}/${HOURLY_LIMIT}h, ${messageCount.daily}/${DAILY_LIMIT}d`);
    return;
  }

  // ============================================================================
  // NEW: MULTI-PIPELINE ROUTING
  // ============================================================================

  log.info(`🔍 PIPELINE ROUTING:`);

  // Extract all cities from message
  const extractedCities = extractCitiesForPipelines(text, config.pipelines);
  log.info(`🏙️  Cities found: ${extractedCities.length > 0 ? extractedCities.join(', ') : 'None'}`);

  // Collect all target groups from matching pipelines
  const allTargets = new Set();
  const matchedPipelines = [];

  config.pipelines.forEach(pipeline => {
    if (matchesPipeline(extractedCities, pipeline.cityScope)) {
      log.info(`✅ Pipeline match: ${pipeline.name} (${pipeline.cityScope.join(', ')})`);
      matchedPipelines.push(pipeline.name);
      
      // Track pipeline stats
      if (!stats.pipelinesMatched[pipeline.name]) {
        stats.pipelinesMatched[pipeline.name] = 0;
      }
      stats.pipelinesMatched[pipeline.name]++;

      // Add target groups
      pipeline.targetGroups.forEach(groupId => allTargets.add(groupId));
    } else {
      log.info(`⚪ No match: ${pipeline.name} (${pipeline.cityScope.join(', ')})`);
    }
  });

  if (allTargets.size === 0) {
    log.warn(`⚠️  No pipeline match - Message not forwarded`);
    log.info(`   💡 TIP: Check your pipeline cityScope configurations`);
    return;
  }

  const targetGroups = Array.from(allTargets);

  log.info(`🎯 Matched ${matchedPipelines.length} pipelines: ${matchedPipelines.join(', ')}`);
  log.info(`📤 Forwarding to ${targetGroups.length} unique groups`);

  // ============================================================================
  // SEND TO ALL MATCHED TARGETS (Same delays as old bot)
  // ============================================================================

  const { successCount, totalTargets } = await sendToMultipleGroups(sock, targetGroups, text);

  // Update counters only if at least one send succeeded
  if (successCount > 0) {
    messageCount.hourly++;
    messageCount.daily++;
    stats.processed++;
  }

  log.info(`✅ COMPLETE: ${successCount}/${totalTargets} delivered | Cities: ${extractedCities.join(', ') || 'None'} | ${messageCount.hourly}/${HOURLY_LIMIT}h`);

  // Periodic fingerprint save (every 10 messages)
  if (stats.processed % 10 === 0) {
    const fingerprintFile = path.join(config.botDir, '.forwarded-messages.json');
    saveFingerprints(fingerprintFile);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initializeRouter(config) {
  log.info(`🔧 Initializing router...`);

  // Load fingerprint cache
  const fingerprintFile = path.join(config.botDir, '.forwarded-messages.json');
  loadFingerprints(fingerprintFile);

  // Initialize pipeline stats
  config.pipelines.forEach(pipeline => {
    stats.pipelinesMatched[pipeline.name] = 0;
  });

  // Cleanup old in-flight sends every 30 seconds
  setInterval(() => {
    const now = Date.now();
    for (const [groupId, timestamp] of inFlightSends.entries()) {
      if (now - timestamp > 30000) {
        inFlightSends.delete(groupId);
      }
    }
  }, 30000);

  log.info(`✅ Router initialized`);
  log.info(`   • Source groups: ${config.sourceGroupIds.length}`);
  log.info(`   • Pipelines: ${config.pipelines.length}`);
  config.pipelines.forEach(p => {
    log.info(`     → ${p.name}: ${p.cityScope.join(', ')} → ${p.targetGroups.length} groups`);
  });
  log.info(`   • Rate limits: ${HOURLY_LIMIT}/hour, ${DAILY_LIMIT}/day`);
  log.info(`   • Blocked numbers: ${config.blockedPhoneNumbers?.length || 0}`);
}

// ============================================================================
// STATS & MONITORING
// ============================================================================

export function getRouterStats() {
  return {
    stats,
    messageCount,
    circuitBreaker: {
      isOpen: circuitBreaker.isOpen,
      failureCount: circuitBreaker.failureCount,
    },
    fingerprintCacheSize: processedFingerprints.size,
    inFlightSends: inFlightSends.size,
  };
}

export function resetHourlyStats() {
  messageCount.hourly = 0;
  messageCount.lastHourReset = Date.now();
  log.info(`♻️  Manual hourly reset`);
}

export function resetDailyStats() {
  messageCount.daily = 0;
  messageCount.lastDayReset = Date.now();
  log.info(`♻️  Manual daily reset`);
}

// ============================================================================
// CLEANUP
// ============================================================================

export function cleanupRouter(config) {
  const fingerprintFile = path.join(config.botDir, '.forwarded-messages.json');
  saveFingerprints(fingerprintFile);

  if (circuitBreaker.resetTimeout) {
    clearTimeout(circuitBreaker.resetTimeout);
  }

  log.info(`🧹 Router cleanup complete`);
}

// ✅ Periodic memory cleanup (every 30 minutes)
setInterval(() => {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
    log.info(`🧹 Manual GC triggered`);
  }
  
  // Clean old in-flight sends
  const now = Date.now();
  let cleaned = 0;
  for (const [groupId, timestamp] of inFlightSends.entries()) {
    if (now - timestamp > 300000) { // 5 minutes
      inFlightSends.delete(groupId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    log.info(`🧹 Cleaned ${cleaned} stale in-flight sends`);
  }
}, 1800000); // 30 minutes