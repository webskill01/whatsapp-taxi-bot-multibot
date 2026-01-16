/**
 * Global configuration shared across ALL bot instances
 */

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
    "outstation"
  ].map(k => k.toLowerCase()),

  /**
   * Ignore keywords (normalized to lowercase)
   */
  ignoreIfContains: [
    "good morning",
    "good night",
    "gm",
    "gn",
    "free",
    "fre",
    "ferr",
    "frre",
    "link",
    "join",
    "exchange",
    "xchange",
    "ex",
    "exx",
    "khali",
    "khaali",
    "khadi",      // खड़ी (standing/parked)
    "khari",
    "sale",
    "available",
    "avialable",
    "loan",
    "fraud",
    "frod",
    "frode",
    "ford",
    "honi",
    "kali",
    "hone",
    "hoto",
    "खाली",
    "खड़ी",
    "ਖਾਲੀ",
    "ਖੜੀ",
    "empty",
    "taxiwale"
  ].map(k => k.toLowerCase()),

  /**
   * Globally blocked phone numbers
   */
  blockedPhoneNumbers: [
    "9855880586",
    "6283647124",
    "9891562384",
    "9736688640",
    "7696885288",
    "9763388678",
    "9736688678",
    "7888749316",
    "9465661404",
    "9914577606",
    "7065843991",
    "9568471648",
    "9053581010",
    "7827147818",
    "8000183633",
    "8146915221",
    "9214847225",
    "6350027596",
    "8054609766",
    "8283841812",
    "7526823870",
    "9855325054",
    "7888387141"
  ],

  rateLimits: {
    hourly: 80,
    daily: 700
  },

  validation: {
    minMessageLength: 10,
    requirePhoneNumber: true
  },

  humanBehavior: {
    minTypingTime: 2000,
    maxTypingTime: 4000,
    minBetweenGroups: 2000,
    maxBetweenGroups: 4000,
    randomPauseChance: 0.15,
    randomPauseDuration: 3000
  },

  circuitBreaker: {
    maxFailures: 10,
    breakDuration: 60000
  },

  deduplication: {
    maxFingerprintCache: 2000,
    sendCooldown: 1000
  }
};