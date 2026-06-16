/**
 * ============================================================================
 * FILTER - Message Validation & City Extraction (SMART DETECTION FIXED)
 * ============================================================================
 * ✅ CRITICAL FIX: Fallback pattern now checks context before extracting city
 * ✅ Prevents false positives from company names (e.g., "ABC Travels Amritsar")
 * ✅ Only extracts cities that appear in route-relevant context
 * ============================================================================
 */

const ROUTE_PATTERNS = [
  /\bfrom\b.+\bto\b/i,
  /\bto\b.+\bfrom\b/i,
  /\b\w+\s+to\s+\w+/i,
  /\b\w+\s+drop\s+\w+/i,
  /\bcurrent\s+\w+/i,
  /pickup/i,
  /drop/i,
];

function normalizeText(text) {
  if (!text) return "";

  return text
    .normalize("NFC")  // Unify Unicode form so Hindi/Punjabi precomposed vs decomposed (nukta) letters match keywords
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{1F100}-\u{1F1DF}]/gu, "") // Enclosed alphanumeric supplement (covers 🆓 U+1F191)
    .replace(/[\u{1FA00}-\u{1FAFF}]/gu, "") // Symbols & Pictographs Extended-A
    .replace(/[*`~]/g, " ")                 // WhatsApp bold/code/strikethrough markers
    .replace(/_/g, " ")                     // WhatsApp italic markers
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
 * CORE FIX: Smart city extraction with context awareness
 * ============================================================================
 * Returns: { pickup: string|null, drop: string|null, allCities: string[] }
 *
 * Pattern priority (FIXED):
 *   1. "from X to Y"           → pickup: X, drop: Y
 *   2. "Y drop current X"      → pickup: X, drop: Y
 *   3. "Y drop X"              → pickup: X, drop: Y
 *   4. "X to Y"                → pickup: X, drop: Y
 *   5. "pickup: X, drop: Y"    → pickup: X, drop: Y
 *   6. "current X"             → pickup: X
 *   7. Context-aware scan      → ONLY if city appears near route keywords
 *
 * ⚠️  CRITICAL: Pattern 7 now checks context to avoid false positives like
 *     "ABC Travels Amritsar" when the actual route is "Mohali to Patiala"
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

  // Pattern 2: "Y drop current X" → pickup: X, drop: Y
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

  // Pattern 3: "Y drop X" → pickup: X, drop: Y
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

  // Pattern 6: "current X" → pickup: X
  const currentPattern = /\bcurrent\s+([a-z\s]+?)(?:\s|$|[^a-z])/i;
  const currentMatch = normalized.match(currentPattern);
  
  if (currentMatch) {
    const currentWords = currentMatch[1].trim().split(/\s+/).slice(0, 3);
    const pickupCities = scanWords(currentWords, cities);
    
    if (pickupCities.length > 0) {
      // Still scan the rest for drop city using context-aware method
      const allFoundCities = scanCitiesWithContext(normalized, cities);
      const dropCity = allFoundCities.find(c => c !== pickupCities[0]) || null;
      
      return {
        pickup: pickupCities[0],
        drop: dropCity,
        allCities: allFoundCities,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pattern 7: Context-aware fallback (FIXED TO PREVENT FALSE POSITIVES)
  // ═══════════════════════════════════════════════════════════════════════════
  // ONLY extract cities that appear in route-relevant context
  // DO NOT extract cities from company names, signatures, or footer text
  
  const citiesInContext = scanCitiesWithContext(normalized, cities);
  
  if (citiesInContext.length > 0) {
    return {
      pickup: citiesInContext[0] || null,
      drop: citiesInContext[1] || null,
      allCities: citiesInContext,
    };
  }

  return { pickup: null, drop: null, allCities: [] };
}

/**
 * ============================================================================
 * SMART CONTEXT-AWARE CITY SCANNER (prevents false positives)
 * ============================================================================
 * Only returns cities that appear near route-relevant keywords.
 * 
 * Example of what this PREVENTS:
 *   "Need ride Mohali to Patiala. Contact ABC Travels Amritsar 98765..."
 *   OLD: Would extract [Mohali, Patiala, Amritsar] ❌
 *   NEW: Extracts [Mohali, Patiala] ✅ (Amritsar is in company name context)
 * ============================================================================
 */
function scanCitiesWithContext(normalized, cities) {
  const words = normalized.split(/\s+/);
  const foundCities = [];
  const aliasMap = getCityAliasMap();

  // Context keywords that indicate a city is part of the route (not a company name)
  const routeContextKeywords = [
    'from', 'to', 'pickup', 'drop', 'current', 'need', 'want', 'required',
    'looking', 'book', 'hire', 'rent', 'ride', 'trip', 'journey', 'travel',
    'car', 'taxi', 'cab', 'vehicle', 'driver', 'sedan', 'suv', 'innova',
    'swift', 'ertiga', 'tempo', 'bus', 'ac', 'non-ac'
  ];

  // Company/signature keywords that indicate a city is NOT part of the route
  const companyContextKeywords = [
    'travels', 'transport', 'cabs', 'services', 'tours', 'holidays',
    'rental', 'rentals', 'contact', 'call', 'whatsapp', 'agency',
    'booking', 'book', 'now', 'available', 'thanks', 'regards',
    'pvt', 'ltd', 'limited', 'company', 'group'
  ];

  function isConfiguredCity(word) {
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

  function hasContextNearby(wordIndex, contextKeywords, windowSize = 5) {
    const start = Math.max(0, wordIndex - windowSize);
    const end = Math.min(words.length, wordIndex + windowSize + 1);
    
    for (let i = start; i < end; i++) {
      if (contextKeywords.includes(words[i])) {
        return true;
      }
    }
    return false;
  }

  for (let i = 0; i < words.length; i++) {
    // Check 1-word city
    let city = isConfiguredCity(words[i]);
    if (city && !foundCities.includes(city)) {
      // Verify this city is in route context, not company context
      const hasRouteContext = hasContextNearby(i, routeContextKeywords, 5);
      const hasCompanyContext = hasContextNearby(i, companyContextKeywords, 3);
      
      // Only add if:
      // - Has route context nearby, OR
      // - Doesn't have company context nearby (safer default)
      if (hasRouteContext || !hasCompanyContext) {
        foundCities.push(city);
      }
      continue;
    }

    // Check 2-word city
    if (i < words.length - 1) {
      const twoWords = words[i] + " " + words[i + 1];
      city = isConfiguredCity(twoWords);
      if (city && !foundCities.includes(city)) {
        const hasRouteContext = hasContextNearby(i, routeContextKeywords, 5);
        const hasCompanyContext = hasContextNearby(i, companyContextKeywords, 3);
        
        if (hasRouteContext || !hasCompanyContext) {
          foundCities.push(city);
        }
        continue;
      }
    }

    // Check 3-word city
    if (i < words.length - 2) {
      const threeWords = words[i] + " " + words[i + 1] + " " + words[i + 2];
      city = isConfiguredCity(threeWords);
      if (city && !foundCities.includes(city)) {
        const hasRouteContext = hasContextNearby(i, routeContextKeywords, 5);
        const hasCompanyContext = hasContextNearby(i, companyContextKeywords, 3);
        
        if (hasRouteContext || !hasCompanyContext) {
          foundCities.push(city);
        }
      }
    }
  }

  return foundCities;
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
export function isTaxiRequest(text, keywords, ignoreList) {
  if (!text) return false;

  const normalized = normalizeText(text);
  const originalLower = text.normalize("NFC").toLowerCase();

  // Strip WhatsApp formatting symbols (* ` ~ _) for keyword matching.
  // Replace with space (not empty string) to preserve word boundaries.
  // Note: _ is a word character in regex, so _available_ would bypass \b without this.
  const cleanedText = originalLower.replace(/[*`~]/g, " ").replace(/_/g, " ");

  // Check ignore keywords
  for (const ignoreWord of ignoreList) {
    const ignoreWordLower = ignoreWord.toLowerCase();

    if (ignoreWordLower.includes(' ')) {
      // Multi-word phrase — substring match on cleanedText
      if (cleanedText.includes(ignoreWordLower)) {
        return false;
      }
    } else {
      // Single word — detect if it contains non-ASCII characters (Unicode, emoji)
      const hasNonAscii = /[^\x00-\x7F]/.test(ignoreWordLower);

      if (hasNonAscii) {
        // \b is ASCII-only and never fires on Unicode chars.
        // Use Unicode property escapes (\p{L} = any letter, \p{N} = any digit) with negative
        // lookahead/lookbehind to enforce real word boundaries across all scripts and emoji.
        // Requires the `u` flag — supported in Node.js 10+ (project requires 18+).
        const escapedKeyword = ignoreWordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const unicodeBoundaryRegex = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapedKeyword}(?![\\p{L}\\p{N}])`,
          'u'
        );
        if (unicodeBoundaryRegex.test(cleanedText)) {
          return false;
        }
      } else {
        // ASCII word — word boundary regex on cleanedText (formatting already stripped)
        const wordBoundaryRegex = new RegExp(`\\b${ignoreWordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (wordBoundaryRegex.test(cleanedText)) {
          return false;
        }
      }
    }
  }

  const hasKeyword = keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );

  const hasRoute = ROUTE_PATTERNS.some((pattern) => pattern.test(normalized));

  return hasKeyword || hasRoute;
}

/**
 * ============================================================================
 * PROMO TRANSFORM — replace phone numbers with the app link (promoter bot)
 * ============================================================================
 * Used ONLY by a bot running promoMode. Routing decisions still use the ORIGINAL
 * text (cities etc.); this only rewrites the OUTGOING copy so the forwarded post
 * sends people to the app instead of the original caller's number.
 *
 * Behaviour:
 *   • The FIRST phone number found is replaced with a rotating CTA (which carries
 *     the app link) — keeps the message natural and inserts exactly one link.
 *   • Any ADDITIONAL numbers are stripped, so no contact number ever leaks and we
 *     never paste the link twice.
 *   • A whitespace run containing several numbers counts as one removal (all gone,
 *     one CTA) — covers two numbers separated only by space/newline.
 * ============================================================================
 */

// A digit, then 7+ phone-ish chars (digits/space/()/./-), then a digit.
// Letters break the run, so cities, "innova", years embedded in words are safe.
const PHONE_CANDIDATE = /\+?\d[\d\s().\-]{7,}\d/g;

// A matched run is treated as phone number(s) if it carries 10+ actual digits.
// (10 = one number; longer = multiple numbers in one run, all to be removed.)
function looksLikePhone(digits) {
  return digits.length >= 10;
}

/**
 * Pick a CTA variant at random and substitute {link} with the app link.
 * Randomising per-message reduces the "identical text" spam fingerprint.
 */
export function pickCta(ctaVariants, appLink) {
  const variants =
    Array.isArray(ctaVariants) && ctaVariants.length
      ? ctaVariants
      : ["Book this ride on our app: {link}"];
  const choice = variants[Math.floor(Math.random() * variants.length)];
  return choice.replace(/\{link\}/g, appLink || "");
}

/**
 * Replace phone numbers in `text` with a rotating CTA + app link.
 * Returns { text, replaced } where `replaced` is how many number-runs were hit.
 */
export function applyPromo(text, appLink, ctaVariants) {
  if (!text) return { text: text || "", replaced: 0 };

  const cta = pickCta(ctaVariants, appLink);
  let count = 0;

  let out = text.replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (!looksLikePhone(digits)) return match; // too few digits → not a phone
    count++;
    return count === 1 ? cta : ""; // first → CTA(+link); extras removed
  });

  // Tidy whitespace left behind by removals.
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Safety net: validation guarantees a phone was present, but if the matcher
  // somehow found none, still promote rather than forward a bare request.
  if (count === 0) out = `${out} ${cta}`.trim();

  return { text: out, replaced: count };
}

/**
 * 🔒 Anti-ban hardening
 * Generates a text-based fingerprint for deduplication.
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