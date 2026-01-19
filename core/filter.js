import { matchCity } from "./cityAliases.js";

// ============================================================================
// ROUTE DETECTION PATTERNS
// ============================================================================

const ROUTE_PATTERNS = [
  /\bfrom\s+[a-z0-9\s]{2,50}\s+to\s+[a-z0-9\s]{2,50}/i,
  /\bpickup\s+[a-z0-9\s]{2,50}\s+to\s+[a-z0-9\s]{2,50}/i,
  /\b[a-z0-9\s]{2,50}\s+(?:to|tu|too|ton)\s+[a-z0-9\s]{2,50}/i,
  /\b[a-z0-9\s]{2,30}\s*[-–]\s*[a-z0-9\s]{2,30}/i,
  /\bpickup\b/i,
  /\bdrop\b/i,
];

// ============================================================================
// NOISE WORDS - Remove from city extraction
// ============================================================================

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
// TEXT NORMALIZATION - ENHANCED
// ============================================================================

function normalizeText(text) {
  if (!text) return "";

  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[ᗩ-ᗷᗪ-ᗴᗷ]/gu, "e") // ✅ NEW: Convert fancy unicode to 'e'
    .replace(/[༒꧁꧂ɞʚ]/gu, "") // ✅ NEW: Remove decorative symbols
    .replace(/[_\-:=*]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\.(?=[a-z])/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\b(\w+)(\s+\1)+\b/gi, "$1")
    .replace(/[()]/g, " ")
    .trim()
    .toLowerCase();
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
// CITY EXTRACTION - CORE LOGIC
// ============================================================================

function extractCitiesFromSegment(segment, citiesArray) {
  console.log(`  📍 Segment: "${segment}"`);

  if (!segment) return [];

  let cleaned = segment
    .replace(/[_\-:=*]/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\.(?=[a-z])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  NOISE_WORDS.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    cleaned = cleaned.replace(regex, " ");
  });

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  console.log(`  🧹 Cleaned: "${cleaned}"`);

  const words = cleaned.split(/\s+/);
  const cities = [];

  let i = 0;
  while (i < words.length) {
    let matched = false;

    // ✅ NEW: Try 6-word combination (for "chandigarh 43 bus stand isbt 17")
    if (i <= words.length - 6) {
      const six = words.slice(i, i + 6).join(" ");
      const city = matchCity(six, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 6-word: "${six}" → ${city}`);
        cities.push(city);
        i += 6;
        matched = true;
        continue;
      }
    }

    if (!matched && i <= words.length - 5) {
      const five = words.slice(i, i + 5).join(" ");
      const city = matchCity(five, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 5-word: "${five}" → ${city}`);
        cities.push(city);
        i += 5;
        matched = true;
        continue;
      }
    }

    if (!matched && i <= words.length - 4) {
      const four = words.slice(i, i + 4).join(" ");
      const city = matchCity(four, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 4-word: "${four}" → ${city}`);
        cities.push(city);
        i += 4;
        matched = true;
        continue;
      }
    }

    if (!matched && i <= words.length - 3) {
      const three = words.slice(i, i + 3).join(" ");
      const city = matchCity(three, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 3-word: "${three}" → ${city}`);
        cities.push(city);
        i += 3;
        matched = true;
        continue;
      }
    }

    if (!matched && i <= words.length - 2) {
      const two = words.slice(i, i + 2).join(" ");
      const city = matchCity(two, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 2-word: "${two}" → ${city}`);
        cities.push(city);
        i += 2;
        matched = true;
        continue;
      }
    }

    if (!matched) {
      const one = words[i];
      const city = matchCity(one, citiesArray);
      if (city && !cities.includes(city)) {
        console.log(`    ✅ 1-word: "${one}" → ${city}`);
        cities.push(city);
      }
      i++;
    }
  }

  console.log(`  ✅ Extracted: ${cities.join(", ") || "None"}`);
  return cities;
}

// ============================================================================
// MAIN CITY EXTRACTION FUNCTION
// ============================================================================

export function extractCitiesForPipelines(text, pipelines) {
  if (!text || !pipelines || !Array.isArray(pipelines)) {
    return [];
  }

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

  const normalized = normalizeText(text);
  const foundCities = [];
  const CITY_CHARS = "[a-z0-9\u0900-\u097F\\s]";

  console.log(`🔍 DEBUG - Text: "${normalized}"`);
  console.log(`🔍 DEBUG - Target cities: [${citiesArray.join(", ")}]`);

  const TO_WORD = "(?:to|tu|too|ton)"; // ✅ FIXED: Removed 'se'

  // ============================================================================
  // PATTERN 1: "from X to Y"
  // ============================================================================
  const fromToPattern = new RegExp(
    `\\bfrom\\s+([a-z\\s]{2,})\\s+${TO_WORD}\\b\\s+([a-z\\s]+?)(?:\\s+(?:drop|time|current|need|taxi|car|rate|price|contact|call)|\\d{4,}|$)`,
    "i",
  );
  const fromToMatch = normalized.match(fromToPattern);

  if (fromToMatch) {
    console.log(`🎯 Pattern: "from X to Y"`);
    const source = fromToMatch[1].trim();
    const dest = fromToMatch[2].trim();

    extractCitiesFromSegment(source, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
    extractCitiesFromSegment(dest, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    if (foundCities.length > 0) {
      console.log(`✅ FINAL: ${foundCities.join(", ")}`);
      return foundCities;
    }
  }

  // ============================================================================
  // PATTERN 2: "X to Y" (without "from") ✅ ENHANCED
  // ============================================================================
  const toPattern = new RegExp(
    `\\b(${CITY_CHARS}{3,})\\s+${TO_WORD}\\b\\s+(${CITY_CHARS}+?)(?:\\s+(?:drop|time|crunt|current|need|taxi|car|rate|price|contact|call|today|tomorrow)|\\d{5,}|$)`,
    "i",
  );
  const toMatch = normalized.match(toPattern);

  if (toMatch && !/\bfrom\b/i.test(normalized)) {
    console.log(`🎯 Pattern: "X to Y"`);
    let source = toMatch[1].trim();
    let dest = toMatch[2].trim();

    // Remove common prefixes
    source = source.replace(/^(pick\s*)+/gi, "").trim();
    source = source.replace(/^(need\s*)+/gi, "").trim();

    // Remove trailing numbers from source (like "43" in "chandigarh 43")
    source = source.replace(/\s+\d+\s*$/g, "").trim();

    console.log(`  📍 Source: "${source}"`);
    console.log(`  📍 Dest: "${dest}"`);

    extractCitiesFromSegment(source, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
    extractCitiesFromSegment(dest, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    if (foundCities.length > 0) {
      console.log(`✅ FINAL: ${foundCities.join(", ")}`);
      return foundCities;
    }

    if (foundCities.length === 0 && source) {
      extractCitiesFromSegment(source, citiesArray).forEach((c) => {
        if (!foundCities.includes(c)) foundCities.push(c);
      });
    }
  }

  // ============================================================================
  // PATTERN 3: "pickup: X" OR "pick up: X"
  // ============================================================================
  const pickupPattern =
    /(?:pickup|pick\s*up|🏘️\s*pickup)\s*[:\-_=]*\s*([^\n\r]+?)(?=\s+(?:to|se|drop|🛣️|time|⏳)|\d{10}|$)/i;
  const pickupMatch = normalized.match(pickupPattern);

  if (pickupMatch) {
    console.log(`🎯 Pattern: "pickup: X"`);
    const pickup = pickupMatch[1].trim();

    extractCitiesFromSegment(pickup, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  // ============================================================================
  // PATTERN 4: "drop: Y"
  // ============================================================================
  const dropPattern =
    /(?:drop|🛣️\s*drop)\s*[:\-_=]*\s*([^\n\r]+?)(?:\s*(?:taxi|🚕|time|⏳|trip|🛄|rate|current|please|contact|call|mob)|\d{10}|$)/i;

  const dropMatch =
    !/\b(?:[a-z\u0900-\u097F]{2,}\s+(to|se)\s+[a-z\u0900-\u097F]{2,})\b/i.test(
      normalized,
    )
      ? normalized.match(dropPattern)
      : null;
  if (!dropMatch && /\bdrop\b/i.test(normalized)) {
    console.log("ℹ️ drop skipped due to route keyword");
  }

  if (dropMatch) {
    console.log(`🎯 Pattern: "drop: Y"`);
    const drop = dropMatch[1].trim();

    extractCitiesFromSegment(drop, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  // ============================================================================
  // PATTERN 5: "place: X"
  // ============================================================================
  const placePattern =
    /(?:place|location)\s*[:\-_=\.]*\s*([^\n\r]+?)(?:\s*(?:mobile|contact|call|rent|price|rate|phone)|\d{10}|$)/i;
  const placeMatch = normalized.match(placePattern);

  if (placeMatch) {
    console.log(`🎯 Pattern: "place: X"`);
    const place = placeMatch[1].trim();

    extractCitiesFromSegment(place, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  // ============================================================================
  // HINDI ROUTE: "X se Y"
  // ============================================================================
  const sePattern = new RegExp(
    `\\b(${CITY_CHARS}{3,})\\s+se\\s+(${CITY_CHARS}+?)(?:\\s+(?:time|rate|taxi|car|price|contact|call)|\\d{4,}|$)`,
    "i",
  );

  const seMatch = normalized.match(sePattern);

  if (seMatch && !/\bto\b/i.test(normalized)) {
    console.log(`🎯 Pattern: "X se Y" (Hindi)`);

    const source = seMatch[1].trim();
    const dest = seMatch[2].trim();

    extractCitiesFromSegment(source, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    extractCitiesFromSegment(dest, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    if (foundCities.length > 0) {
      return foundCities;
    }
  }

  // ============================================================================
  // FALLBACK: Only if NO route intent words exist
  // ============================================================================
  const ROUTE_INTENT = /\b(from|to|pickup|drop|se|–|-)\b/i;

  if (foundCities.length === 0 && !ROUTE_INTENT.test(normalized)) {
    extractCitiesFromSegment(normalized, citiesArray).forEach((c) => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  console.log(`✅ FINAL: ${foundCities.join(", ") || "None"}`);
  return foundCities;
}

// ============================================================================
// PIPELINE MATCHING
// ============================================================================

export function matchesPipeline(extractedCities, cityScope) {
  if (!Array.isArray(cityScope) || cityScope.length === 0) {
    return false;
  }

  if (cityScope.includes("*")) {
    return true;
  }

  if (!extractedCities || extractedCities.length === 0) {
    return false;
  }

  // ✅ PARTIAL MATCH ALLOWED
  return extractedCities.some((city) =>
    cityScope.some(
      (scopeCity) => scopeCity.toLowerCase() === city.toLowerCase(),
    ),
  );
}

// ============================================================================
// TAXI REQUEST DETECTION
// ============================================================================

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

  const hasKeyword = keywords.some((keyword) => {
    const keywordLower = keyword.toLowerCase();
    return normalized.includes(keywordLower);
  });

  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

// ============================================================================
// MESSAGE FINGERPRINTING
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
