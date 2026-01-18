/**
 * ============================================================================
 * CITY ALIASES DATABASE
 * ============================================================================
 * 
 * This file contains comprehensive city name mappings for taxi routing.
 * Each alias maps to a canonical city name used in pipeline configurations.
 * 
 * Structure: "alias": "CanonicalCityName"
 * 
 * Guidelines:
 * - Include ALL common misspellings
 * - Include abbreviations (e.g., "ggn" → "Gurgaon")
 * - Include landmarks (e.g., "t3" → "Delhi")
 * - Include local names (e.g., "pink city" → "Jaipur")
 * - Keep canonical names in Title Case
 */

export const CITY_ALIASES = {
  // Ambala
  "amb": "Ambala",
  "ambala": "Ambala",
  "ambala cantonment": "Ambala",
  "ambala cantt": "Ambala",
  "ambala city": "Ambala",
  "ambala railway station": "Ambala",
  "ambl": "Ambala",

  // Patiala
  "bathinda": "Patiala",
  "kotakpura": "Patiala",
  "malerkotla": "Patiala",
  "nabha": "Patiala",
  "patiala": "Patiala",
  "patiyala": "Patiala",
  "pti": "Patiala",
  "ptl": "Patiala",
  "rajpura": "Patiala",
  "samana": "Patiala",
  "sirhind": "Patiala",

  // Chandigarh
  "chandhigarh": "Chandigarh",
  "chandi": "Chandigarh",
  "chandigarh": "Chandigarh",
  "chandigarh airport": "Chandigarh",
  "chandigarh sector": "Chandigarh",
  "chd": "Chandigarh",
  "isbt 17": "Chandigarh",
  "isbt 43": "Chandigarh",
  "isbt chandigarh": "Chandigarh",
  "panchkula": "Chandigarh",
  "pgi": "Chandigarh",
  "pgimer": "Chandigarh",
  "pkl": "Chandigarh",
  "sec 17": "Chandigarh",
  "sec 35": "Chandigarh",
  "sector": "Chandigarh",
  "sector 17": "Chandigarh",
  "sector 35": "Chandigarh",

  // Zirakpur
  "dera basi": "Zirakpur",
  "dera bassi": "Zirakpur",
  "derabassi": "Zirakpur",
  "dhakoli": "Zirakpur",
  "jerkpur": "Zirakpur",
  "zirakpur": "Zirakpur",
  "zirkapur": "Zirakpur",
  "zirkpur": "Zirakpur",
  "zkp": "Zirakpur",

  // Mohali
  "kahrar": "Mohali",
  "khrar": "Mohali",
  "kharad": "Mohali",
  "kharar": "Mohali",
  "kurali": "Mohali",
  "landran": "Mohali",
  "mhl": "Mohali",
  "mohali": "Mohali",
  "mohali airport": "Mohali",
  "mohali phase": "Mohali",
  "mohali sector": "Mohali",
  "morinda": "Mohali",
  "phase 10": "Mohali",
  "phase 11": "Mohali",
  "sahibzada ajit singh nagar": "Mohali",
  "sas nagar": "Mohali",

  // Amritsar
  "abohar": "Amritsar",
  "amritsar": "Amritsar",
  "amritsar airport": "Amritsar",
  "amritsarr": "Amritsar",
  "amritser": "Amritsar",
  "asr": "Amritsar",
  "beas": "Amritsar",
  "golden temple": "Amritsar",
  "wagah border": "Amritsar",

  // Ludhiana
  "khanna": "Ludhiana",
  "ldh": "Ludhiana",
  "ludhiana": "Ludhiana",
  "ludhianaa": "Ludhiana",
  "ludhiyana": "Ludhiana",
  "ludiana": "Ludhiana",

  // Jalandhar
  "jalandar": "Jalandhar",
  "jalandhar": "Jalandhar",
  "jld": "Jalandhar",
  "jullundur": "Jalandhar",
  "phagwara": "Jalandhar",

  // Delhi
  "aerocity": "Delhi",
  "ajmeri gate": "Delhi",
  "ajmeri gate railway": "Delhi",
  "ajmeri gate railway station": "Delhi",
  "anand vihar": "Delhi",
  "anand vihar isbt": "Delhi",
  "anand vihar terminal": "Delhi",
  "central delhi": "Delhi",
  "chandni chowk": "Delhi",
  "civil lines": "Delhi",
  "connaught place": "Delhi",
  "cp": "Delhi",
  "defence colony": "Delhi",
  "dehli": "Delhi",
  "delhi": "Delhi",
  "delhi airport": "Delhi",
  "delhi junction": "Delhi",
  "delhi railway": "Delhi",
  "dilhe": "Delhi",
  "dilhi": "Delhi",
  "dilli": "Delhi",
  "dilshad garden": "Delhi",
  "dli": "Delhi",
  "dwarka": "Delhi",
  "dwarka sector": "Delhi",
  "east delhi": "Delhi",
  "gk": "Delhi",
  "gk 1": "Delhi",
  "gk 2": "Delhi",
  "greater kailash": "Delhi",
  "green park": "Delhi",
  "gtb nagar": "Delhi",
  "hauz khas": "Delhi",
  "hazrat nizamuddin": "Delhi",
  "igi": "Delhi",
  "igi airport": "Delhi",
  "india gate": "Delhi",
  "indira gandhi airport": "Delhi",
  "isbt delhi": "Delhi",
  "janakpuri": "Delhi",
  "kalkaji": "Delhi",
  "karol bagh": "Delhi",
  "kashmere gate": "Delhi",
  "kashmeri gate": "Delhi",
  "kashmir gate": "Delhi",
  "kashmiri gate": "Delhi",
  "kirti nagar": "Delhi",
  "lajpat nagar": "Delhi",
  "lakshmi nagar": "Delhi",
  "mahipalpur": "Delhi",
  "malviya nagar": "Delhi",
  "mayur vihar": "Delhi",
  "model town": "Delhi",
  "moti nagar": "Delhi",
  "munirka": "Delhi",
  "ndls": "Delhi",
  "nehru place": "Delhi",
  "new delhi": "Delhi",
  "new delhi railway": "Delhi",
  "new delhi station": "Delhi",
  "nizamuddin": "Delhi",
  "nizamuddin railway": "Delhi",
  "north delhi": "Delhi",
  "okhla": "Delhi",
  "old delhi": "Delhi",
  "old delhi railway": "Delhi",
  "old delhi station": "Delhi",
  "paharganj": "Delhi",
  "paschim vihar": "Delhi",
  "pitampura": "Delhi",
  "preet vihar": "Delhi",
  "punjabi bagh": "Delhi",
  "r k puram": "Delhi",
  "rajiv chowk": "Delhi",
  "rajiv chowk metro": "Delhi",
  "rajouri garden": "Delhi",
  "red fort": "Delhi",
  "rohini": "Delhi",
  "sadar": "Delhi",
  "sadar bazar": "Delhi",
  "saket": "Delhi",
  "saket metro": "Delhi",
  "sarai kale khan": "Delhi",
  "sarai kale khan isbt": "Delhi",
  "sarai rohilla": "Delhi",
  "shahdara": "Delhi",
  "shalimar bagh": "Delhi",
  "south delhi": "Delhi",
  "subhash nagar": "Delhi",
  "t1": "Delhi",
  "t2": "Delhi",
  "t3": "Delhi",
  "terminal 1": "Delhi",
  "terminal 2": "Delhi",
  "terminal 3": "Delhi",
  "terminal one": "Delhi",
  "terminal three": "Delhi",
  "terminal two": "Delhi",
  "terminal1": "Delhi",
  "terminal2": "Delhi",
  "terminal3": "Delhi",
  "tilak nagar": "Delhi",
  "uttam nagar": "Delhi",
  "vasant kunj": "Delhi",
  "vasant vihar": "Delhi",
  "vivek vihar": "Delhi",
  "west delhi": "Delhi",

  // Noida
  "alpha": "Noida",
  "beta": "Noida",
  "botanical garden": "Noida",
  "delta": "Noida",
  "film city": "Noida",
  "gamma": "Noida",
  "gr noida": "Noida",
  "greater noida": "Noida",
  "greater noida west": "Noida",
  "jewar": "Noida",
  "jewar airport": "Noida",
  "knowledge park": "Noida",
  "nioda": "Noida",
  "noida": "Noida",
  "noida city": "Noida",
  "noida city centre": "Noida",
  "noida extension": "Noida",
  "noida sector": "Noida",
  "noyda": "Noida",
  "pari chowk": "Noida",
  "sector 125": "Noida",
  "sector 137": "Noida",
  "sector 15": "Noida",
  "sector 16": "Noida",
  "sector 18": "Noida",
  "sector 52": "Noida",
  "sector 58": "Noida",
  "sector 59": "Noida",
  "sector 61": "Noida",
  "sector 62": "Noida",
  "sector 63": "Noida",

  // Gurgaon
  "cyber city": "Gurgaon",
  "cyber hub": "Gurgaon",
  "dlf 1": "Gurgaon",
  "dlf 2": "Gurgaon",
  "dlf 3": "Gurgaon",
  "dlf 4": "Gurgaon",
  "dlf 5": "Gurgaon",
  "dlf cyber city": "Gurgaon",
  "dlf phase": "Gurgaon",
  "dlf phase 1": "Gurgaon",
  "dlf phase 2": "Gurgaon",
  "dlf phase 3": "Gurgaon",
  "dlf phase 4": "Gurgaon",
  "dlf phase 5": "Gurgaon",
  "ggn": "Gurgaon",
  "golf course extension": "Gurgaon",
  "golf course road": "Gurgaon",
  "grg": "Gurgaon",
  "gurgaon": "Gurgaon",
  "gurgoan": "Gurgaon",
  "gurugram": "Gurgaon",
  "huda city centre": "Gurgaon",
  "iffco chowk": "Gurgaon",
  "manesar": "Gurgaon",
  "mg road": "Gurgaon",
  "mg road gurgaon": "Gurgaon",
  "mg road metro": "Gurgaon",
  "new gurgaon": "Gurgaon",
  "old gurgaon": "Gurgaon",
  "palam vihar": "Gurgaon",
  "sector 29": "Gurgaon",
  "sohna": "Gurgaon",
  "sohna road": "Gurgaon",
  "south city": "Gurgaon",
  "sushant lok": "Gurgaon",
  "udyog vihar": "Gurgaon",

  // Faridabad
  "badarpur": "Faridabad",
  "badarpur border": "Faridabad",
  "ballabgarh": "Faridabad",
  "bata chowk": "Faridabad",
  "fariadabad": "Faridabad",
  "faridabaad": "Faridabad",
  "faridabad": "Faridabad",
  "fbd": "Faridabad",
  "fridabad": "Faridabad",
  "neelam chowk": "Faridabad",
  "new faridabad": "Faridabad",
  "nhpc chowk": "Faridabad",
  "old faridabad": "Faridabad",
  "sector 16 faridabad": "Faridabad",

  // Ghaziabad
  "crossings republik": "Ghaziabad",
  "gaziabad": "Ghaziabad",
  "ghaziabad": "Ghaziabad",
  "ghz": "Ghaziabad",
  "gzb": "Ghaziabad",
  "indirapuram": "Ghaziabad",
  "kaushambi": "Ghaziabad",
  "loni": "Ghaziabad",
  "loni border": "Ghaziabad",
  "mohan nagar": "Ghaziabad",
  "old ghaziabad": "Ghaziabad",
  "raj nagar": "Ghaziabad",
  "raj nagar extension": "Ghaziabad",
  "vaishali": "Ghaziabad",
  "vasundhara": "Ghaziabad",
  "vijay nagar": "Ghaziabad",

  // Agra
  "agra": "Agra",
  "mathura": "Agra",
  "taj mahal": "Agra",

  // Ajmer
  "ajmer": "Ajmer",
  "pushkar": "Ajmer",

  // Dehradun
  "dehradun": "Dehradun",

  // Dharamshala
  "dharamshala": "Dharamshala",
  "mcleod ganj": "Dharamshala",

  // Haridwar
  "haridwar": "Haridwar",
  "rishikesh": "Haridwar",

  // Hisar
  "hisar": "Hisar",

  // Jaipur
  "jaipur": "Jaipur",
  "jpr": "Jaipur",
  "pink city": "Jaipur",

  // Jodhpur
  "jodhpur": "Jodhpur",

  // Karnal
  "karnal": "Karnal",

  // Manali
  "kullu": "Manali",
  "manali": "Manali",

  // Panipat
  "panipat": "Panipat",

  // Pathankot
  "pathankot": "Pathankot",

  // Rohtak
  "rohtak": "Rohtak",

  // Shimla
  "shimla": "Shimla",

  // Udaipur
  "udaipur": "Udaipur"
};

/**
 * Get canonical city name from alias
 * @param {string} alias - City name or alias (case-insensitive)
 * @returns {string|null} - Canonical city name or null if not found
 */
export function getCanonicalCityName(alias) {
  if (!alias) return null;
  
  const normalized = alias.toLowerCase().trim();
  return CITY_ALIASES[normalized] || null;
}

/**
 * Check if a word/phrase is a valid city
 * @param {string} word - Word or phrase to check
 * @param {Array<string>} configuredCities - List of cities from pipeline config
 * @returns {string|null} - Canonical city name if found and configured, null otherwise
 */
export function matchCity(word, configuredCities) {
  if (!word || !configuredCities) return null;
  
  const canonical = getCanonicalCityName(word);
  
  if (canonical && configuredCities.includes(canonical)) {
    return canonical;
  }
  
  return null;
}

/**
 * Get all aliases for a canonical city name
 * @param {string} canonicalName - Canonical city name
 * @returns {Array<string>} - List of all aliases
 */
export function getAliasesForCity(canonicalName) {
  return Object.entries(CITY_ALIASES)
    .filter(([alias, canonical]) => canonical === canonicalName)
    .map(([alias]) => alias);
}