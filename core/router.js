// =============================================================================
// router.js — Multi-Pipeline Message Routing (Bot-2 LOGIC + Bot-1 DELAYS)
// =============================================================================
// PRESERVED FROM BOT-2:
// ✅ Multi-pipeline matching (one message → multiple pipelines)
// ✅ Wildcard pipeline support (cityScope: ["*"])
// ✅ extractPickupCity for city detection
// ✅ Loop through all pipelines, can match multiple
//
// ENHANCED WITH BOT-1:
// ✅ A1: Length-scaled typing delay (1.0-1.8s)
// ✅ A5: Weighted between-group gaps (0.8-1.5s)
// ✅ A3: Fisher-Yates shuffle (target randomization)
// ✅ Circuit breaker integration
// ✅ Rate limiting
// ✅ Per-group send cooldown
//
// FINGERPRINT FIX:
// ✅ Returns routing result { wasRouted: boolean } to core/index.js
// ✅ Fingerprint only saved if wasRouted === true
//
// DEBUG LOGGING:
// ✅ Detailed validation step logging
// ✅ Shows why messages fail validation
// =============================================================================

import {
  isTaxiRequest,
  extractPickupCity,
  hasPhoneNumber,
  containsBlockedNumber,
} from "./filter.js";

import { GLOBAL_CONFIG } from "./globalConfig.js";

// =============================================================================
// STATE - Shared across all pipeline sends
// =============================================================================

const rateLimitState = new Map();
const RATE_LIMIT_KEY = "__GLOBAL__";

// Per-group send cooldown map
const inFlightSends = new Map();

// Circuit breaker state
const circuitBreaker = {
  failureCount: 0,
  lastFailureTime: 0,
  isOpen: false,
  resetTimeout: null,
};

// =============================================================================
// RATE LIMITING (GLOBAL PER BOT)
// =============================================================================

function isRateLimited(log) {
  const now = Date.now();

  if (!rateLimitState.has(RATE_LIMIT_KEY)) {
    rateLimitState.set(RATE_LIMIT_KEY, {
      hourly: [],
      daily: [],
    });
  }

  const state = rateLimitState.get(RATE_LIMIT_KEY);

  // Clean old timestamps
  state.hourly = state.hourly.filter((t) => now - t < 3600000);
  state.daily = state.daily.filter((t) => now - t < 86400000);

  // Check limits
  if (state.hourly.length >= GLOBAL_CONFIG.rateLimits.hourly) {
    log.warn(
      `⚠️  Rate limit (hourly): ${state.hourly.length}/${GLOBAL_CONFIG.rateLimits.hourly}`
    );
    return true;
  }

  if (state.daily.length >= GLOBAL_CONFIG.rateLimits.daily) {
    log.warn(
      `⚠️  Rate limit (daily): ${state.daily.length}/${GLOBAL_CONFIG.rateLimits.daily}`
    );
    return true;
  }

  // Record this send
  state.hourly.push(now);
  state.daily.push(now);

  return false;
}

// =============================================================================
// CIRCUIT BREAKER HELPERS
// =============================================================================

function handleSendFailure(log) {
  circuitBreaker.failureCount++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.failureCount >= GLOBAL_CONFIG.circuitBreaker.maxFailures) {
    if (!circuitBreaker.isOpen) {
      circuitBreaker.isOpen = true;
      log.error(
        `🔴 CIRCUIT BREAKER OPEN — pausing ${GLOBAL_CONFIG.circuitBreaker.breakDuration / 1000}s`
      );

      circuitBreaker.resetTimeout = setTimeout(() => {
        circuitBreaker.isOpen = false;
        circuitBreaker.failureCount = 0;
        log.info("🟢 CIRCUIT BREAKER RESET");
      }, GLOBAL_CONFIG.circuitBreaker.breakDuration);
    }
  }
}

function handleSendSuccess() {
  if (circuitBreaker.failureCount > 0) {
    circuitBreaker.failureCount = Math.max(
      0,
      circuitBreaker.failureCount - 1
    );
  }
}

// =============================================================================
// HUMAN BEHAVIOR DELAYS (Bot-1 implementation)
// =============================================================================

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * A5: Weighted random biased toward lower end
 */
function getWeightedDelay(min, max, weight) {
  const range = max - min;
  if (Math.random() < weight) {
    // Lower band (more common)
    return Math.floor(min + Math.random() * (range * weight));
  }
  // Upper band (less common)
  return Math.floor(
    min + range * weight + Math.random() * (range * (1 - weight))
  );
}

/**
 * A1: Typing delay scaled by message length
 * Clamps output to [TYPING_MIN, TYPING_MAX] (1.0s – 1.8s)
 */
function getTypingDelay(textLength) {
  const raw = textLength * GLOBAL_CONFIG.humanBehavior.typingBasePerChar;
  return Math.min(
    Math.max(raw, GLOBAL_CONFIG.humanBehavior.typingMin),
    GLOBAL_CONFIG.humanBehavior.typingMax
  );
}

/**
 * A3: Fisher-Yates shuffle
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// =============================================================================
// SEND LOOP - Sequential delivery with human-like delays
// =============================================================================

async function sendToMultipleGroupsSequential(
  sock,
  targets,
  text,
  pipelineName,
  stats,
  log
) {
  if (circuitBreaker.isOpen) {
    log.warn("🔴 Circuit breaker OPEN — aborting send");
    return { successCount: 0, totalTargets: targets.length };
  }

  // Filter out groups still in cooldown
  const now = Date.now();
  const readyTargets = targets.filter((groupId) => {
    const lastSend = inFlightSends.get(groupId);
    return (
      !lastSend || now - lastSend >= GLOBAL_CONFIG.deduplication.sendCooldown
    );
  });

  if (readyTargets.length === 0) {
    log.warn("⏭️  All targets in cooldown");
    return { successCount: 0, totalTargets: 0 };
  }

  log.info(
    `📤 [${pipelineName}] Sending to ${readyTargets.length} target(s)...`
  );

  let successCount = 0;
  const pathStartTime = Date.now();

  for (let i = 0; i < readyTargets.length; i++) {
    // Mid-loop circuit breaker check
    if (circuitBreaker.isOpen) {
      log.warn("🔴 Circuit breaker opened mid-send — stopping");
      break;
    }

    const targetGroup = readyTargets[i];
    const shortId = targetGroup.substring(0, 18);

    // A1: Typing delay before FIRST message only
    if (i === 0) {
      const typingDelay = getTypingDelay(text.length);
      log.info(`⌨️  Typing: ${(typingDelay / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, typingDelay));
    }

    // A5: Between-group delay before messages 2, 3, 4...
    if (i > 0) {
      // 15% chance of random pause
      if (Math.random() < GLOBAL_CONFIG.humanBehavior.randomPauseChance) {
        const pauseDuration = getRandomDelay(
          GLOBAL_CONFIG.humanBehavior.randomPauseMin,
          GLOBAL_CONFIG.humanBehavior.randomPauseMax
        );
        log.info(`☕ Random pause: ${(pauseDuration / 1000).toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, pauseDuration));
      } else {
        const gap = getWeightedDelay(
          GLOBAL_CONFIG.humanBehavior.betweenMin,
          GLOBAL_CONFIG.humanBehavior.betweenMax,
          GLOBAL_CONFIG.humanBehavior.betweenWeight
        );
        log.info(`⏳ Gap: ${(gap / 1000).toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, gap));
      }
    }

    // Mark cooldown timestamp
    inFlightSends.set(targetGroup, Date.now());
    const sendStartTime = Date.now();

    try {
      // Direct Baileys send with 15s timeout
      const sendPromise = sock.sendMessage(targetGroup, { text });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout 15s")), 15000)
      );

      await Promise.race([sendPromise, timeoutPromise]);

      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);
      log.info(`✅ → ${shortId}... (${sendTime}s)`);

      handleSendSuccess();
      stats.sendSuccesses++;
      successCount++;
    } catch (error) {
      const sendTime = ((Date.now() - sendStartTime) / 1000).toFixed(2);

      // Single retry on timeout
      if (error.message.includes("Timeout") && sendTime < 16) {
        try {
          await new Promise((r) => setTimeout(r, 1000));
          await sock.sendMessage(targetGroup, { text });
          log.info(`✅ → ${shortId}... (retry OK)`);
          handleSendSuccess();
          stats.sendSuccesses++;
          successCount++;
        } catch (retryError) {
          log.error(`❌ → ${shortId}... FAILED (retry)`);
          handleSendFailure(log);
          stats.sendFailures++;
        }
      } else {
        log.error(`❌ → ${shortId}... ${error.message}`);
        handleSendFailure(log);
        stats.sendFailures++;
      }

      // Clean cooldown on failure
      inFlightSends.delete(targetGroup);
    }
  }

  const totalTime = ((Date.now() - pathStartTime) / 1000).toFixed(1);
  log.info(`⏱️  [${pipelineName}] Delivery time: ${totalTime}s`);

  return { successCount, totalTargets: readyTargets.length };
}

// =============================================================================
// MAIN MESSAGE PROCESSOR (Bot-2 MULTI-PIPELINE ROUTING)
// ✅ NOW RETURNS: { wasRouted: boolean }
// ✅ WITH DEBUG LOGGING
// =============================================================================

export async function processMessage(sock, message, config, stats, log) {
  try {
    const messageType = Object.keys(message.message)[0];

    // Signal protocol message bypass
    if (
      messageType === "protocolMessage" ||
      messageType === "senderKeyDistributionMessage" ||
      messageType === "reactionMessage" ||
      messageType === "messageContextInfo"
    ) {
      return { wasRouted: false };
    }

    // Extract message content
    const messageContent =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";

    if (!messageContent) {
      return { wasRouted: false };
    }

    const groupId = message.key.remoteJid;
    const senderJid = message.key.participant || message.key.remoteJid;
    const senderNumber = senderJid.split("@")[0];

    // =========================================================================
    // 🔍 DEBUG: START VALIDATION LOGGING
    // =========================================================================
    log.info("┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
    log.info("🔍 VALIDATION CHECKS");
    log.info("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛");
    log.info(`   Message preview: "${messageContent.substring(0, 80)}${messageContent.length > 80 ? "..." : ""}"`);
    log.info(`   Message length: ${messageContent.length} chars`);
    log.info(`   Sender: ${senderNumber}`);

    // =========================================================================
    // VALIDATION STEP 1: Is Taxi Request?
    // =========================================================================
    const isRequest = isTaxiRequest(
      messageContent,
      config.requestKeywords,
      config.ignoreIfContains,
      config.blockedPhoneNumbers
    );

    log.info(`\n   ┌─ [CHECK 1/4] Taxi Request Detection`);
    log.info(`   │  Result: ${isRequest ? "✅ PASS" : "❌ FAIL"}`);
    
    if (!isRequest) {
      log.info(`   │  Reason: Message doesn't match taxi request criteria`);
      log.info(`   │  Request keywords (sample): ${config.requestKeywords.slice(0, 5).join(", ")}`);
      log.info(`   │  Ignore keywords (sample): ${config.ignoreIfContains.slice(0, 5).join(", ")}`);
      log.info(`   └─ ❌ REJECTED: Not a taxi request`);
      stats.rejectedNotTaxi++;
      return { wasRouted: false };
    }
    log.info(`   └─ ✅ Message matches taxi request pattern`);

    // =========================================================================
    // VALIDATION STEP 2: Blocked Number Check
    // =========================================================================
    const hasBlockedNumber = containsBlockedNumber(messageContent, config.blockedPhoneNumbers);
    
    log.info(`\n   ┌─ [CHECK 2/4] Blocked Number Check`);
    log.info(`   │  Result: ${hasBlockedNumber ? "❌ FAIL" : "✅ PASS"}`);
    
    if (hasBlockedNumber) {
      log.info(`   │  Reason: Message contains a blocked phone number`);
      log.info(`   │  Sender: ${senderNumber}`);
      log.info(`   │  Total blocked numbers: ${config.blockedPhoneNumbers.length}`);
      log.info(`   └─ ❌ REJECTED: Blocked number detected`);
      stats.rejectedBlockedNumber++;
      return { wasRouted: false };
    }
    log.info(`   └─ ✅ No blocked numbers found`);

    // =========================================================================
    // VALIDATION STEP 3: Phone Number Detection
    // =========================================================================
    const hasPhone = hasPhoneNumber(messageContent);
    
    log.info(`\n   ┌─ [CHECK 3/4] Phone Number Detection`);
    log.info(`   │  Result: ${hasPhone ? "✅ PASS" : "❌ FAIL"}`);
    
    if (!hasPhone) {
      log.info(`   │  Reason: No valid phone number found in message`);
      log.info(`   │  Message text: "${messageContent.substring(0, 100)}..."`);
      
      // Extract potential phone-like patterns for debugging
      const phonePattern = /(\+?\d{1,4}[-.\s]?)?(\(?\d{1,4}\)?[-.\s]?)?[\d-.\s]{7,}/g;
      const potentialMatches = messageContent.match(phonePattern);
      
      if (potentialMatches) {
        log.info(`   │  Potential matches found: ${potentialMatches.join(", ")}`);
        log.info(`   │  (May contain emojis or invalid formats)`);
      } else {
        log.info(`   │  No number-like patterns detected at all`);
      }
      
      log.info(`   └─ ❌ REJECTED: No phone number`);
      stats.rejectedNoPhone++;
      return { wasRouted: false };
    }
    log.info(`   └─ ✅ Valid phone number detected`);

    // =========================================================================
    // VALIDATION STEP 4: Rate Limit Check
    // =========================================================================
    const isLimited = isRateLimited(log);
    
    log.info(`\n   ┌─ [CHECK 4/4] Rate Limit Check`);
    log.info(`   │  Result: ${isLimited ? "❌ FAIL" : "✅ PASS"}`);
    
    if (isLimited) {
      log.info(`   │  Reason: Rate limit exceeded`);
      log.info(`   └─ ❌ REJECTED: Rate limited`);
      stats.rejectedRateLimit = (stats.rejectedRateLimit || 0) + 1;
      return { wasRouted: false };
    }
    log.info(`   └─ ✅ Within rate limits`);

    // =========================================================================
    // ✅ ALL VALIDATIONS PASSED
    // =========================================================================
    log.info("\n   ╔═══════════════════════════════════════════════════════════╗");
    log.info("   ║  ✅ ALL VALIDATION CHECKS PASSED - ROUTING MESSAGE       ║");
    log.info("   ╚═══════════════════════════════════════════════════════════╝");

    // =========================================================================
    // MULTI-PIPELINE ROUTING (Bot-2 CORE LOGIC PRESERVED)
    // =========================================================================

    log.info("\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
    log.info("🔍 ROUTING MESSAGE TO PIPELINES");
    log.info("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛");

    let routedToPipeline = false;
    let totalSent = 0;

    // Bot-2: Loop through ALL pipelines - can match multiple
    for (const pipeline of config.pipelines) {
      // ── Wildcard pipeline: always matches ──
      if (pipeline.cityScope.includes("*")) {
        log.info(`\n✅ Pipeline Match: ${pipeline.name} (wildcard)`);
        log.info(`🎯 Target Groups: ${pipeline.targetGroups.length}`);

        // A3: Shuffle targets
        const shuffledTargets = shuffleArray(pipeline.targetGroups);

        const { successCount } = await sendToMultipleGroupsSequential(
          sock,
          shuffledTargets,
          messageContent,
          pipeline.name,
          stats,
          log
        );

        totalSent += successCount;
        routedToPipeline = true;
        stats.pipelineMatches = (stats.pipelineMatches || 0) + 1;
        continue;
      }

      // ── City-based pipeline: extract pickup city ──
      const pickupCity = extractPickupCity(
        messageContent,
        pipeline.cityScope
      );

      if (!pickupCity) {
        log.info(`⏭️  Pipeline '${pipeline.name}': No matching city`);
        continue;
      }

      log.info(`\n✅ Pipeline Match: ${pipeline.name}`);
      log.info(`📍 Pickup City: ${pickupCity}`);
      log.info(`🎯 Target Groups: ${pipeline.targetGroups.length}`);

      // A3: Shuffle targets
      const shuffledTargets = shuffleArray(pipeline.targetGroups);

      const { successCount } = await sendToMultipleGroupsSequential(
        sock,
        shuffledTargets,
        messageContent,
        pipeline.name,
        stats,
        log
      );

      totalSent += successCount;
      routedToPipeline = true;
      stats.pipelineMatches = (stats.pipelineMatches || 0) + 1;
    }

    if (!routedToPipeline) {
      log.info("\n⏭️  Message did not match any pipeline city scope");
      return { wasRouted: false };
    } else {
      log.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      log.info(`✅ ROUTING COMPLETE: ${totalSent} messages sent`);
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return { wasRouted: true };
    }
  } catch (error) {
    log.error(`❌ Error in processMessage: ${error.message}`);
    log.error(`   Stack: ${error.stack}`);

    if (
      error.message?.includes("Decryption error") ||
      error.message?.includes("Bad MAC")
    ) {
      log.error("⚠️  Crypto error in message processing");
    }

    return { wasRouted: false };
  }
}

// Cleanup stale cooldown entries every 30s
setInterval(() => {
  const now = Date.now();
  for (const [groupId, timestamp] of inFlightSends.entries()) {
    if (now - timestamp > 30000) {
      inFlightSends.delete(groupId);
    }
  }
}, 30000);