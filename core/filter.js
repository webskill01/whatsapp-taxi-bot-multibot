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

/**
 * Check if text contains any blocked phone number
 */
export function containsBlockedNumber(text, blockedNumbers) {
  if (!text || !blockedNumbers || blockedNumbers.length === 0) return false;

  const normalizedText = text.replace(/\D/g, "");

  for (const blockedNumber of blockedNumbers) {
    const normalizedBlocked = normalizePhoneNumber(blockedNumber);

    if (!normalizedBlocked) continue;

    // Check exact match
    if (normalizedText.includes(normalizedBlocked)) {
      return true;
    }

    // Check with country code (91 for India)
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
    "t3": "Delhi", 
    "t2": "Delhi", 
    "t1": "Delhi",
    "terminal 3": "Delhi", 
    "terminal 2": "Delhi", 
    "terminal 1": "Delhi",
    "igi": "Delhi", 
    "igi airport": "Delhi", 
    "delhi airport": "Delhi",
    "isbt delhi": "Delhi",
    "kashmere gate": "Delhi", 
    "kashmiri gate": "Delhi",
    "dwarka": "Delhi", 
    "connaught place": "Delhi",
    "aerocity": "Delhi",

    // Gurgaon
    "ggn": "Gurgaon", 
    "gurgoan": "Gurgaon", 
    "gurugram": "Gurgaon",
    "grg": "Gurgaon", 
    "cyber city": "Gurgaon", 
    "golf course road": "Gurgaon",
    "sohna": "Gurgaon", 
    "manesar": "Gurgaon",

    // Noida
    "noida sector": "Noida", 
    "nioda": "Noida", 
    "greater noida": "Noida",
    "faridabad": "Noida", 
    "ghaziabad": "Noida",

    // Ambala
    "amb": "Ambala", 
    "ambl": "Ambala", 
    "ambala cantt": "Ambala",
    "ambala city": "Ambala", 
    "ambala cantonment": "Ambala",
    "ambala railway station": "Ambala",

    // Patiala
    "ptl": "Patiala", 
    "pti": "Patiala", 
    "patiyala": "Patiala",
    "sirhind": "Patiala",
    "rajpura": "Patiala",
    "nabha": "Patiala",
    "samana": "Patiala",

    // Chandigarh + Tricity
    "chd": "Chandigarh", 
    "chandi": "Chandigarh",
    "chandhigarh": "Chandigarh",
    "chandigarh sector": "Chandigarh",
    "sector": "Chandigarh",
    "sec 17": "Chandigarh", 
    "sec 35": "Chandigarh",
    "isbt 17": "Chandigarh", 
    "isbt 43": "Chandigarh",
    "panchkula": "Chandigarh",
    "pkl": "Chandigarh",
    "isbt chandigarh": "Chandigarh",
    "chandigarh airport": "Chandigarh",

    // Zirakpur
    "zkp": "Zirakpur", 
    "zirkpur": "Zirakpur", 
    "jerkpur": "Zirakpur", 
    "zirkapur": "Zirakpur",
    "dera basi": "Zirakpur",
    "dera bassi": "Zirakpur",
    "derabassi": "Zirakpur",
    "dhakoli": "Zirakpur",

    // Mohali
    "mhl": "Mohali", 
    "mohali sector": "Mohali",
    "sahibzada ajit singh nagar": "Mohali", 
    "sas nagar": "Mohali",
    "kharar": "Mohali",
    "kahrar": "Mohali",
    "Kharad": "Mohali",
    "kurali": "Mohali", 
    "mohali phase": "Mohali",
    "phase 11": "Mohali", 
    "phase 10": "Mohali",
    "mohali airport": "Mohali",
    "landran": "Mohali",

    // Amritsar
    "asr": "Amritsar", 
    "Amritser": "Amritsar", 
    "amritsarr": "Amritsar",
    "golden temple": "Amritsar", 
    "wagah border": "Amritsar",
    "amritsar airport": "Amritsar",

    // Ludhiana
    "ldh": "Ludhiana", 
    "ludhiyana": "Ludhiana",
    "ludhianaa": "Ludhiana",

    // Jalandhar
    "jld": "Jalandhar", 
    "jalandar": "Jalandhar",
    "jullundur": "Jalandhar", 
    "phagwara": "Jalandhar",
  };
}

/**
 * ✅ REFACTORED: Extract all cities mentioned in text
 * Now used as the base function for pipeline routing
 * Finds ALL cities (pickup, drop, any mention) in order of appearance
 */
function extractAllCities(text, cities) {
  if (!text) return [];
  
  if (!cities || !Array.isArray(cities) || cities.length === 0) {
    return [];
  }

  const normalized = normalizeText(text);
  const aliasMap = getCityAliasMap();
  const foundCities = [];

  for (const city of cities) {
    const cityLower = city.toLowerCase();

    const cityPattern = new RegExp('\\b' + escapeRegex(cityLower) + '\\b', 'i');
    const cityMatch = normalized.match(cityPattern);

    if (cityMatch) {
      const pos = normalized.indexOf(cityLower);
      foundCities.push({
        city: city,
        position: pos,
        matchType: 'full'
      });
    }

    for (const [alias, targetCity] of Object.entries(aliasMap)) {
      if (targetCity === city) {
        let aliasMatch = false;
        let aliasPos = -1;

        if (alias.includes(' ')) {
          const multiWordPattern = new RegExp('\\b' + escapeRegex(alias) + '\\b', 'i');
          const match = normalized.match(multiWordPattern);
          if (match) {
            aliasMatch = true;
            aliasPos = normalized.indexOf(alias);
          }
        } else if (alias.length >= 3) {
          const pattern = new RegExp('\\b' + escapeRegex(alias) + '\\b', 'i');
          const match = normalized.match(pattern);
          if (match) {
            aliasMatch = true;
            aliasPos = normalized.indexOf(alias);
          }
        } else if (alias.length === 2) {
          const twoCharPattern = new RegExp('(^|\\s)' + escapeRegex(alias) + '(\\s|$)', 'i');
          const match = normalized.match(twoCharPattern);
          if (match) {
            aliasMatch = true;
            aliasPos = normalized.indexOf(' ' + alias);
            if (aliasPos === -1) aliasPos = 0;
          }
        }

        if (aliasMatch && aliasPos !== -1) {
          const isDuplicate = foundCities.some(
            f => f.city === city && Math.abs(f.position - aliasPos) < 5
          );

          if (!isDuplicate) {
            foundCities.push({
              city: city,
              position: aliasPos,
              matchType: 'alias'
            });
          }
        }
      }
    }
  }

  const uniqueCities = [];
  const seenCities = new Set();

  foundCities.sort((a, b) => a.position - b.position);

  for (const cityObj of foundCities) {
    if (!seenCities.has(cityObj.city)) {
      uniqueCities.push(cityObj.city);
      seenCities.add(cityObj.city);
    }
  }

  return uniqueCities;
}

/**
 * ✅ NEW: Extract all cities from text for multi-pipeline routing
 * This is the MAIN function used by the router
 * 
 * @param {string} text - Message text
 * @param {Array} pipelines - Array of pipeline configs
 * @returns {Array<string>} - Unique cities found, in order of appearance
 */

/**
 * ✅ FIXED: Extract cities ONLY from route context (from/to/pickup/drop)
 * Properly handles multi-word cities and ignores unrelated words
 */
export function extractCitiesForPipelines(text, pipelines) {
  if (!text || !pipelines || !Array.isArray(pipelines)) {
    return [];
  }

  // Build unified list of all cities from all pipelines
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

  /**
   * Helper: Check if a word/phrase matches a city (including aliases)
   */
  function matchesCity(phrase, citiesArray, aliasMap) {
    const phraseLower = phrase.toLowerCase().trim();
    
    // Direct city name match
    for (const city of citiesArray) {
      if (city.toLowerCase() === phraseLower) {
        return city;
      }
    }
    
    // Alias match
    if (aliasMap[phraseLower]) {
      const mappedCity = aliasMap[phraseLower];
      if (citiesArray.includes(mappedCity)) {
        return mappedCity;
      }
    }
    
    return null;
  }

/**
 * ✅ ENHANCED: Extract cities from a text segment
 * Handles "outside Delhi airport", "near Chandigarh sector 17", etc.
 */
function extractCitiesFromSegment(segment, citiesArray, aliasMap) {
  const words = segment.trim().split(/\s+/);
  const cities = [];
  
  // ✅ ADD: Skip common non-city words
  const skipWords = new Set([
    'outside', 'near', 'inside', 'from', 'to', 
    'at', 'in', 'the', 'a', 'an'
  ]);
  
  // Try all possible combinations up to 5 words
  for (let len = 1; len <= Math.min(5, words.length); len++) {
    for (let i = 0; i <= words.length - len; i++) {
      // ✅ Skip if starts with non-city word
      if (skipWords.has(words[i].toLowerCase())) {
        continue;
      }
      
      const phrase = words.slice(i, i + len).join(" ");
      const city = matchesCity(phrase, citiesArray, aliasMap);
      
      if (city && !cities.includes(city)) {
        cities.push(city);
        // Found a city, move to next position after this city
        i += len - 1; // Will be incremented by loop
        break;
      }
    }
  }
  
  return cities;
}

  // ============================================================================
  // PATTERN 1: "from X to Y" - Extract both X and Y
  // ============================================================================
  const fromToPattern = /\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+contact|\s+phone|\s+\d|\s*$)/i;
  const fromToMatch = normalized.match(fromToPattern);

  if (fromToMatch) {
    const sourceText = fromToMatch[1].trim();
    const destText = fromToMatch[2].trim();

    // Extract from source
    const sourceCities = extractCitiesFromSegment(sourceText, citiesArray, aliasMap);
    sourceCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });

    // Extract from destination
    const destCities = extractCitiesFromSegment(destText, citiesArray, aliasMap);
    destCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });

    // ✅ If we found cities in "from X to Y", STOP (don't scan rest)
    if (foundCities.length > 0) {
      return foundCities;
    }
  }

  // ============================================================================
  // PATTERN 2: "X to Y" (without "from")
  // ============================================================================
  const toPattern = /^(.+?)\s+to\s+(.+?)(?:\s+contact|\s+phone|\s+\d|\s*$)/i;
  const toMatch = normalized.match(toPattern);

  if (toMatch && !normalized.includes('from')) {
    const sourceText = toMatch[1].trim();
    const destText = toMatch[2].trim();

    // Extract from source
    const sourceCities = extractCitiesFromSegment(sourceText, citiesArray, aliasMap);
    sourceCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });

    // Extract from destination
    const destCities = extractCitiesFromSegment(destText, citiesArray, aliasMap);
    destCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });

    if (foundCities.length > 0) {
      return foundCities;
    }
  }

  // ============================================================================
  // PATTERN 3: "pickup: X" and "drop: Y"
  // ============================================================================
  const pickupPattern = /\bpickup\s*:?\s*(.+?)(?:\s*drop|\s*to|\s*-|\s*phone|\s*contact|\s*\d|$)/i;
  const dropPattern = /\bdrop\s*:?\s*(.+?)(?:\s*pickup|\s*-|\s*phone|\s*contact|\s*\d|$)/i;

  const pickupMatch = normalized.match(pickupPattern);
  const dropMatch = normalized.match(dropPattern);

  if (pickupMatch) {
    const pickupText = pickupMatch[1].trim();
    const pickupCities = extractCitiesFromSegment(pickupText, citiesArray, aliasMap);
    pickupCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });
  }

  if (dropMatch) {
    const dropText = dropMatch[1].trim();
    const dropCities = extractCitiesFromSegment(dropText, citiesArray, aliasMap);
    dropCities.forEach(city => {
      if (!foundCities.includes(city)) {
        foundCities.push(city);
      }
    });
  }

  // ✅ CRITICAL: Return cities found in routing patterns ONLY
  return foundCities;
}

/**
 * ✅ NEW: Check if extracted cities match a pipeline's cityScope
 * 
 * @param {Array<string>} extractedCities - Cities found in message
 * @param {Array<string>} cityScope - Pipeline's cityScope array
 * @returns {boolean} - True if pipeline should handle this message
 */
export function matchesPipeline(extractedCities, cityScope) {
  if (!Array.isArray(cityScope) || cityScope.length === 0) {
    return false;
  }

  // Wildcard pipeline accepts all messages
  if (cityScope.includes("*")) {
    return true;
  }

  // No cities extracted = no match (unless wildcard)
  if (!extractedCities || extractedCities.length === 0) {
    return false;
  }

  // Check if ANY extracted city matches ANY city in pipeline's scope
  return extractedCities.some(city => 
    cityScope.some(scopeCity => 
      scopeCity.toLowerCase() === city.toLowerCase()
    )
  );
}

/**
 * Check if message is a taxi request
 */
export function isTaxiRequest(text, keywords, ignoreList, blockedNumbers = []) {
  if (!text) return false;

  const normalized = normalizeText(text);
  const originalLower = text.toLowerCase();

  // Check blocked numbers (for backward compatibility)
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

  // Check for taxi keywords
  const hasKeyword = keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );

  // Check for route patterns (from/to)
  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

/**
 * Generate message fingerprint for deduplication
 */
export function getMessageFingerprint(text, messageId = null, timestamp = null) {
  if (!text) return "";

  // Normalize text for fingerprinting
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\d{10,}/g, 'PHONE')
    .trim()
    .substring(0, 300);

  // Generate hash from normalized text
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const textHash = Math.abs(hash).toString(36);

  // Use 5-minute time windows for fingerprinting
  const now = timestamp || Date.now();
  const timeWindow = Math.floor(now / 300000);

  return `fp-${textHash}-${timeWindow}`;
}