/**
 * ============================================================================
 * GLOBAL CONFIGURATION
 * ============================================================================
 * Shared across ALL bot instances
 * Bot-2 structure + Bot-1 anti-ban hardening constants
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Volatile block/ignore data lives in core/blocked-data.json — gitignored so it
 * can be edited directly on the VPS without a git push. See scripts/block.js for
 * a dedup-safe way to add entries.
 *
 * Fail-CLOSED on purpose: if the file is missing or malformed we throw instead of
 * falling back to empty lists. An empty ignore/block list would make the bot
 * forward EVERYTHING (spam + ban risk), so refusing to start is the safer default.
 */
function loadBlockedData() {
  const filePath = join(__dirname, "blocked-data.json");
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(
      `[globalConfig] Could not load ${filePath}: ${err.message}\n` +
      `This file holds blockedPhoneNumbers / blockedSenders / ignoreIfContains and is ` +
      `gitignored. Copy it onto this machine before starting the bot.`
    );
  }
  for (const key of ["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"]) {
    if (!Array.isArray(data[key])) {
      throw new Error(`[globalConfig] blocked-data.json is missing or malformed array: "${key}"`);
    }
  }
  return data;
}

const _blockedData = loadBlockedData();

export const GLOBAL_CONFIG = {
  /**
   * Taxi request keywords (normalized to lowercase)
   */
  requestKeywords: [
    "need",
    "tu",
    "pickup",
    "pik",
    "pick",
    "urgent",
    "carrier",
    "time",
    "drop",
    "cab",
    "car",
    "taxi",
    "ride",
    "sedan",
    "sadan",
    "crysta",
    "dezire",
    "honda",
    "crunt",
    "small",
    "aura",
    "suv",
    "innova",
    "ertiga",
    "dzire",
    "etios",
    "current",
    "tempo",
    "parcel",
    "airport",
    "outstation",
  ].map((k) => k.toLowerCase()),

  /**
   * Ignore keywords — loaded from core/blocked-data.json (gitignored).
   * NFC-normalized so precomposed/decomposed Unicode variants (Hindi/Punjabi
   * nukta letters) match regardless of which form the sender's keyboard emits.
   */
  ignoreIfContains: _blockedData.ignoreIfContains.map((k) => k.normalize("NFC").toLowerCase()),

  // ==========================================================================
  // GLOBALLY BLOCKED PHONE NUMBERS — loaded from core/blocked-data.json
  // 10-digit numbers; country code variants checked automatically.
  // ==========================================================================
  blockedPhoneNumbers: _blockedData.blockedPhoneNumbers,

  // ==========================================================================
  // GLOBALLY BLOCKED SENDERS — loaded from core/blocked-data.json
  // Blocks the SENDER: every message they send from any group is dropped
  // before processing. 10-digit numbers; country code (91) stripped automatically.
  // ==========================================================================
  blockedSenders: _blockedData.blockedSenders,

  // 🔒 Anti-ban hardening (Bot-1 constants)
  rateLimits: {
    hourly: 200,
    daily: 2000,
  },

  validation: {
    minMessageLength: 10,
    requirePhoneNumber: true,
  },

  // 🔒 A1 + A5: Human behavior delays
  humanBehavior: {
    // A1: Length-scaled typing delay
    typingBasePerChar: 4, // ms per character
    typingMin: 1000, // 1.0s floor
    typingMax: 1800, // 1.8s ceiling

    // A5: Weighted between-group gaps
    betweenMin: 800, // 0.8s floor
    betweenMax: 1500, // 1.5s ceiling
    betweenWeight: 0.65, // 65% bias toward low end

    // Random pauses
    randomPauseChance: 0.15,
    randomPauseMin: 1500,
    randomPauseMax: 3000,
  },

  // 🔒 Circuit breaker
  circuitBreaker: {
    maxFailures: 10,
    breakDuration: 60000, // 60s cooldown
  },

  // 🔒 C1 + C2: Deduplication
  deduplication: {
    maxFingerprintCache: 2000,
    cleanupTargetRatio: 0.8, // C1: Trim to 80% on overflow
    sendCooldown: 1000, // 1s per-group cooldown
    fingerprintFile: ".forwarded-messages.json",
    fingerprintTTL: 7200000, // 2h
    fingerprintSaveCap: 1000,
    saveDebounceMs: 30000, // C2: 30s debounced writes
    maxReplayIds: 200, // B2: Rolling replay ID set
  },

  // 🔒 B1 + A4: Reconnect protection
  reconnect: {
    strictAgeMs: 10000,       // B1: drop messages >10s old after reconnect
    strictWindowDuration: 30000, // B1: enforce for 30s after reconnect
    settlingMin: 5000,        // A4: 5-15s settling delay
    settlingMax: 15000,
  },
};
