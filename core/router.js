// =============================================================================
// router.js — Multi-Pipeline Routing (FIXED FOR DUAL CITY + OPTIMIZED DELAY)
// =============================================================================
// ✅ CRITICAL FIXES APPLIED:
//    1. Accept pre-extracted text from index.js (not raw msg object)
//    2. Use extractCities() to route BOTH pickup AND drop cities
//    3. Processing delay moved AFTER validation (saves 2-7s on rejected msgs)
//
// PRESERVED FROM BOT-2:
// ✅ Multi-pipeline matching (one message → multiple pipelines)
// ✅ Wildcard pipeline support (cityScope: ["*"])
// ✅ Loop through all pipelines, can match multiple
//
// ANTI-BAN FROM BOT-1:
// ✅ A1: Length-scaled typing delay (1.0-1.8s)
// ✅ A5: Weighted between-group gaps (0.8-1.5s)
// ✅ A3: Fisher-Yates shuffle (target randomization)
// ✅ Circuit breaker integration
// ✅ Rate limiting
// ✅ Per-group send cooldown
// =============================================================================

import {
  isTaxiRequest,
  extractPickupCity,  // backward compat
  extractCities,      // NEW: dual city extraction
  hasPhoneNumber,
  containsBlockedNumber,
  applyPromo,         // promoter bot: number → app link transform
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
// HUMAN BEHAVIOR DELAYS
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

/**
 * Decide whether promo mode is currently ACTIVE for this bot.
 *   • promoMode.enabled must be true (only the promoter bot sets this)
 *   • runtime.json promoActive (true/false) is a live manual override
 *   • otherwise activates automatically once now >= promoMode.activateAt
 *     (null activateAt = still in the warm-up phase → behave like a normal bot)
 */
function promoIsActive(config) {
  const promo = config.promoMode;
  if (!promo?.enabled) return false;

  const override = config.runtime?.promoActive;
  if (override === true) return true;
  if (override === false) return false;

  if (!promo.activateAt) return false;
  const t = Date.parse(promo.activateAt);
  return !Number.isNaN(t) && Date.now() >= t;
}

/**
 * Remove target groups disabled via runtime.json (live "stop sharing to this
 * group" toggle). Returns the original array untouched when nothing is disabled.
 */
function filterDisabledTargets(targets, runtime, log, pipelineName) {
  const disabled = runtime?.disabledTargets;
  if (!disabled || disabled.size === 0) return targets;

  const active = targets.filter((groupId) => !disabled.has(groupId));
  if (active.length < targets.length) {
    log.info(
      `🚫 [${pipelineName}] ${targets.length - active.length} target(s) disabled via runtime toggle — skipping`
    );
  }
  return active;
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
  log,
  sentGroups = null
) {
  if (circuitBreaker.isOpen) {
    log.warn("🔴 Circuit breaker OPEN — aborting send");
    return { successCount: 0, totalTargets: targets.length };
  }

  // Filter out groups already sent to in this message's routing cycle
  const dedupedTargets = sentGroups
    ? targets.filter((groupId) => !sentGroups.has(groupId))
    : targets;

  if (dedupedTargets.length < targets.length) {
    log.info(`⏭️  [${pipelineName}] Skipped ${targets.length - dedupedTargets.length} target(s) already sent by another pipeline`);
  }

  // Filter out groups still in cooldown
  const now = Date.now();
  const readyTargets = dedupedTargets.filter((groupId) => {
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
      if (sentGroups) sentGroups.add(targetGroup);
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
          if (sentGroups) sentGroups.add(targetGroup);
        } catch (retryError) {
          log.error(`❌ → ${shortId}... FAILED (retry)`);
          handleSendFailure(log);
          stats.sendFailures++;
          inFlightSends.delete(targetGroup); // clear stuck cooldown
        }
      } else {
        log.error(`❌ → ${shortId}... ${error.message}`);
        handleSendFailure(log);
        stats.sendFailures++;
        inFlightSends.delete(targetGroup); // clear stuck cooldown
      }
    }
  }

  const totalTime = ((Date.now() - pathStartTime) / 1000).toFixed(1);
  log.info(`⏱️  [${pipelineName}] Delivery time: ${totalTime}s`);

  return { successCount, totalTargets: readyTargets.length };
}

// =============================================================================
// MAIN MESSAGE PROCESSOR (FIXED: accepts text, not msg object)
// ✅ RETURNS: { wasRouted: boolean }
// ✅ PROCESSING DELAY: Moved AFTER validation (optimization)
// ✅ DUAL CITY ROUTING: Uses extractCities() to match pickup AND drop
// =============================================================================

export async function processMessage(sock, text, sourceGroup, config, stats, log) {
  try {
    // FIX: Input is now pre-extracted text from index.js (not raw msg object)
    if (!text || text.trim() === "") {
      return { wasRouted: false };
    }

    // ── Live pause toggle (runtime.json) ──
    // Bot stays connected but forwards nothing while paused. Checked first so a
    // paused bot does zero routing work. Returns wasRouted:false so the caller
    // unlocks the fingerprint (message can still forward once un-paused).
    if (config.runtime?.paused) {
      stats.rejectedPaused = (stats.rejectedPaused || 0) + 1;
      log.info(`⏸️  Forwarding paused — message not routed`);
      return { wasRouted: false };
    }

    // Validation checks use the pre-extracted text
    const messageContent = text;

    // =========================================================================
    // VALIDATION CHECKS (fast — no delays yet)
    // =========================================================================

    // Check 1: Is Taxi Request?
    const isRequest = isTaxiRequest(
      messageContent,
      config.requestKeywords,
      config.ignoreIfContains
    );

    if (!isRequest) {
      log.info(`❌ NOT TAXI REQUEST`);
      stats.rejectedNotTaxi++;
      return { wasRouted: false };
    }

    // Check 2: Blocked Number?
    const hasBlockedNumber = containsBlockedNumber(messageContent, config.blockedPhoneNumbers);
    
    if (hasBlockedNumber) {
      log.warn(`🚫 BLOCKED NUMBER`);
      stats.rejectedBlockedNumber++;
      return { wasRouted: false };
    }

    // Check 3: Has Phone Number?
    const hasPhone = hasPhoneNumber(messageContent);
    
    if (!hasPhone) {
      // Show detailed debug for phone failures
      const phonePattern = /(\+?\d[\d\s\-().]{6,}\d)/g;
      const potentialMatches = messageContent.match(phonePattern);
      
      if (potentialMatches) {
        log.warn(`📵 NO VALID PHONE — found: [${potentialMatches.join(", ")}] | ${messageContent.substring(0, 40)}...`);
      } else {
        log.warn(`📵 NO PHONE | ${messageContent.substring(0, 40)}...`);
      }
      
      stats.rejectedNoPhone++;
      return { wasRouted: false };
    }

    // Check 4: Rate Limit?
    const isLimited = isRateLimited(log);
    
    if (isLimited) {
      stats.rejectedRateLimit = (stats.rejectedRateLimit || 0) + 1;
      return { wasRouted: false };
    }

    // =========================================================================
    // ✅ ALL VALIDATIONS PASSED — Apply processing delay NOW (optimization)
    // =========================================================================
    log.info(`✅ VALIDATION PASSED | Applying processing delay...`);
    
    const processingDelay = Math.floor(Math.random() * (7000 - 2000)) + 2000; // 2-7s
    log.info(`⏳ Processing delay: ${(processingDelay / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, processingDelay));

    log.info(`🔀 Routing to pipelines...`);

    // ── Promoter bot: rewrite the OUTGOING text (number → app link). Routing/city
    //    matching below still uses the ORIGINAL messageContent; only what we SEND
    //    changes. Normal bots skip this entirely (promoMode unset). ──
    let outboundText = messageContent;
    if (promoIsActive(config)) {
      const { text: promoText, replaced } = applyPromo(
        messageContent,
        config.promoMode.appLink,
        config.promoMode.ctaVariants
      );
      outboundText = promoText;
      log.info(`📣 Promo active — replaced ${replaced} number(s) with app link`);
    }

    let routedToPipeline = false;
    let totalSent = 0;
    let allCitiesFound = []; // Track all cities found across pipelines
    const sentGroups = new Set(); // Cross-pipeline dedup: skip groups already sent to

    // =========================================================================
    // PIPELINE ROUTING LOOP (can match multiple pipelines)
    // =========================================================================
    for (const pipeline of config.pipelines) {
      // ── Wildcard pipeline: always matches ──
      if (pipeline.cityScope.includes("*")) {
        log.info(`🎯 Pipeline: ${pipeline.name} (wildcard) | ${pipeline.targetGroups.length} targets`);

        const activeTargets = filterDisabledTargets(
          pipeline.targetGroups,
          config.runtime,
          log,
          pipeline.name
        );
        const shuffledTargets = shuffleArray(activeTargets);

        const { successCount } = await sendToMultipleGroupsSequential(
          sock,
          shuffledTargets,
          outboundText,
          pipeline.name,
          stats,
          log,
          sentGroups
        );

        totalSent += successCount;
        routedToPipeline = true;
        stats.pipelineMatches = (stats.pipelineMatches || 0) + 1;
        continue;
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FIX: Extract BOTH pickup AND drop cities — match if EITHER is in scope
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const { pickup, drop, allCities } = extractCities(
        messageContent,
        pipeline.cityScope
      );

      // Track cities found for debugging
      if (allCities && allCities.length > 0) {
        allCitiesFound = [...new Set([...allCitiesFound, ...allCities])];
      }

      // Match if EITHER pickup OR drop is in this pipeline's city scope
      let matchedCity = null;
      if (pickup && pipeline.cityScope.includes(pickup)) {
        matchedCity = pickup;
      } else if (drop && pipeline.cityScope.includes(drop)) {
        matchedCity = drop;
      }
      
      if (!matchedCity) {
        continue; // No match, try next pipeline
      }

      log.info(`🎯 Pipeline: ${pipeline.name} | Pickup: ${pickup || "none"} | Drop: ${drop || "none"} | Matched: ${matchedCity} | ${pipeline.targetGroups.length} targets`);

      const activeTargets = filterDisabledTargets(
        pipeline.targetGroups,
        config.runtime,
        log,
        pipeline.name
      );
      const shuffledTargets = shuffleArray(activeTargets);

      const { successCount } = await sendToMultipleGroupsSequential(
        sock,
        shuffledTargets,
        outboundText,
        pipeline.name,
        stats,
        log,
        sentGroups
      );

      totalSent += successCount;
      routedToPipeline = true;
      stats.pipelineMatches = (stats.pipelineMatches || 0) + 1;
    }

    if (!routedToPipeline) {
      log.warn(`⏭️  No pipeline matched | Cities found: ${allCitiesFound.join(", ") || "none"} | Available pipelines: ${config.pipelines.map(p => `${p.name}(${p.cityScope.join(",")})`).join(" | ")}`);
      return { wasRouted: false };
    } else {
      log.info(`✅ ROUTING COMPLETE | ${totalSent} messages sent`);
      return { wasRouted: true };
    }
  } catch (error) {
    log.error(`❌ Routing error: ${error.message}`);

    if (
      error.message?.includes("Decryption error") ||
      error.message?.includes("Bad MAC")
    ) {
      log.warn("⚠️  Crypto error (normal)");
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