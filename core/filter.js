const ROUTE_PATTERNS = [
  /\bfrom\b.+\bto\b/i,
  /\bto\b.+\bfrom\b/i,
  /\b\w+\s+to\s+\w+/i,
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

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function getCityAliasMap() {
  return {
    // Delhi + Airports + NCR
    "dli": "Delhi", 
    "dehli": "Delhi", 
    "dilli": "Delhi",
    "new delhi": "Delhi",
    "dilhe": "Delhi",
    "dilhi": "Delhi",
    "delhi": "Delhi",
    "sadar bazar": "Delhi",
    "sadar": "Delhi",
    "t3": "Delhi", 
    "t2": "Delhi", 
    "t1": "Delhi",
    "terminal 3": "Delhi", 
    "terminal 2": "Delhi", 
    "terminal 1": "Delhi",
    "terminal3": "Delhi",
    "terminal2": "Delhi",
    "terminal1": "Delhi",
    "igi": "Delhi", 
    "igi airport": "Delhi", 
    "delhi airport": "Delhi",
    "isbt delhi": "Delhi",
    "kashmere gate": "Delhi", 
    "kashmeri gate": "Delhi", 
    "kashmiri gate": "Delhi",
    "dwarka": "Delhi", 
    "connaught place": "Delhi",
    "aerocity": "Delhi",
    "ajmeri gate": "Delhi",
    "ajmeri gate railway station": "Delhi",


    // Gurgaon
    "ggn": "Gurgaon", 
    "gurgoan": "Gurgaon", 
    "gurugram": "Gurgaon",
    "gurgaon": "Gurgaon",
    "grg": "Gurgaon", 
    "cyber city": "Gurgaon", 
    "golf course road": "Gurgaon",
    "sohna": "Gurgaon", 
    "manesar": "Gurgaon",

    // Noida
    "noida": "Noida",
    "noida sector": "Noida", 
    "nioda": "Noida", 
    "greater noida": "Noida",

    // Faridabad
    "faridabad": "Faridabad",
    "fbd": "Faridabad",
    "faridabaad": "Faridabad",
    
    // Ghaziabad
    "ghaziabad": "Ghaziabad",
    "ghz": "Ghaziabad",

    // Ambala
    "amb": "Ambala", 
    "ambl": "Ambala", 
    "ambala": "Ambala",
    "ambala cantt": "Ambala",
    "ambala city": "Ambala", 
    "ambala cantonment": "Ambala",
    "ambala railway station": "Ambala",

    // Patiala
    "ptl": "Patiala", 
    "pti": "Patiala", 
    "patiala": "Patiala",
    "patiyala": "Patiala",
    "sirhind": "Patiala",
    "rajpura": "Patiala",
    "nabha": "Patiala",
    "samana": "Patiala",
    "malerkotla": "Patiala",
    "kotakpura": "Patiala",
    "bathinda": "Patiala",

    // Chandigarh + Tricity
    "chd": "Chandigarh", 
    "chandi": "Chandigarh",
    "chandigarh": "Chandigarh",
    "chandhigarh": "Chandigarh",
    "chandigarh sector": "Chandigarh",
    "sector": "Chandigarh",
    "sec 17": "Chandigarh", 
    "sec 35": "Chandigarh",
    "isbt 17": "Chandigarh", 
    "isbt 43": "Chandigarh",
    "panchkula": "Chandigarh",
    "pkl": "Chandigarh",
    "pgi": "Chandigarh",
    "pgimer": "Chandigarh",
    "isbt chandigarh": "Chandigarh",
    "chandigarh airport": "Chandigarh",

    // Zirakpur
    "zkp": "Zirakpur", 
    "zirkpur": "Zirakpur", 
    "zirakpur": "Zirakpur",
    "jerkpur": "Zirakpur", 
    "zirkapur": "Zirakpur",
    "dera basi": "Zirakpur",
    "dera bassi": "Zirakpur",
    "derabassi": "Zirakpur",
    "dhakoli": "Zirakpur",

    // Mohali
    "mhl": "Mohali", 
    "mohali": "Mohali",
    "mohali sector": "Mohali",
    "sahibzada ajit singh nagar": "Mohali", 
    "sas nagar": "Mohali",
    "kharar": "Mohali",
    "kahrar": "Mohali",
    "kharad": "Mohali",
    "kurali": "Mohali", 
    "mohali phase": "Mohali",
    "phase 11": "Mohali", 
    "phase 10": "Mohali",
    "mohali airport": "Mohali",
    "landran": "Mohali",
    "morinda": "Mohali",

    // Amritsar
    "asr": "Amritsar", 
    "amritsar": "Amritsar",
    "amritser": "Amritsar", 
    "amritsarr": "Amritsar",
    "golden temple": "Amritsar", 
    "wagah border": "Amritsar",
    "amritsar airport": "Amritsar",
    "beas": "Amritsar",
    "abohar": "Amritsar",

    // Ludhiana
    "ldh": "Ludhiana", 
    "ludhiana": "Ludhiana",
    "ludhiyana": "Ludhiana",
    "ludhianaa": "Ludhiana",
    "khanna": "Ludhiana",

    // Jalandhar
    "jld": "Jalandhar", 
    "jalandhar": "Jalandhar",
    "jalandar": "Jalandhar",
    "jullundur": "Jalandhar", 
    "phagwara": "Jalandhar",
  };
}

/**
 * ✅ ULTIMATE: Extract cities for multi-pipeline routing
 * Based on proven pattern from previous bot
 */
/**
 * ✅ ULTIMATE FIXED: Extract cities for multi-pipeline routing
 */
export function extractCitiesForPipelines(text, pipelines) {
  if (!text || !pipelines || !Array.isArray(pipelines)) {
    return [];
  }

  const allCities = new Set();
  pipelines.forEach(pipeline => {
    if (Array.isArray(pipeline.cityScope)) {
      pipeline.cityScope.forEach(city => {
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
  const aliasMap = getCityAliasMap();
  const foundCities = [];

  console.log(`🔍 DEBUG - Normalized: "${normalized}"`);
  console.log(`🔍 DEBUG - Looking for: [${citiesArray.join(', ')}]`);

  /**
   * Check if word/phrase is a configured city
   */
  function isConfiguredCity(word, citiesArray) {
    const wordLower = word.toLowerCase().trim();

    // Direct match
    for (const city of citiesArray) {
      if (city.toLowerCase() === wordLower) {
        console.log(`    ✅ Matched: "${word}" → ${city}`);
        return city;
      }
    }

    // Alias match
    if (aliasMap[wordLower]) {
      const mappedCity = aliasMap[wordLower];
      if (citiesArray.includes(mappedCity)) {
        console.log(`    ✅ Alias: "${word}" → ${mappedCity}`);
        return mappedCity;
      }
    }

    return null;
  }

  /**
   * Extract cities from segment - tries 1, 2, 3 word combos
   */
  function extractCitiesFromSegment(segment, citiesArray) {
  console.log(`  📍 Checking: "${segment}"`);

  if (!segment) return [];

  const words = segment.trim().split(/\s+/);
  const cities = [];

  let i = 0;
  while (i < words.length) {
    let matched = false;

    // ---------- TRY 3-WORD PHRASE ----------
    if (i <= words.length - 3) {
      const three = words.slice(i, i + 3).join(" ");
      const city = isConfiguredCity(three, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 3;
        matched = true;
      }
    }

    // ---------- TRY 2-WORD PHRASE ----------
    if (!matched && i <= words.length - 2) {
      const two = words.slice(i, i + 2).join(" ");
      const city = isConfiguredCity(two, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
        i += 2;
        matched = true;
      }
    }

    // ---------- TRY 1-WORD ----------
    if (!matched) {
      const one = words[i];
      const city = isConfiguredCity(one, citiesArray);
      if (city && !cities.includes(city)) {
        cities.push(city);
      }
      i++; // advance ONLY here
    }
  }

  console.log(`  ✅ Found: ${cities.join(", ") || "None"}`);
  return cities;
}

  const TO_WORD = '(?:to|tu|too|ton)';

  // ============================================================================
  // PATTERN 1: "from X to Y"
  // ============================================================================
  const fromToPattern =
  new RegExp(`\\bfrom\\s+([a-z\\s]+?)\\s+${TO_WORD}[.\\s]+([a-z\\s]+?)(?:\\s|$|[^a-z])`, 'i');
  const fromToMatch = normalized.match(fromToPattern);

  if (fromToMatch) {
    console.log(`🎯 Pattern: "from X to Y"`);
    const source = fromToMatch[1].trim();
    const dest = fromToMatch[2].trim();

    extractCitiesFromSegment(source, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
    extractCitiesFromSegment(dest, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    if (foundCities.length > 0) {
      console.log(`✅ Final: ${foundCities.join(', ')}`);
      return foundCities;
    }
  }

  // ============================================================================
  // PATTERN 2: "X to Y"
  // ============================================================================
  const toPattern =
  new RegExp(`\\b([a-z\\s]+?)\\s+${TO_WORD}[.\\s]+([a-z\\s]+?)(?:\\s|$|[^a-z])`, 'i');
  const toMatch = normalized.match(toPattern);

  if (toMatch && !normalized.includes('from')) {
    console.log(`🎯 Pattern: "X to Y"`);
    const source = toMatch[1].trim();
    const dest = toMatch[2].trim();

    extractCitiesFromSegment(source, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
    extractCitiesFromSegment(dest, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });

    if (foundCities.length > 0) {
      console.log(`✅ Final: ${foundCities.join(', ')}`);
      return foundCities;
    }
  }

  // ============================================================================
  // PATTERN 3: "pickup: X" OR "pick up: X"
  // ============================================================================
  const pickupPattern = /\b(?:pickup|pick\s+up)\s*:?\s*([a-z\s]+?)(?:\s+drop\s*:?|\s+time\s*:?|\s+please|\s+contact|\s+\d|$)/i;
  const pickupMatch = normalized.match(pickupPattern);

  if (pickupMatch) {
    console.log(`🎯 Pattern: "pickup: X"`);
    const pickup = pickupMatch[1].trim();
    extractCitiesFromSegment(pickup, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  // ============================================================================
  // PATTERN 4: "drop: Y"
  // ============================================================================
  const dropPattern = /\bdrop\s*:?\s*([a-z\s]+?)(?:\s+time\s*:?|\s+please|\s+contact|\s+\d|$)/i;
  const dropMatch = normalized.match(dropPattern);

  if (dropMatch) {
    console.log(`🎯 Pattern: "drop: Y"`);
    const drop = dropMatch[1].trim();
    extractCitiesFromSegment(drop, citiesArray).forEach(c => {
      if (!foundCities.includes(c)) foundCities.push(c);
    });
  }

  // ============================================================================
// PATTERN 2B: "X se Y" (Hindi) ✅ NEW
// ============================================================================
const sePattern = /\b([a-z\s]+?)\s+se\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
const seMatch = normalized.match(sePattern);

if (seMatch && !normalized.includes('from') && !normalized.includes(' to ')) {
  console.log(`🎯 Pattern: "X se Y" (Hindi)`);
  const source = seMatch[1].trim();
  const dest = seMatch[2].trim();

  extractCitiesFromSegment(source, citiesArray).forEach(c => {
    if (!foundCities.includes(c)) foundCities.push(c);
  });
  extractCitiesFromSegment(dest, citiesArray).forEach(c => {
    if (!foundCities.includes(c)) foundCities.push(c);
  });

  if (foundCities.length > 0) {
    console.log(`✅ Final: ${foundCities.join(', ')}`);
    return foundCities;
  }
}

  console.log(`✅ Final: ${foundCities.join(', ') || 'None'}`);
  return foundCities;
}

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

  return extractedCities.some(city => 
    cityScope.some(scopeCity => 
      scopeCity.toLowerCase() === city.toLowerCase()
    )
  );
}

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

export function getMessageFingerprint(text, messageId = null, timestamp = null) {
  if (!text) return "";

  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\d{10,}/g, 'PHONE')
    .trim()
    .substring(0, 300);

  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const textHash = Math.abs(hash).toString(36);
  const now = timestamp || Date.now();
  const timeWindow = Math.floor(now / 300000);

  return `fp-${textHash}-${timeWindow}`;
}