/**
 * ============================================================================
 * FILTER - Message Validation & City Extraction (FIXED)
 * ============================================================================
 * ✅ FIXES:
 *    1. extractCities() now returns BOTH pickup AND drop cities
 *    2. "X drop Y" pattern detection added (e.g., "Manali drop Chandigarh")
 *    3. "current X" pattern detection for pickup location
 *    4. Backward compatible: extractPickupCity() still works
 * ============================================================================
 */

const ROUTE_PATTERNS = [
  /\bfrom\b.+\bto\b/i,
  /\bto\b.+\bfrom\b/i,
  /\b\w+\s+to\s+\w+/i,
  /\b\w+\s+drop\s+\w+/i,        // NEW: "Manali drop Chandigarh"
  /\bcurrent\s+\w+/i,             // NEW: "current Chandigarh"
  /pickup/i,
  /drop/i,
];

function normalizeText(text) {
  if (!text) return "";

  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hasPhoneNumber(text) {
  if (!text) return false;

  const digitsOnly = text.replace(/[\s\-\(\)\+\.]/g, "");
  const digitCount = (digitsOnly.match(/\d/g) || []).length;

  if (digitCount < 8) return false;

  const phonePatterns = [
    /\d{10}/,
    /\d{5}\s*\d{5}/,
    /\d{5}[-]\d{5}/,
    /\+?\d{2}\s*\d{10}/,
    /\+?\d{2}[-\s]\d{5}[-\s]\d{5}/,
    /\d{3}[-\s]?\d{3}[-\s]?\d{4}/,
    /\(\d{3}\)\s*\d{3}[-\s]?\d{4}/,
    /\d{2,4}[-\s]\d{6,8}/,
    /\d{4}[-\s]\d{6}/,
    /\d{2}[-\s]\d{8}/,
    /\d{3}[-]\d{3}[-]\d{4}/,
    /\b\d{10,12}\b/,
  ];

  return phonePatterns.some((pattern) => pattern.test(text));
}

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";
  return phoneNumber.replace(/\D/g, "");
}

export function containsBlockedNumber(text, blockedNumbers) {
  if (!text || !blockedNumbers || blockedNumbers.length === 0) return false;

  const normalizedText = text.replace(/\D/g, "");

  for (const blockedNumber of blockedNumbers) {
    const normalizedBlocked = normalizePhoneNumber(blockedNumber);

    if (!normalizedBlocked) continue;

    if (normalizedText.includes(normalizedBlocked)) {
      return true;
    }

    const withCountryCode = "91" + normalizedBlocked;
    if (normalizedText.includes(withCountryCode)) {
      return true;
    }
  }

  return false;
}

// Import city aliases from separate file
import { CITY_ALIASES } from "./cityAliases.js";

function getCityAliasMap() {
  return CITY_ALIASES;
}

/**
 * ============================================================================
 * CORE FIX: Extract BOTH pickup AND drop cities
 * ============================================================================
 * Returns: { pickup: string|null, drop: string|null, allCities: string[] }
 *
 * Pattern priority (NEW):
 *   1. "from X to Y"           → pickup: X, drop: Y
 *   2. "Y drop current X"      → pickup: X, drop: Y
 *   3. "Y drop X"              → pickup: X, drop: Y
 *   4. "X to Y"                → pickup: X, drop: Y
 *   5. "pickup: X, drop: Y"    → pickup: X, drop: Y
 *   6. "current X"             → pickup: X
 *   7. Word scan               → pickup: first city, drop: second city (if found)
 * ============================================================================
 */
export function extractCities(text, cities) {
  if (!text || !cities || !Array.isArray(cities) || cities.length === 0) {
    return { pickup: null, drop: null, allCities: [] };
  }

  const normalized = normalizeText(text);
  const aliasMap = getCityAliasMap();

  function isConfiguredCity(word, cities) {
    const wordLower = word.toLowerCase().trim();

    for (const city of cities) {
      if (city.toLowerCase() === wordLower) {
        return city;
      }
    }

    if (aliasMap[wordLower]) {
      const mappedCity = aliasMap[wordLower];
      if (cities.includes(mappedCity)) {
        return mappedCity;
      }
    }

    return null;
  }

  function scanWords(words, cities) {
    const found = [];
    for (let i = 0; i < words.length; i++) {
      let city = isConfiguredCity(words[i], cities);
      if (city && !found.includes(city)) {
        found.push(city);
        continue;
      }

      if (i < words.length - 1) {
        const twoWords = words[i] + " " + words[i + 1];
        city = isConfiguredCity(twoWords, cities);
        if (city && !found.includes(city)) {
          found.push(city);
          continue;
        }
      }

      if (i < words.length - 2) {
        const threeWords = words[i] + " " + words[i + 1] + " " + words[i + 2];
        city = isConfiguredCity(threeWords, cities);
        if (city && !found.includes(city)) {
          found.push(city);
        }
      }
    }
    return found;
  }

  // Pattern 1: "from X to Y" → pickup: X, drop: Y
  const fromToPattern = /\bfrom\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const fromToMatch = normalized.match(fromToPattern);
  
  if (fromToMatch) {
    const sourceWords = fromToMatch[1].trim().split(/\s+/);
    const destWords = fromToMatch[2].trim().split(/\s+/);
    
    const pickupCities = scanWords(sourceWords, cities);
    const dropCities = scanWords(destWords, cities);
    
    if (pickupCities.length > 0 || dropCities.length > 0) {
      return {
        pickup: pickupCities[0] || null,
        drop: dropCities[0] || null,
        allCities: [...pickupCities, ...dropCities.filter(c => !pickupCities.includes(c))],
      };
    }
  }

  // Pattern 2: "Y drop current X" → pickup: X, drop: Y (NEW)
  const dropCurrentPattern = /\b([a-z\s]+?)\s+drop\s+current\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const dropCurrentMatch = normalized.match(dropCurrentPattern);
  
  if (dropCurrentMatch) {
    const destWords = dropCurrentMatch[1].trim().split(/\s+/);
    const sourceWords = dropCurrentMatch[2].trim().split(/\s+/);
    
    const dropCities = scanWords(destWords, cities);
    const pickupCities = scanWords(sourceWords, cities);
    
    if (pickupCities.length > 0 || dropCities.length > 0) {
      return {
        pickup: pickupCities[0] || null,
        drop: dropCities[0] || null,
        allCities: [...pickupCities, ...dropCities.filter(c => !pickupCities.includes(c))],
      };
    }
  }

  // Pattern 3: "Y drop X" → pickup: X, drop: Y (NEW)
  const dropPattern = /\b([a-z\s]+?)\s+drop\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const dropMatch = normalized.match(dropPattern);
  
  if (dropMatch) {
    const destWords = dropMatch[1].trim().split(/\s+/);
    const sourceWords = dropMatch[2].trim().split(/\s+/);
    
    const dropCities = scanWords(destWords, cities);
    const pickupCities = scanWords(sourceWords, cities);
    
    if (pickupCities.length > 0 || dropCities.length > 0) {
      return {
        pickup: pickupCities[0] || null,
        drop: dropCities[0] || null,
        allCities: [...pickupCities, ...dropCities.filter(c => !pickupCities.includes(c))],
      };
    }
  }

  // Pattern 4: "X to Y" → pickup: X, drop: Y
  const toPattern = /\b([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const toMatch = normalized.match(toPattern);
  
  if (toMatch) {
    const sourceWords = toMatch[1].trim().split(/\s+/);
    const destWords = toMatch[2].trim().split(/\s+/);
    
    const pickupCities = scanWords(sourceWords, cities);
    const dropCities = scanWords(destWords, cities);
    
    if (pickupCities.length > 0 || dropCities.length > 0) {
      return {
        pickup: pickupCities[0] || null,
        drop: dropCities[0] || null,
        allCities: [...pickupCities, ...dropCities.filter(c => !pickupCities.includes(c))],
      };
    }
  }

  // Pattern 5: "pickup: X" and/or "drop: Y"
  const pickupPattern = /\bpickup\s*:?\s*([a-z\s]+?)(?:\s*drop|\s*to|\s*-|\s*phone|\s*\d|$)/i;
  const dropExplicitPattern = /\bdrop\s*:?\s*([a-z\s]+?)(?:\s*pickup|\s*from|\s*-|\s*phone|\s*\d|$)/i;
  
  const pickupMatch = normalized.match(pickupPattern);
  const dropExplicitMatch = normalized.match(dropExplicitPattern);
  
  if (pickupMatch || dropExplicitMatch) {
    const pickupWords = pickupMatch ? pickupMatch[1].trim().split(/\s+/).slice(0, 3) : [];
    const dropWords = dropExplicitMatch ? dropExplicitMatch[1].trim().split(/\s+/).slice(0, 3) : [];
    
    const pickupCities = scanWords(pickupWords, cities);
    const dropCities = scanWords(dropWords, cities);
    
    if (pickupCities.length > 0 || dropCities.length > 0) {
      return {
        pickup: pickupCities[0] || null,
        drop: dropCities[0] || null,
        allCities: [...pickupCities, ...dropCities.filter(c => !pickupCities.includes(c))],
      };
    }
  }

  // Pattern 6: "current X" → pickup: X (NEW)
  const currentPattern = /\bcurrent\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const currentMatch = normalized.match(currentPattern);
  
  if (currentMatch) {
    const currentWords = currentMatch[1].trim().split(/\s+/).slice(0, 3);
    const pickupCities = scanWords(currentWords, cities);
    
    if (pickupCities.length > 0) {
      // Still scan the rest for drop city
      const allWords = normalized.split(/\s+/);
      const allFoundCities = scanWords(allWords, cities);
      const dropCity = allFoundCities.find(c => c !== pickupCities[0]) || null;
      
      return {
        pickup: pickupCities[0],
        drop: dropCity,
        allCities: allFoundCities,
      };
    }
  }

  // Pattern 7: Word scan fallback → first city = pickup, second city = drop
  const words = normalized.split(/\s+/);
  const allFoundCities = scanWords(words, cities);
  
  if (allFoundCities.length > 0) {
    return {
      pickup: allFoundCities[0] || null,
      drop: allFoundCities[1] || null,
      allCities: allFoundCities,
    };
  }

  return { pickup: null, drop: null, allCities: [] };
}

/**
 * Backward compatibility: extractPickupCity still works
 */
export function extractPickupCity(text, cities) {
  const result = extractCities(text, cities);
  return result.pickup;
}

/**
 * Alias for extractPickupCity (backward compatibility)
 */
export function extractFirstCity(text, cities) {
  return extractPickupCity(text, cities);
}

/**
 * Checks if message is a valid taxi request.
 */
export function isTaxiRequest(text, keywords, ignoreList, blockedNumbers = []) {
  if (!text) return false;

  const normalized = normalizeText(text);
  const originalLower = text.toLowerCase();

  if (blockedNumbers && blockedNumbers.length > 0) {
    if (containsBlockedNumber(text, blockedNumbers)) {
      return false;
    }
  }

  for (const ignoreWord of ignoreList) {
    if (originalLower.includes(ignoreWord.toLowerCase())) {
      return false;
    }
  }

  const hasKeyword = keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );

  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

/**
 * 🔒 Anti-ban hardening (ported from Bot-1)
 * Generates a text-based fingerprint for deduplication.
 * Same message within the same 5-minute window produces identical fingerprint.
 */
export function getMessageFingerprint(
  text,
  messageId = null,
  timestamp = null
) {
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\d{10,}/g, "PHONE")
    .trim()
    .substring(0, 300);

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  const textHash = Math.abs(hash).toString(36);

  const now = timestamp || Date.now();
  const timeWindow = Math.floor(now / 300000);

  return `fp-${textHash}-${timeWindow}`;
}