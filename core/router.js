// =============================================================================
// router.js — Message Processing (Bot-2 pipeline routing PRESERVED)
// =============================================================================
// PRESERVED FROM BOT-2:
// ✅ Pipeline-based routing with cityScope matching
// ✅ extractPickupCity for city detection
// ✅ Multiple pipeline matches allowed per message
// ✅ Target shuffling
// ✅ Human behavior delays
// ✅ Rate limiting
// =============================================================================

import {
  isTaxiRequest,
  extractPickupCity,
  hasPhoneNumber,
  containsBlockedNumber,
} from "./filter.js";

import { GLOBAL_CONFIG } from "./globalConfig.js";

// =============================================================================
// RATE LIMITING (GLOBAL PER BOT)
// =============================================================================

const rateLimitState = new Map();
const RATE_LIMIT_KEY = "__GLOBAL__";

function isRateLimited() {
  const now = Date.now();

  if (!rateLimitState.has(RATE_LIMIT_KEY)) {
    rateLimitState.set(RATE_LIMIT_KEY, {
      hourly: [],
      daily: [],
    });
  }

  const state = rateLimitState.get(RATE_LIMIT_KEY);

  state.hourly = state.hourly.filter((t) => now - t < 3600000);
  state.daily = state.daily.filter((t) => now - t < 86400000);

  if (state.hourly.length >= GLOBAL_CONFIG.rateLimits.hourly) {
    console.log(`⚠️ Rate limit (hourly): ${state.hourly.length}/${GLOBAL_CONFIG.rateLimits.hourly}`);
    return true;
  }

  if (state.daily.length >= GLOBAL_CONFIG.rateLimits.daily) {
    console.log(`⚠️ Rate limit (daily): ${state.daily.length}/${GLOBAL_CONFIG.rateLimits.daily}`);
    return true;
  }

  state.hourly.push(now);
  state.daily.push(now);

  return false;
}

// =============================================================================
// HUMAN BEHAVIOR DELAYS
// =============================================================================

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getWeightedDelay(min, max, weight) {
  const range = max - min;
  const normalRange = range * weight;
  const random = Math.random();

  if (random < weight) {
    return min + Math.floor(Math.random() * normalRange);
  } else {
    return min + Math.floor(Math.random() * range);
  }
}

function calculateTypingDelay(messageLength) {
  const baseDelay = messageLength * GLOBAL_CONFIG.humanBehavior.typingBasePerChar;
  const clampedDelay = Math.max(
    GLOBAL_CONFIG.humanBehavior.typingMin,
    Math.min(baseDelay, GLOBAL_CONFIG.humanBehavior.typingMax)
  );
  return clampedDelay;
}

async function simulateHumanDelay(messageContent) {
  const typingDelay = calculateTypingDelay(messageContent.length);
  console.log(`⏳ Typing delay: ${typingDelay}ms`);
  await new Promise((resolve) => setTimeout(resolve, typingDelay));
}

async function betweenGroupDelay() {
  const delay = getWeightedDelay(
    GLOBAL_CONFIG.humanBehavior.betweenMin,
    GLOBAL_CONFIG.humanBehavior.betweenMax,
    GLOBAL_CONFIG.humanBehavior.betweenWeight
  );
  console.log(`⏳ Between-group delay: ${delay}ms`);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function randomPause() {
  if (Math.random() < GLOBAL_CONFIG.humanBehavior.randomPauseChance) {
    const pauseDuration = getRandomDelay(
      GLOBAL_CONFIG.humanBehavior.randomPauseMin,
      GLOBAL_CONFIG.humanBehavior.randomPauseMax
    );
    console.log(`☕ Random pause: ${pauseDuration}ms`);
    await new Promise((resolve) => setTimeout(resolve, pauseDuration));
  }
}

// =============================================================================
// MESSAGE FORWARDING
// =============================================================================

async function forwardMessage(sock, message, targetGroups, pipelineName) {
  const messageContent =
    message.message.conversation ||
    message.message.extendedTextMessage?.text ||
    "";

  const senderJid = message.key.participant || message.key.remoteJid;
  const senderNumber = senderJid.split("@")[0];

  console.log("\n" + "━".repeat(60));
  console.log("📤 FORWARDING MESSAGE");
  console.log("━".repeat(60));
  console.log(`👤 From: ${senderNumber}`);
  console.log(`📋 Pipeline: ${pipelineName}`);
  console.log(`🎯 Targets: ${targetGroups.length} groups`);
  console.log(`💬 Content: ${messageContent.substring(0, 100)}...`);
  console.log("━".repeat(60));

  let successCount = 0;
  let failCount = 0;

  // Shuffle targets
  const shuffledTargets = [...targetGroups].sort(() => Math.random() - 0.5);

  // Typing delay before first send
  await simulateHumanDelay(messageContent);

  for (let i = 0; i < shuffledTargets.length; i++) {
    const targetGroupId = shuffledTargets[i];

    try {
      // Rate limit check
      if (isRateLimited()) {
        console.log(`⏭️ Skipping (rate limited): ${targetGroupId}`);
        failCount++;
        continue;
      }

      // Between-group delay (after first message)
      if (i > 0) {
        await betweenGroupDelay();
        await randomPause();
      }

      // Send message
      await sock.sendMessage(targetGroupId, {
        text: messageContent,
      });

      successCount++;
      console.log(`✅ Sent to: ${targetGroupId.substring(0, 20)}...`);

    } catch (error) {
      failCount++;
      console.error(`❌ Failed to send to ${targetGroupId}:`, error.message);

      if (
        error.message?.includes("Decryption error") ||
        error.message?.includes("Bad MAC")
      ) {
        console.error("⚠️ Crypto error during send");
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

// =============================================================================
// MAIN MESSAGE PROCESSOR (Bot-2 PIPELINE ROUTING)
// =============================================================================

export async function processMessage(sock, message, config) {
  try {
    const messageType = Object.keys(message.message)[0];

    // Signal protocol message bypass
    if (
      messageType === "protocolMessage" ||
      messageType === "senderKeyDistributionMessage" ||
      messageType === "reactionMessage" ||
      messageType === "messageContextInfo"
    ) {
      return;
    }

    // Extract message content
    const messageContent =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";

    if (!messageContent) {
      return;
    }

    const groupId = message.key.remoteJid;
    const senderJid = message.key.participant || message.key.remoteJid;
    const senderNumber = senderJid.split("@")[0];

    // =========================================================================
    // VALIDATION STAGE
    // =========================================================================

    // Source group check (defensive, already done in index.js)
    const isSourceGroup = config.sourceGroupIds.includes(groupId);
    if (!isSourceGroup) {
      return;
    }

    // =========================================================================
    // CONTENT VALIDATION
    // =========================================================================

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
      console.log(`🚫 Blocked number from: ${senderNumber}`);
      return;
    }

    // Phone number requirement
    if (!hasPhoneNumber(messageContent)) {
      console.log("⏭️ No phone number found");
      return;
    }

    // =========================================================================
    // PIPELINE ROUTING (BOT-2 SPECIFIC LOGIC)
    // =========================================================================

    console.log("\n" + "┏".repeat(60));
    console.log("🔍 ROUTING MESSAGE TO PIPELINES");
    console.log("┗".repeat(60));

    let routedToPipeline = false;

    // Bot-2 allows matching multiple pipelines per message
    for (const pipeline of config.pipelines) {
      // Handle wildcard cityScope
      if (pipeline.cityScope.includes("*")) {
        console.log(`\n✅ Pipeline Match: ${pipeline.name} (wildcard)`);
        console.log(`🎯 Target Groups: ${pipeline.targetGroups.length}`);

        await forwardMessage(
          sock,
          message,
          pipeline.targetGroups,
          pipeline.name
        );

        routedToPipeline = true;
        continue;
      }

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
        pipeline.name
      );

      routedToPipeline = true;
    }

    if (!routedToPipeline) {
      console.log("⏭️ Message did not match any pipeline city scope");
    }

  } catch (error) {
    console.error("❌ Error in processMessage:", error);

    if (
      error.message?.includes("Decryption error") ||
      error.message?.includes("Bad MAC")
    ) {
      console.error("⚠️ Crypto error in message processing");
    }
  }
}