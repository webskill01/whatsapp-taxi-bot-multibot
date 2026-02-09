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
  extractPickupCity
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
  
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('🚀 ROUTER INITIALIZED');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
    log.info(`♻️  HOURLY RESET: ${messageCountHourly} messages sent in last hour`);
    messageCountHourly = 0;
    hourlyResetTime = now + 3600000;
  }

  // Reset daily counter
  if (now > dailyResetTime) {
    log.info(`♻️  DAILY RESET: ${messageCountDaily} messages sent in last 24 hours`);
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
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('🔓 CIRCUIT BREAKER RESET');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  return { open: false };
}

function recordCircuitBreakerFailure() {
  circuitBreakerFailures++;

  if (circuitBreakerFailures >= config.circuitBreaker.maxFailures) {
    circuitBreakerOpen = true;
    circuitBreakerResetTime = Date.now() + config.circuitBreaker.breakDuration;
    
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.error('🔒 CIRCUIT BREAKER TRIGGERED');
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.error(`   ❌ Consecutive failures: ${circuitBreakerFailures}`);
    log.error(`   ⏳ Cooldown period: ${config.circuitBreaker.breakDuration / 1000}s`);
    log.error(`   🔓 Auto-reset at: ${new Date(circuitBreakerResetTime).toLocaleTimeString()}`);
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
    
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('🧹 FINGERPRINT CLEANUP');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info(`   🗑️  Removed: ${toDelete} old entries`);
    log.info(`   📊 Current size: ${fingerprintSet.size}/${maxSize}`);
    log.info(`   ✅ Memory optimized`);
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
async function sendToGroup(sock, targetGroupId, messageText, groupIndex, totalGroups) {
  // Check send cooldown
  if (!checkSendCooldown(targetGroupId)) {
    log.warn(`   ${groupIndex}/${totalGroups}. ⏱️  ${targetGroupId.substring(0, 18)}... (cooldown active, skipped)`);
    return { success: true, skipped: true };
  }

  const sendStartTime = Date.now();

  try {
    await sock.sendMessage(targetGroupId, { text: messageText });
    recordSendTime(targetGroupId);
    
    const sendDuration = Date.now() - sendStartTime;
    log.info(`   ${groupIndex}/${totalGroups}. ✅ ${targetGroupId.substring(0, 18)}... (${(sendDuration / 1000).toFixed(2)}s)`);
    
    resetCircuitBreakerFailures();
    return { success: true };
  } catch (error) {
    const sendDuration = Date.now() - sendStartTime;
    log.error(`   ${groupIndex}/${totalGroups}. ❌ ${targetGroupId.substring(0, 18)}... FAILED (${(sendDuration / 1000).toFixed(2)}s)`);
    log.error(`      Error: ${error.message}`);
    
    recordCircuitBreakerFailure();
    return { success: false, error: error.message };
  }
}

/**
 * 🔒 A1, A5, A3: Enhanced send loop with timing and shuffling (ported from new core)
 * Sends to all targets with human-like delays and RANDOM order
 */
async function sendToTargets(sock, targetGroups, messageText, pipelineName) {
  if (!targetGroups || targetGroups.length === 0) return;

  const sendStartTime = Date.now();

  // 🔒 A3: Shuffle targets for RANDOM send order
  const shuffledTargets = shuffleArray(targetGroups);
  
  log.info(`   🔀 Shuffled order: ${shuffledTargets.length} targets (random sequence)`);

  // 🔒 A1: Typing delay before first send (length-scaled)
  const typingDelay = getTypingDelay(messageText.length);
  log.info(`   ⌨️  Typing simulation: ${(typingDelay / 1000).toFixed(1)}s (${messageText.length} chars)`);
  await new Promise(resolve => setTimeout(resolve, typingDelay));

  log.info(`   📤 Sending to ${shuffledTargets.length} group(s)...`);

  let successCount = 0;
  let skippedCount = 0;

  // Send to all targets sequentially with human delays
  for (let i = 0; i < shuffledTargets.length; i++) {
    const targetGroupId = shuffledTargets[i];
    const groupIndex = i + 1;

    // Send message
    const result = await sendToGroup(sock, targetGroupId, messageText, groupIndex, shuffledTargets.length);

    if (result.success) {
      if (result.skipped) {
        skippedCount++;
      } else {
        successCount++;
      }
    } else {
      stats.errors++;
    }

    // 🔒 A5: Weighted delay between groups (except after last send)
    if (i < shuffledTargets.length - 1) {
      // Random pause chance (15%)
      if (shouldApplyRandomPause()) {
        const pauseDuration = getRandomPauseDuration();
        log.info(`   ⏸️  Random pause: ${(pauseDuration / 1000).toFixed(1)}s (natural variance)`);
        await new Promise(resolve => setTimeout(resolve, pauseDuration));
      }
      
      const betweenDelay = getWeightedDelay();
      log.info(`   ⏳ Gap: ${(betweenDelay / 1000).toFixed(2)}s`);
      await new Promise(resolve => setTimeout(resolve, betweenDelay));
    }
  }

  const totalSendTime = ((Date.now() - sendStartTime) / 1000).toFixed(1);
  
  log.info(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   📊 Pipeline "${pipelineName}" Summary:`);
  log.info(`      ✅ Successful: ${successCount}`);
  log.info(`      ⏭️  Skipped: ${skippedCount}`);
  log.info(`      ❌ Failed: ${stats.errors}`);
  log.info(`      ⏱️  Total time: ${totalSendTime}s`);
  log.info(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
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
      log.info(`🔁 DUPLICATE DETECTED: ${fingerprint.substring(0, 20)}...`);
      return;
    }

    // Add to fingerprint set
    fingerprintSet.add(fingerprint);
    
    // 🔒 C1: Cleanup fingerprint set if needed
    cleanupFingerprintSetIfNeeded();

    // Check blocked numbers FIRST
    if (containsBlockedNumber(messageText, config.blockedPhoneNumbers)) {
      stats.blocked++;
      log.info(`🚫 BLOCKED NUMBER DETECTED - message rejected`);
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
      log.info(`📵 NO PHONE NUMBER - message rejected`);
      return;
    }

    // Check rate limits
    const rateCheck = checkRateLimits();
    if (!rateCheck.allowed) {
      stats.rateLimited++;
      log.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.warn(`⏳ RATE LIMIT HIT (${rateCheck.reason})`);
      log.warn(`   Hourly: ${messageCountHourly}/${config.rateLimits.hourly}`);
      log.warn(`   Daily: ${messageCountDaily}/${config.rateLimits.daily}`);
      log.warn(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    // Check circuit breaker
    const cbCheck = checkCircuitBreaker();
    if (cbCheck.open) {
      stats.circuitOpen++;
      log.warn(`🔒 CIRCUIT BREAKER OPEN - message skipped`);
      return;
    }

    // Extract city from message
    const allConfiguredCities = config.pipelines
      .flatMap(p => p.cityScope)
      .filter(city => city !== '*');
    
    const uniqueCities = [...new Set(allConfiguredCities)];
    const detectedCity = extractPickupCity(messageText, uniqueCities);

    // ━━━ BEGIN ROUTING ━━━
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('📨 NEW MESSAGE RECEIVED');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info(`🌍 Detected city: ${detectedCity || 'NONE'}`);
    log.info(`📝 Message preview: "${messageText.substring(0, 80)}${messageText.length > 80 ? '...' : ''}"`);
    log.info(`🔑 Fingerprint: ${fingerprint.substring(0, 25)}...`);
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Match pipelines
    const matchedPipelines = matchPipelines(detectedCity);

    if (matchedPipelines.length === 0) {
      stats.noCity++;
      log.info(`❌ NO PIPELINE MATCHED`);
      log.info(`   City: ${detectedCity || 'none'}`);
      log.info(`   Available pipelines: ${config.pipelines.map(p => p.name).join(', ')}`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    log.info(`🎯 MATCHED PIPELINES: ${matchedPipelines.length}`);
    matchedPipelines.forEach((p, idx) => {
      log.info(`   ${idx + 1}. ${p.name} (${p.targetGroups.length} targets)`);
    });
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Increment rate limit counters
    incrementRateLimitCounters();

    // Send to all matched pipelines
    for (const pipeline of matchedPipelines) {
      log.info(`📤 ROUTING TO PIPELINE: ${pipeline.name}`);
      log.info(`   City scope: [${pipeline.cityScope.join(', ')}]`);
      log.info(`   Target groups: ${pipeline.targetGroups.length}`);
      
      await sendToTargets(sock, pipeline.targetGroups, messageText, pipeline.name);
      
      stats.routed++;
    }

    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('✅ ROUTING COMPLETE');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info(`📊 Rate limits: ${messageCountHourly}/${config.rateLimits.hourly} hourly, ${messageCountDaily}/${config.rateLimits.daily} daily`);
    log.info(`📈 Session stats: Processed ${stats.processed}, Routed ${stats.routed}, Ignored ${stats.ignored}`);
    log.info(`🗑️  Fingerprint cache: ${fingerprintSet.size}/${config.deduplication.maxFingerprintCache}`);
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    stats.errors++;
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.error('❌ ROUTER ERROR');
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.error(`   Message: ${error.message}`);
    log.error(`   Stack: ${error.stack}`);
    log.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('🧹 ROUTER CLEANUP');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Clear timers
    lastSendTimeByGroup.clear();
    log.info('   ✅ Cooldown timers cleared');
    
    // Log final stats
    log.info(`   📊 Final stats:`);
    log.info(`      Processed: ${stats.processed}`);
    log.info(`      Routed: ${stats.routed}`);
    log.info(`      Ignored: ${stats.ignored}`);
    log.info(`      Duplicates: ${stats.duplicate}`);
    log.info(`      Errors: ${stats.errors}`);
    
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log.info('✅ ROUTER CLEANUP COMPLETE');
    log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
}