/**
 * ============================================================================
 * ROUTER - Multi-Pipeline Message Routing
 * ============================================================================
 * Preserved from OLD bot - DO NOT modify routing logic
 * Enhanced with NEW bot's hardening:
 *   - A1: Length-scaled typing delay
 *   - A5: Weighted between-group gaps
 *   - A3: Fisher-Yates shuffle (RANDOM target order per send)
 *   - C1: Batch fingerprint cleanup
 *   - Per-group send cooldown
 */

import { 
  isTaxiRequest, 
  hasPhoneNumber, 
  containsBlockedNumber,
  getMessageFingerprint,
  extractPickupCity  // ← FIXED: This is in filter.js
} from './filter.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

let config = null;
let log = null;

// Rate limiting
let messageCountHourly = 0;
let messageCountDaily = 0;
let hourlyResetTime = Date.now() + 3600000;
let dailyResetTime = Date.now() + 86400000;

// Circuit breaker
let circuitBreakerFailures = 0;
let circuitBreakerOpen = false;
let circuitBreakerResetTime = 0;

// Deduplication
const fingerprintSet = new Set();

// 🔒 Anti-ban hardening (ported from new core)
// Per-group send cooldown tracking
const lastSendTimeByGroup = new Map();

// Stats tracking
const stats = {
  processed: 0,
  routed: 0,
  ignored: 0,
  blocked: 0,
  duplicate: 0,
  rateLimited: 0,
  circuitOpen: 0,
  noPhone: 0,
  noCity: 0,
  errors: 0
};

// ============================================================================
// INITIALIZATION
// ============================================================================

export function initializeRouter(botConfig, logger) {
  config = botConfig;
  log = logger || console;
  
  log.info('✅ Router initialized with multi-pipeline support');
  log.info(`   Pipelines: ${config.pipelines.length}`);
  config.pipelines.forEach(p => {
    log.info(`   → ${p.name}: cities [${p.cityScope.join(', ')}], targets: ${p.targetGroups.length}`);
  });
}

// ============================================================================
// HUMAN BEHAVIOR TIMING (A1, A5, Random Pause)
// ============================================================================

/**
 * 🔒 A1: Length-scaled typing delay (ported from new core)
 * Short messages (~30 chars):  ~1.0s
 * Long messages (~200+ chars): ~1.8s
 */
function getTypingDelay(textLength) {
  const scaled = textLength * config.humanBehavior.typingBasePerChar;
  return Math.max(
    config.humanBehavior.typingMin,
    Math.min(scaled, config.humanBehavior.typingMax)
  );
}

/**
 * 🔒 A5: Weighted between-group gaps (ported from new core)
 * 65% of delays fall in 0.8-1.1s range, occasionally up to 1.5s
 */
function getWeightedDelay() {
  const range = config.humanBehavior.betweenMax - config.humanBehavior.betweenMin;
  const isNormalBand = Math.random() < config.humanBehavior.betweenWeight;
  
  const weighted = isNormalBand
    ? Math.random() * (range * 0.5)  // First 50% of range (normal band)
    : (range * 0.5) + Math.random() * (range * 0.5);  // Second 50% (occasional higher)
  
  return config.humanBehavior.betweenMin + weighted;
}

/**
 * Random pause simulation (15% chance)
 */
function shouldApplyRandomPause() {
  return Math.random() < config.humanBehavior.randomPauseChance;
}

function getRandomPauseDuration() {
  const range = config.humanBehavior.randomPauseMax - config.humanBehavior.randomPauseMin;
  return config.humanBehavior.randomPauseMin + Math.random() * range;
}

/**
 * 🔒 A3: Fisher-Yates shuffle (ported from new core)
 * Ensures RANDOM target order for every send operation
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ============================================================================
// RATE LIMITING & CIRCUIT BREAKER
// ============================================================================

function checkRateLimits() {
  const now = Date.now();

  // Reset hourly counter
  if (now > hourlyResetTime) {
    messageCountHourly = 0;
    hourlyResetTime = now + 3600000;
  }

  // Reset daily counter
  if (now > dailyResetTime) {
    messageCountDaily = 0;
    dailyResetTime = now + 86400000;
  }

  // Check limits
  if (messageCountHourly >= config.rateLimits.hourly) {
    return { allowed: false, reason: 'hourly' };
  }

  if (messageCountDaily >= config.rateLimits.daily) {
    return { allowed: false, reason: 'daily' };
  }

  return { allowed: true };
}

function incrementRateLimitCounters() {
  messageCountHourly++;
  messageCountDaily++;
}

function checkCircuitBreaker() {
  const now = Date.now();

  // Check if circuit breaker is open
  if (circuitBreakerOpen) {
    if (now < circuitBreakerResetTime) {
      return { open: true };
    }
    // Reset circuit breaker
    circuitBreakerOpen = false;
    circuitBreakerFailures = 0;
    log.info('🔓 Circuit breaker reset');
  }

  return { open: false };
}

function recordCircuitBreakerFailure() {
  circuitBreakerFailures++;

  if (circuitBreakerFailures >= config.circuitBreaker.maxFailures) {
    circuitBreakerOpen = true;
    circuitBreakerResetTime = Date.now() + config.circuitBreaker.breakDuration;
    log.warn(`🔒 Circuit breaker OPEN (${circuitBreakerFailures} failures)`);
  }
}

function resetCircuitBreakerFailures() {
  if (circuitBreakerFailures > 0) {
    circuitBreakerFailures = 0;
  }
}

// ============================================================================
// 🔒 C1: FINGERPRINT CLEANUP (ported from new core)
// ============================================================================

/**
 * C1: Batch cleanup when fingerprint set exceeds cap
 * Trims to 80% of max in one operation (not one-by-one)
 */
function cleanupFingerprintSetIfNeeded() {
  const maxSize = config.deduplication.maxFingerprintCache;
  
  if (fingerprintSet.size > maxSize) {
    const targetSize = Math.floor(maxSize * config.deduplication.cleanupTargetRatio);
    const toDelete = fingerprintSet.size - targetSize;
    
    const iterator = fingerprintSet.values();
    for (let i = 0; i < toDelete; i++) {
      const oldest = iterator.next().value;
      fingerprintSet.delete(oldest);
    }
    
    log.info(`🧹 Fingerprint cleanup: ${toDelete} removed, now ${fingerprintSet.size}/${maxSize}`);
  }
}

// ============================================================================
// 🔒 PER-GROUP SEND COOLDOWN (ported from new core)
// ============================================================================

/**
 * Checks if enough time has passed since last send to this group
 * Returns true if send is allowed
 */
function checkSendCooldown(groupId) {
  const now = Date.now();
  const lastSend = lastSendTimeByGroup.get(groupId);
  
  if (!lastSend) return true;
  
  const timeSinceLastSend = now - lastSend;
  return timeSinceLastSend >= config.deduplication.sendCooldown;
}

/**
 * Records send time for a group
 */
function recordSendTime(groupId) {
  lastSendTimeByGroup.set(groupId, Date.now());
}

/**
 * Periodic cleanup of stale cooldown entries (every 30s)
 */
setInterval(() => {
  const now = Date.now();
  const staleThreshold = config.deduplication.sendCooldown * 30; // 30 seconds
  
  for (const [groupId, timestamp] of lastSendTimeByGroup.entries()) {
    if (now - timestamp > staleThreshold) {
      lastSendTimeByGroup.delete(groupId);
    }
  }
}, 30000);

// ============================================================================
// PIPELINE MATCHING
// ============================================================================

/**
 * Matches a city against all pipelines
 * Returns array of pipelines that match
 */
function matchPipelines(city) {
  const matched = [];

  for (const pipeline of config.pipelines) {
    // Wildcard match
    if (pipeline.cityScope.includes('*')) {
      matched.push(pipeline);
      continue;
    }

    // City match
    if (city && pipeline.cityScope.includes(city)) {
      matched.push(pipeline);
    }
  }

  return matched;
}

// ============================================================================
// MESSAGE SENDING WITH HUMAN BEHAVIOR
// ============================================================================

/**
 * Sends message to a single target group with cooldown check
 */
async function sendToGroup(sock, targetGroupId, messageText) {
  // Check send cooldown
  if (!checkSendCooldown(targetGroupId)) {
    log.warn(`⏱️  Skipping ${targetGroupId.substring(0, 15)}... (cooldown active)`);
    return { success: true, skipped: true };
  }

  try {
    await sock.sendMessage(targetGroupId, { text: messageText });
    recordSendTime(targetGroupId);
    log.info(`✅ Sent to ${targetGroupId.substring(0, 15)}...`);
    resetCircuitBreakerFailures();
    return { success: true };
  } catch (error) {
    log.error(`❌ Send failed to ${targetGroupId.substring(0, 15)}...: ${error.message}`);
    recordCircuitBreakerFailure();
    return { success: false, error: error.message };
  }
}

/**
 * 🔒 A1, A5, A3: Enhanced send loop with timing and shuffling (ported from new core)
 * Sends to all targets with human-like delays and RANDOM order
 */
async function sendToTargets(sock, targetGroups, messageText) {
  if (!targetGroups || targetGroups.length === 0) return;

  // 🔒 A3: Shuffle targets for RANDOM send order
  const shuffledTargets = shuffleArray(targetGroups);

  // 🔒 A1: Typing delay before first send (length-scaled)
  const typingDelay = getTypingDelay(messageText.length);
  log.info(`⌨️  Typing simulation: ${typingDelay}ms`);
  await new Promise(resolve => setTimeout(resolve, typingDelay));

  // Send to all targets sequentially with human delays
  for (let i = 0; i < shuffledTargets.length; i++) {
    const targetGroupId = shuffledTargets[i];

    // Send message
    const result = await sendToGroup(sock, targetGroupId, messageText);

    if (!result.success) {
      stats.errors++;
    }

    // 🔒 A5: Weighted delay between groups (except after last send)
    if (i < shuffledTargets.length - 1) {
      const betweenDelay = getWeightedDelay();
      
      // Random pause chance
      if (shouldApplyRandomPause()) {
        const pauseDuration = getRandomPauseDuration();
        log.info(`⏸️  Random pause: ${pauseDuration}ms`);
        await new Promise(resolve => setTimeout(resolve, pauseDuration));
      }
      
      await new Promise(resolve => setTimeout(resolve, betweenDelay));
    }
  }
}

// ============================================================================
// MAIN ROUTING LOGIC (PRESERVED FROM OLD BOT)
// ============================================================================

export async function routeMessage(sock, message, botConfig) {
  // Use passed config if provided (for flexibility)
  if (botConfig && !config) {
    config = botConfig;
  }

  if (!config) {
    console.error('❌ Router not initialized. Call initializeRouter() first.');
    return;
  }

  stats.processed++;

  try {
    // Extract message metadata
    const messageKey = message.key;
    const messageContent = message.message;

    // Skip if message is from bot itself
    if (messageKey.fromMe) {
      return;
    }

    // Extract text
    let messageText = '';
    if (messageContent?.conversation) {
      messageText = messageContent.conversation;
    } else if (messageContent?.extendedTextMessage?.text) {
      messageText = messageContent.extendedTextMessage.text;
    }

    if (!messageText || messageText.length < config.validation.minMessageLength) {
      stats.ignored++;
      return;
    }

    // Check if from source group
    const sourceGroupId = messageKey.remoteJid;
    if (!config.sourceGroupIds.includes(sourceGroupId)) {
      return;
    }

    // Generate fingerprint for deduplication
    const fingerprint = getMessageFingerprint(messageText, messageKey.id, message.messageTimestamp * 1000);
    
    // Check duplicate
    if (fingerprintSet.has(fingerprint)) {
      stats.duplicate++;
      log.info(`🔁 Duplicate detected: ${fingerprint}`);
      return;
    }

    // Add to fingerprint set
    fingerprintSet.add(fingerprint);
    
    // 🔒 C1: Cleanup fingerprint set if needed
    cleanupFingerprintSetIfNeeded();

    // Check blocked numbers FIRST
    if (containsBlockedNumber(messageText, config.blockedPhoneNumbers)) {
      stats.blocked++;
      log.info(`🚫 Blocked number detected`);
      return;
    }

    // Check if taxi request
    if (!isTaxiRequest(messageText, config.requestKeywords, config.ignoreIfContains)) {
      stats.ignored++;
      return;
    }

    // Check phone number
    if (config.validation.requirePhoneNumber && !hasPhoneNumber(messageText)) {
      stats.noPhone++;
      log.info(`📵 No phone number found`);
      return;
    }

    // Check rate limits
    const rateCheck = checkRateLimits();
    if (!rateCheck.allowed) {
      stats.rateLimited++;
      log.warn(`⏳ Rate limit hit (${rateCheck.reason})`);
      return;
    }

    // Check circuit breaker
    const cbCheck = checkCircuitBreaker();
    if (cbCheck.open) {
      stats.circuitOpen++;
      log.warn(`🔒 Circuit breaker open, skipping`);
      return;
    }

    // Extract city from message
    const allConfiguredCities = config.pipelines
      .flatMap(p => p.cityScope)
      .filter(city => city !== '*');
    
    const uniqueCities = [...new Set(allConfiguredCities)];
    const detectedCity = extractPickupCity(messageText, uniqueCities);

    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📨 Message from: ${sourceGroupId.substring(0, 20)}...`);
    log.info(`🌍 Detected city: ${detectedCity || 'NONE'}`);
    log.info(`📝 Text preview: ${messageText.substring(0, 60)}...`);

    // Match pipelines
    const matchedPipelines = matchPipelines(detectedCity);

    if (matchedPipelines.length === 0) {
      stats.noCity++;
      log.info(`❌ No pipeline matched`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    log.info(`🎯 Matched pipelines: ${matchedPipelines.map(p => p.name).join(', ')}`);

    // Increment rate limit counters
    incrementRateLimitCounters();

    // Send to all matched pipelines
    for (const pipeline of matchedPipelines) {
      log.info(`📤 Routing to pipeline: ${pipeline.name} (${pipeline.targetGroups.length} groups)`);
      
      await sendToTargets(sock, pipeline.targetGroups, messageText);
      
      stats.routed++;
    }

    log.info(`✅ Routing complete`);
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  } catch (error) {
    stats.errors++;
    log.error(`❌ Router error: ${error.message}`);
    recordCircuitBreakerFailure();
  }
}

// ============================================================================
// STATS & CLEANUP
// ============================================================================

export function getRouterStats() {
  return {
    stats: { ...stats },
    messageCount: {
      hourly: messageCountHourly,
      daily: messageCountDaily
    },
    circuitBreaker: {
      isOpen: circuitBreakerOpen,
      failureCount: circuitBreakerFailures
    },
    cache: {
      fingerprintSize: fingerprintSet.size,
      maxSize: config?.deduplication?.maxFingerprintCache || 0
    }
  };
}

export function cleanupRouter(botConfig) {
  if (botConfig && log) {
    log.info('🧹 Cleaning up router...');
    
    // Clear timers
    lastSendTimeByGroup.clear();
    
    log.info('✅ Router cleanup complete');
  }
}