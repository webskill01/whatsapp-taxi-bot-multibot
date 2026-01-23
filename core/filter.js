import { matchCity } from "./cityAliases.js";

// ============================================================================
// ROUTE DETECTION PATTERNS - OPTIONAL HELPERS ONLY
// ============================================================================
// These patterns are used ONLY for isTaxiRequest() validation
// They do NOT gate city extraction anymore
const ROUTE_PATTERNS = [
  /\bfrom\s+[a-z0-9\u0900-\u097F\s]{2,50}\s+to\s+[a-z0-9\u0900-\u097F\s]{2,50}/i,
  /\bpickup\s+[a-z0-9\u0900-\u097F\s]{2,50}\s+to\s+[a-z0-9\u0900-\u097F\s]{2,50}/i,
  /\b[a-z0-9\u0900-\u097F\s]{2,50}\s+(?:to|tu|too|ton|se)\s+[a-z0-9\u0900-\u097F\s]{2,50}/i,
  /\bpickup\b/i,
  /\bdrop\b/i,
];


// ============================================================================
// NOISE WORDS - Words to strip during segment cleaning
// ============================================================================
// WHY: Remove filler words but preserve location-specific terms
// CRITICAL: Do NOT add "bus", "stand", "station", "airport" here
const NOISE_WORDS = [
  "need",
  "required",
  "sedan",
  "ertiga",
  "innova",
  "dzire",
  "aura",
  "car",
  "taxi",
  "current",
  "today",
  "tomorrow",
  "crunt",
  "w/c",
  "wc",
  "with",
  "carrier",
  "rate",
  "price",
  "time",
  "morning",
  "evening",
  "night",
  "please",
  "call",
  "contact",
  "available",
  "crysta",
  "tempo",
  "traveller",
  "ac",
  "non",
  "good",
  "neat",
  "clean",
  "one",
  "way",
  "round",
  "trip",
  "am",
  "pm",
  "travels",
  "tour",
  "tours",
  "service",
  "services",
  "agency",
  "transport",
  "logistics",
  "fleet",
  "company",
];

// ============================================================================
// TEXT NORMALIZATION - ENHANCED WITH HINDI SUPPORT
// ============================================================================
// WHY: Convert messy WhatsApp text to searchable format
// CRITICAL: Must preserve city names while removing decorative characters
// ✅ UPDATED: Now preserves Hindi/Devanagari characters
function normalizeText(text) {
  if (!text) return "";

  return (
    text
      .replace(/[\r\n]+/g, " ") // Newlines → space
      .replace(/[\u{1F600}-\u{1F64F}]/gu, "") // Emojis
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
      .replace(/[\u{2600}-\u{26FF}]/gu, "")
      .replace(/[\u{2700}-\u{27BF}]/gu, "")
      .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
      .replace(/[ᗩ-ᗷᗪ-ᗴᗷ]/gu, "e") // Fancy unicode → 'e'
      .replace(/[༒꧁꧂ɞʚ]/gu, "") // Decorative symbols
      .replace(/[_:=*]/g, " ") // Separators → space (preserve hyphens for location names)
      .replace(/\.(?=\s|$)/g, " ") // Dot at end → space
      .replace(/\.(?=[a-z\u0900-\u097F])/gi, " ") // ✅ UPDATED: Dot before letter/Hindi → space
      .replace(/[ \t]+/g, " ") // Multiple spaces → single
      .replace(/\b(\w+)(\s+\1)+\b/gi, "$1") // Remove duplicate words
      .replace(/[()]/g, " ") // Remove parentheses
      .trim()
      .toLowerCase()
  );
}

// ============================================================================
// PHONE NUMBER DETECTION
// ============================================================================
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

// ============================================================================
// BLOCKED NUMBER CHECK
// ============================================================================
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

    if (
      normalizedText.includes(normalizedBlocked) ||
      normalizedText.includes("91" + normalizedBlocked)
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// CITY EXTRACTION FROM SEGMENT - ALIAS-FIRST APPROACH
// ============================================================================
// WHY: Check all possible multi-word combinations before failing
// CRITICAL: Must try 6→5→4→3→2→1 word combinations to catch "chandigarh 43 bus stand"
function extractCitiesFromSegment(segment, citiesArray) {
  if (!segment) return [];

  // Clean segment but preserve location markers
  let cleaned = segment
    .replace(/[_:=*]/g, " ") // Separators → space (preserve hyphens)
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\.(?=[a-z\u0900-\u097F])/gi, " ") // ✅ UPDATED: Support Hindi
    .replace(/\s+/g, " ")
    .trim();

  // Remove noise words but NOT location-specific terms
  NOISE_WORDS.forEach((word) => {
    const regex = new RegExp(`\\b${word}s?\\b`, "gi");
    cleaned = cleaned.replace(regex, " ");
  });

  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const cities = [];

  // WHY: Try longest combinations first to match "delhi airport terminal 3" before "delhi"
  let i = 0;
  while (i < words.length) {
    let matched = false;

    // Try 6-word combo (e.g., "chandigarh sector 17 isbt bus stand")
    if (i <= words.length - 6) {
      const six = words.slice(i, i + 6).join(" ");
      const city = matchCity(six, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 6;
        matched = true;
        continue;
      }
    }

    // Try 5-word combo
    if (!matched && i <= words.length - 5) {
      const five = words.slice(i, i + 5).join(" ");
      const city = matchCity(five, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 5;
        matched = true;
        continue;
      }
    }

    // Try 4-word combo
    if (!matched && i <= words.length - 4) {
      const four = words.slice(i, i + 4).join(" ");
      const city = matchCity(four, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 4;
        matched = true;
        continue;
      }
    }

    // Try 3-word combo
    if (!matched && i <= words.length - 3) {
      const three = words.slice(i, i + 3).join(" ");
      const city = matchCity(three, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 3;
        matched = true;
        continue;
      }
    }

    // Try 2-word combo
    if (!matched && i <= words.length - 2) {
      const two = words.slice(i, i + 2).join(" ");
      const city = matchCity(two, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 2;
        matched = true;
        continue;
      }
    }

    // Try 1-word
    if (!matched) {
      const one = words[i];
      const city = matchCity(one, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
      }
      i++;
    }
  }

  return cities;
}

// ============================================================================
// MAIN CITY EXTRACTION - CITY-FIRST, PATTERN-OPTIONAL
// ============================================================================
// ARCHITECTURE:
// Phase 1: Normalize text
// Phase 2: Global city scan (entire message + segmented scan)
// Phase 3: Pattern-based enrichment (optional, additive only)
// Phase 4: Final fallback scan if needed
// Phase 5: Deduplicate and return ALL cities
//
// WHY: Patterns are helpers, not gates. City detection must work even if patterns fail.
// CRITICAL: NO early returns. ALL phases must run. Fallback is mandatory.
export function extractCitiesForPipelines(text, pipelines) {
  if (!text || !pipelines || !Array.isArray(pipelines)) {
    return [];
  }

  // Build master city list from all pipeline configs
  const allCities = new Set();
  pipelines.forEach((pipeline) => {
    if (Array.isArray(pipeline.cityScope)) {
      pipeline.cityScope.forEach((city) => {
        if (city !== "*") {
          allCities.add(city);
        }
      });
    }
  });

  const citiesArray = Array.from(allCities);
  if (citiesArray.length === 0) {
    return [];
  }

  // PHASE 1: Normalize
  const normalized = normalizeText(text);
  const foundCities = [];

  console.log(`🔍 DEBUG - Text: "${normalized}"`);
  console.log(`🔍 DEBUG - Target cities: [${citiesArray.join(", ")}]`);

  // PHASE 2: GLOBAL CITY SCAN (PRIORITY)
  // WHY: Detect cities FIRST before trying any patterns
  // This ensures "24 HOURS TAXI IN PATIALA" still detects Patiala
  console.log(`🌐 PHASE 2: Global city scan`);

  // ✅ NEW: Segmented scan - split by common separators first
  // WHY: Messages like "Delhi | Noida | Gurgaon, Chandigarh / Mohali" need segment-by-segment scanning
  const segments = normalized.split(/[,|\/]+/); // Split by comma, pipe, slash
  console.log(`  📦 Segments: ${segments.length}`);

  segments.forEach((segment, idx) => {
    const segmentCities = extractCitiesFromSegment(segment.trim(), citiesArray);
    segmentCities.forEach((city) => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
        console.log(`  ✅ Segment ${idx + 1}: ${city}`);
      }
    });
  });

  // Also scan entire message (in case no separators exist)
  const globalCities = extractCitiesFromSegment(normalized, citiesArray);
  globalCities.forEach((city) => {
    if (!foundCities.includes(city)) {
      foundCities.push(city);
      console.log(`  ✅ Global scan: ${city}`);
    }
  });

  // PHASE 3: PATTERN-BASED ENRICHMENT (ADDITIVE ONLY)
  // WHY: Patterns help find cities hidden in structured text
  // CRITICAL: Patterns can ADD cities but never BLOCK global scan results
  console.log(`🎯 PHASE 3: Pattern-based enrichment`);

  // Pattern 1: "from X to Y"
  // ✅ UPDATED: Support Hindi/Devanagari characters
  const fromToPattern =
    /\bfrom\s+([a-z0-9\u0900-\u097F\s]{2,50}?)\s+(?:to|tu|too|ton)\b\s+([a-z0-9\u0900-\u097F\s]{2,50}?)(?:\s+(?:drop|time|current|need|taxi|car|rate|price|contact|call)|$)/i;
  const fromToMatch = normalized.match(fromToPattern);
  if (fromToMatch) {
    console.log(`  🎯 Pattern: "from X to Y"`);
    extractCitiesFromSegment(fromToMatch[1], citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) {
        foundCities.push(c);
        console.log(`    ✅ Added: ${c}`);
      }
    });
    extractCitiesFromSegment(fromToMatch[2], citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) {
        foundCities.push(c);
        console.log(`    ✅ Added: ${c}`);
      }
    });
  }

  // Pattern 2: "X to Y" (without "from")
  // ✅ UPDATED: Support Hindi/Devanagari characters
  if (!/\bfrom\b/i.test(normalized)) {
    const toPattern =
      /\b([a-z0-9\u0900-\u097F\s]{2,50}?)\s+(?:to|tu|too|ton)\b\s+([a-z0-9\u0900-\u097F\s]{2,50}?)(?:\s+(?:drop|time|current|need|taxi|car|rate|price|contact|call|today|tomorrow)|$)/i;
    const toMatch = normalized.match(toPattern);
    if (toMatch) {
      console.log(`  🎯 Pattern: "X to Y"`);
      let source = toMatch[1].trim().replace(/^(pick\s*)+/gi, "").trim();
      let dest = toMatch[2].trim();

      extractCitiesFromSegment(source, citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
      extractCitiesFromSegment(dest, citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
    }
  }

  // Pattern 3: "X se Y" (Hindi)
  // ✅ UPDATED: Support Hindi/Devanagari characters
  if (!/\bto\b/i.test(normalized)) {
    const sePattern =
      /([a-z0-9\u0900-\u097F\s]{2,50}?)\s+se\s+([a-z0-9\u0900-\u097F\s]{2,50}?)(?:\s+(?:time|rate|taxi|car|price|contact|call)|$)/i;
    const seMatch = normalized.match(sePattern);
    if (seMatch) {
      console.log(`  🎯 Pattern: "X se Y" (Hindi)`);
      extractCitiesFromSegment(seMatch[1], citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
      extractCitiesFromSegment(seMatch[2], citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
    }
  }

  // Pattern 4: "X - Y" (hyphen/dash route)
  // ✅ NEW: Fixed to only match real city routes, not "24-hours" or "sedan-ertiga"
  // WHY: Previous pattern matched any hyphenated text, causing false positives
  const hyphenPattern =
    /\b([a-z\u0900-\u097F]{3,}[a-z0-9\u0900-\u097F\s]{0,30})\s*[-–]\s*([a-z\u0900-\u097F]{3,}[a-z0-9\u0900-\u097F\s]{0,30})\b/i;
  const hyphenMatch = normalized.match(hyphenPattern);
  if (hyphenMatch) {
    const left = hyphenMatch[1].trim();
    const right = hyphenMatch[2].trim();

    // Only process if both sides look like city names (not numbers or short codes)
    if (!/^\d+$/.test(left) && !/^\d+$/.test(right)) {
      console.log(`  🎯 Pattern: "X - Y" (hyphen route)`);
      extractCitiesFromSegment(left, citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
      extractCitiesFromSegment(right, citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) {
          foundCities.push(c);
          console.log(`    ✅ Added: ${c}`);
        }
      });
    }
  }

  // Pattern 5: "pickup: X"
  const pickupPattern =
    /(?:pickup|pick\s*up)\s*[:\-_=]*\s*([^\n\r]+?)(?=\s+(?:to|se|drop)|\d{10}|$)/i;
  const pickupMatch = normalized.match(pickupPattern);
  if (pickupMatch) {
    console.log(`  🎯 Pattern: "pickup: X"`);
    extractCitiesFromSegment(pickupMatch[1], citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) {
        foundCities.push(c);
        console.log(`    ✅ Added: ${c}`);
      }
    });
  }

  // Pattern 6: "drop: Y"
  const dropPattern =
    /(?:drop)\s*[:\-_=]*\s*([^\n\r]+?)(?:\s*(?:taxi|time|trip|rate|current|please|contact|call|mob)|\d{10}|$)/i;
  const dropMatch = normalized.match(dropPattern);
  if (dropMatch) {
    console.log(`  🎯 Pattern: "drop: Y"`);
    extractCitiesFromSegment(dropMatch[1], citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) {
        foundCities.push(c);
        console.log(`    ✅ Added: ${c}`);
      }
    });
  }

  // Pattern 7: "place: X"
  const placePattern =
    /(?:place|location)\s*[:\-_=\.]*\s*([^\n\r]+?)(?:\s*(?:mobile|contact|call|rent|price|rate|phone)|\d{10}|$)/i;
  const placeMatch = normalized.match(placePattern);
  if (placeMatch) {
    console.log(`  🎯 Pattern: "place: X"`);
    extractCitiesFromSegment(placeMatch[1], citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) {
        foundCities.push(c);
        console.log(`    ✅ Added: ${c}`);
      }
    });
  }

  // PHASE 4: FINAL FALLBACK SCAN
  // ✅ NEW: If no cities found after all patterns, do one more aggressive scan
  // WHY: Catch edge cases where cities are buried in business names or slogans
  // Example: "RAJESH TAXI SERVICE LUDHIANA 24X7 AVAILABLE"
  if (foundCities.length === 0) {
    console.log(`🔄 PHASE 4: Final fallback scan (no cities found yet)`);

    // Split by whitespace and scan each word individually
    const words = normalized.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      // Try progressively longer combinations from each position
      for (let len = 6; len >= 1; len--) {
        if (i + len <= words.length) {
          const combo = words.slice(i, i + len).join(" ");
          const city = matchCity(combo, citiesArray);
          if (city && !foundCities.includes(city)) {
            foundCities.push(city);
            console.log(`  ✅ Fallback: ${city}`);
            break; // Move to next starting position
          }
        }
      }
    }
  }

  // PHASE 5: Final deduplication and return
  console.log(`✅ FINAL: ${foundCities.join(", ") || "None"}`);
  return foundCities;
}

// ============================================================================
// PIPELINE MATCHING - PARTIAL MATCH ALLOWED
// ============================================================================
// WHY: If message has Chandigarh → Jaipur but only Chandigarh is configured,
//      still route to Chandigarh pipeline
// CRITICAL: ANY overlap between extracted cities and pipeline scope = match
export function matchesPipeline(extractedCities, cityScope) {
  if (!Array.isArray(cityScope) || cityScope.length === 0) {
    return false;
  }

  // Wildcard scope matches everything
  if (cityScope.includes("*")) {
    return true;
  }

  if (!extractedCities || extractedCities.length === 0) {
    return false;
  }

  // Match if ANY extracted city is in the pipeline's cityScope
  return extractedCities.some((city) =>
    cityScope.some(
      (scopeCity) => scopeCity.toLowerCase() === city.toLowerCase(),
    ),
  );
}

// ============================================================================
// TAXI REQUEST DETECTION
// ============================================================================
// WHY: Validate that message is taxi-related before processing
// Uses keywords + route patterns as a sanity check
export function isTaxiRequest(
  text,
  keywords,
  ignoreList,
  blockedNumbers = [],
) {
  if (!text) return false;

  const normalized = normalizeText(text);
  const originalLower = text.toLowerCase();

  // Check blocked numbers
  if (blockedNumbers && blockedNumbers.length > 0) {
    if (containsBlockedNumber(text, blockedNumbers)) {
      return false;
    }
  }

  // Check ignore list
  for (const ignoreWord of ignoreList) {
    if (originalLower.includes(ignoreWord.toLowerCase())) {
      return false;
    }
  }

  // Check taxi keywords
  const hasKeyword = keywords.some((keyword) => {
    const keywordLower = keyword.toLowerCase();
    return normalized.includes(keywordLower);
  });

  // Check route patterns
  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  if (!hasKeyword && !hasRoute) {
  return /taxi|cab|travel|travels|service/i.test(normalized);
}
  return hasKeyword || hasRoute;
  
}

// ============================================================================
// MESSAGE FINGERPRINTING - DUPLICATE DETECTION
// ============================================================================
export function getMessageFingerprint(
  text,
  messageId = null,
  timestamp = null,
) {
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .replace(/[ \t]+/g, " ")
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