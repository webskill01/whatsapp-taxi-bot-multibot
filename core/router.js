/**
 * ============================================================================
 * ROUTER - Message Processing Pipeline
 * ============================================================================
 * FIXES APPLIED:
 * - Single fingerprint authority (no competition with core)
 * - Signal/protocol message bypass
 * - Respects core-level deduplication
 * - No disk I/O blocking during reconnect
 * - Anti-ban gates remain intact
 * ============================================================================
 */

import {
  isTaxiRequest,
  extractPickupCity,
  hasPhoneNumber,
  containsBlockedNumber,
  getMessageFingerprint,
} from "./filter.js";

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const rateLimitState = new Map();
const messageFingerprints = new Map(); // In-memory only, no disk I/O
const FINGERPRINT_TTL = 300000; // 5 minutes
const MAX_FINGERPRINTS = 5000; // Hard safety cap

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of messageFingerprints.entries()) {
    if (now - timestamp > FINGERPRINT_TTL) {
      messageFingerprints.delete(key);
    }
  }
  
  // Hard safety cap - prevent memory issues
  if (messageFingerprints.size > MAX_FINGERPRINTS) {
    messageFingerprints.clear();
    console.log(`⚠️ Fingerprint map exceeded ${MAX_FINGERPRINTS} entries - cleared`);
  }
}, 60000);

// ============================================================================
// ROUTER STATE RESET (called from core on reconnect)
// ============================================================================

export function resetRouterState() {
  messageFingerprints.clear();
  rateLimitState.clear();
  console.log("🔄 Router state reset (aligned with socket reconnect)");
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// WhatsApp rate limits are per sender (global), not per target group
const RATE_LIMIT_KEY = "__GLOBAL__";

function isRateLimited(groupId, config) {
  const now = Date.now();
  
  if (!rateLimitState.has(RATE_LIMIT_KEY)) {
    rateLimitState.set(RATE_LIMIT_KEY, {
      hourly: [],
      daily: [],
    });
  }

  const state = rateLimitState.get(RATE_LIMIT_KEY);

  // Clean old entries
  state.hourly = state.hourly.filter((t) => now - t < 3600000);
  state.daily = state.daily.filter((t) => now - t < 86400000);

  // Check limits
  if (state.hourly.length >= config.rateLimits.hourly) {
    console.log(`⚠️ Global rate limit (hourly) reached - skipping: ${groupId}`);
    return true;
  }

  if (state.daily.length >= config.rateLimits.daily) {
    console.log(`⚠️ Global rate limit (daily) reached - skipping: ${groupId}`);
    return true;
  }

  // Record send
  state.hourly.push(now);
  state.daily.push(now);

  return false;
}

// ============================================================================
// HUMAN BEHAVIOR SIMULATION
// ============================================================================

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function simulateHumanBehavior(sock, groupId, config) {
  const behavior = config.humanBehavior;
  
  // Guard against undefined socket
  if (!sock || !sock.sendPresenceUpdate) {
    return;
  }

  let totalDelay = 0;
  const MAX_TOTAL_DELAY = 6000; // 6 seconds cap

  // Pre-send delay
  const preSendDelay = getRandomDelay(
    behavior.preSendTypingDelay.min,
    behavior.preSendTypingDelay.max
  );

  console.log(`⏳ Pre-send delay: ${preSendDelay}ms`);
  await new Promise((resolve) => setTimeout(resolve, preSendDelay));
  totalDelay += preSendDelay;

  // Simulate typing
  if (behavior.simulateTyping && Math.random() < behavior.typingProbability && totalDelay < MAX_TOTAL_DELAY) {
    try {
      await sock.sendPresenceUpdate("composing", groupId);
      
      const typingDuration = Math.min(
        getRandomDelay(behavior.typingDuration.min, behavior.typingDuration.max),
        MAX_TOTAL_DELAY - totalDelay
      );
      
      console.log(`⌨️ Simulating typing: ${typingDuration}ms`);
      await new Promise((resolve) => setTimeout(resolve, typingDuration));
      totalDelay += typingDuration;
      
      await sock.sendPresenceUpdate("paused", groupId);
    } catch (error) {
      console.error("⚠️ Typing simulation error:", error.message);
    }
  }

  // Random pre-message pause
  if (Math.random() < 0.3 && totalDelay < MAX_TOTAL_DELAY) {
    const pauseDelay = Math.min(
      getRandomDelay(500, 2000),
      MAX_TOTAL_DELAY - totalDelay
    );
    console.log(`⏸️ Random pause: ${pauseDelay}ms`);
    await new Promise((resolve) => setTimeout(resolve, pauseDelay));
  }
}

// ============================================================================
// MESSAGE FORWARDING
// ============================================================================

async function forwardMessage(sock, message, targetGroups, sourceName, config) {
  const messageContent = message.message.conversation || 
                        message.message.extendedTextMessage?.text || 
                        "";

  const senderJid = message.key.participant || message.key.remoteJid;
  const senderNumber = senderJid.split("@")[0];

  console.log("\n" + "━".repeat(60));
  console.log("📤 FORWARDING MESSAGE");
  console.log("━".repeat(60));
  console.log(`👤 From: ${senderNumber}`);
  console.log(`📋 Source: ${sourceName || "Unknown"}`);
  console.log(`🎯 Targets: ${targetGroups.length} groups`);
  console.log(`💬 Content: ${messageContent.substring(0, 100)}...`);
  console.log("━".repeat(60));

  let successCount = 0;
  let failCount = 0;

  // Shuffle targets once before loop
  const shuffledTargets = [...targetGroups].sort(() => Math.random() - 0.5);

  for (const targetGroupId of shuffledTargets) {
    try {
      // Rate limit check
      if (isRateLimited(targetGroupId, config)) {
        console.log(`⏭️ Skipping (rate limited): ${targetGroupId}`);
        failCount++;
        continue;
      }

      // Human behavior simulation
      await simulateHumanBehavior(sock, targetGroupId, config);

      // Send message
      await sock.sendMessage(targetGroupId, {
        text: messageContent,
      });

      successCount++;
      console.log(`✅ Sent to: ${targetGroupId}`);

      // Inter-message delay
      const interDelay = getRandomDelay(
        config.humanBehavior.interMessageDelay.min,
        config.humanBehavior.interMessageDelay.max
      );
      
      await new Promise((resolve) => setTimeout(resolve, interDelay));

    } catch (error) {
      failCount++;
      console.error(`❌ Failed to send to ${targetGroupId}:`, error.message);

      // If error is crypto-related, log but continue
      if (
        error.message?.includes("Decryption error") ||
        error.message?.includes("Bad MAC")
      ) {
        console.error("⚠️ Crypto error during send - may need reconnect");
      }
    }
  }

  console.log("\n" + "━".repeat(60));
  console.log("📊 FORWARDING SUMMARY");
  console.log("━".repeat(60));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log("━".repeat(60) + "\n");
}

// ============================================================================
// FINGERPRINT DEDUPLICATION (SINGLE AUTHORITY)
// ============================================================================

function isDuplicateMessage(messageContent, messageId, remoteJid) {
  // Generate fingerprint using filter.js function
  // Include source group to prevent cross-group collisions
  
  const fingerprint = getMessageFingerprint(
    `${remoteJid}|${messageContent}`,
    messageId
  );

  // Check if seen before
  if (messageFingerprints.has(fingerprint)) {
    return true;
  }
  if (messageFingerprints.size > MAX_FINGERPRINTS) {
  messageFingerprints.clear();
}
  // Record fingerprint with timestamp
  messageFingerprints.set(fingerprint, Date.now());
  return false;
}

// ============================================================================
// MAIN MESSAGE PROCESSOR
// ============================================================================

export async function processMessage(sock, message, config) {
  try {
    const messageType = Object.keys(message.message)[0];

    // ========================================================================
    // SIGNAL PROTOCOL MESSAGE BYPASS - CRITICAL
    // ========================================================================
    // These messages MUST NOT go through validation/deduplication pipeline
    // They are part of Signal's encryption layer and must be passed through
    
    if (
      messageType === "protocolMessage" ||
      messageType === "senderKeyDistributionMessage" ||
      messageType === "reactionMessage" ||
      messageType === "messageContextInfo"
    ) {
      // Silent bypass - no processing
      return;
    }

    // Extract message content
    const messageContent =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";

    // Skip empty messages
    if (!messageContent) {
      return;
    }

    const groupId = message.key.remoteJid;
    const senderJid = message.key.participant || message.key.remoteJid;
    const senderNumber = senderJid.split("@")[0];

    // ========================================================================
    // VALIDATION STAGE
    // ========================================================================

    // Check if message is from a source group
    const isSourceGroup = config.sourceGroupIds.includes(groupId);

    if (!isSourceGroup) {
      console.log(`⏭️ Not a source group: ${groupId}`);
      return;
    }

    // ========================================================================
    // DEDUPLICATION STAGE - RESPECTS CORE ACCEPTANCE
    // ========================================================================
    // Core has already deduplicated at socket level
    // This is a secondary safety check for router-level duplicates only
    
    if (isDuplicateMessage(messageContent, message.key.id, message.key.remoteJid)) {
      return;
    }

    // ========================================================================
    // CONTENT VALIDATION
    // ========================================================================

    // Check if message is a taxi request
    const isRequest = isTaxiRequest(
      messageContent,
      config.requestKeywords,
      config.ignoreIfContains,
      config.blockedPhoneNumbers
    );

    if (!isRequest) {
      console.log("⏭️ Not a taxi request");
      return;
    }

    // Blocked number check
    if (containsBlockedNumber(messageContent, config.blockedPhoneNumbers)) {
      console.log(`🚫 Blocked number detected from: ${senderNumber}`);
      return;
    }

    // Phone number requirement
    if (!hasPhoneNumber(messageContent)) {
      console.log("⏭️ No phone number found");
      return;
    }

    // ========================================================================
    // PIPELINE ROUTING
    // ========================================================================

    console.log("\n" + "┏".repeat(60));
    console.log("🔍 ROUTING MESSAGE TO PIPELINES");
    console.log("┗".repeat(60));

    let routedToPipeline = false;

    for (const pipeline of config.pipelines) {
      // Extract pickup city
      const pickupCity = extractPickupCity(messageContent, pipeline.cityScope);

      if (!pickupCity) {
        console.log(`⏭️ Pipeline '${pipeline.name}': No matching city`);
        continue;
      }

      console.log(`\n✅ Pipeline Match: ${pipeline.name}`);
      console.log(`📍 Pickup City: ${pickupCity}`);
      console.log(`🎯 Target Groups: ${pipeline.targetGroups.length}`);

      // Forward to pipeline target groups
      await forwardMessage(
        sock,
        message,
        pipeline.targetGroups,
        pipeline.name,
        config
      );

      routedToPipeline = true;
    }

    if (!routedToPipeline) {
      console.log("⏭️ Message did not match any pipeline city scope");
    }

  } catch (error) {
    console.error("❌ Error in processMessage:", error);
    
    // Log crypto errors but don't crash
    if (
      error.message?.includes("Decryption error") ||
      error.message?.includes("Bad MAC")
    ) {
      console.error("⚠️ Crypto error in message processing");
    }
  }
}