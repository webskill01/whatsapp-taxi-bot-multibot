#!/usr/bin/env node
/**
 * ============================================================================
 * block.js — dedup-safe editor for core/blocked-data.json
 * ============================================================================
 * The data file is gitignored and edited directly on the VPS. This helper does
 * the "search for redundancy, then add the unique entry" step for you.
 *
 * Usage:
 *   node scripts/block.js 9876543210 9123456789     Add blocked phone numbers (text match)
 *   node scripts/block.js --sender 9602946666       Add a blocked SENDER (drops all their msgs)
 *   node scripts/block.js --ignore "good morning"   Add an ignore phrase/keyword
 *   node scripts/block.js --check 9876543210         Is this number already blocked? (no write)
 *   node scripts/block.js --list                     Show counts
 *
 * Accepts numbers in any format, quoted OR split across shell args:
 *   9053648269   +918920836257   "+91 77079 30908"   +91 77079 30908
 *   91 88207 36257   079...(leading 0)   comma,separated,list
 * All are normalized to bare 10 digits. Restart the bot(s) after editing.
 * ============================================================================
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "core", "blocked-data.json");

function load() {
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    console.error(`ERROR: cannot read ${DATA_PATH}\n  ${err.message}`);
    process.exit(1);
  }
}

function save(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Parse phone numbers from raw CLI args into bare 10-digit numbers.
 *
 * Handles all of these, whether quoted or split across multiple shell args:
 *   9053648269            -> 9053648269
 *   +918920836257         -> 8920836257
 *   "+91 77079 30908"     -> 7707930908
 *   +91 77079 30908       -> 7707930908   (3 separate args, regrouped)
 *   9876543210 9123456789 -> two numbers
 *   a,comma,list          -> split on commas
 *
 * Strategy: flatten args -> split on commas -> strip each piece to digits ->
 * greedily accumulate digit-chunks until a number resolves: 10 digits as-is,
 * a leading 0 at 11 digits, or a leading 91 country code at 12 digits.
 */
function parseNumbers(rawArgs) {
  const chunks = rawArgs
    .flatMap((a) => String(a).split(","))
    .map((t) => t.replace(/\D/g, ""))
    .filter(Boolean);

  const numbers = [];
  const invalid = [];
  let buf = "";

  for (const chunk of chunks) {
    buf += chunk;
    if (buf.length === 10) {
      numbers.push(buf); buf = "";
    } else if (buf.length === 11 && buf.startsWith("0")) {
      numbers.push(buf.slice(1)); buf = "";
    } else if (buf.length === 12 && buf.startsWith("91")) {
      numbers.push(buf.slice(2)); buf = "";
    } else if (buf.length > 12) {
      invalid.push(buf); buf = "";          // overshot — can't resolve this run
    }
    // else: still shorter than a full number, keep accumulating
  }
  if (buf) invalid.push(buf);               // leftover digits that never formed a number
  return { numbers, invalid };
}

/** Add parsed numbers to a field, reporting added vs already-present vs invalid. */
function addNumbers(data, field, rawArgs) {
  const { numbers, invalid } = parseNumbers(rawArgs);
  const set = new Set(data[field]);
  const added = [];
  const dupes = [];
  for (const d of numbers) {
    if (set.has(d)) { dupes.push(d); continue; }
    set.add(d);
    added.push(d);
  }
  data[field] = [...set].sort();
  return { added, dupes, invalid };
}

function report(field, { added, dupes, invalid }) {
  if (added.length)   console.log(`  added to ${field}   : ${added.join(", ")}`);
  if (dupes.length)   console.log(`  already in ${field} : ${dupes.join(", ")}`);
  if (invalid.length) console.log(`  INVALID (skipped)   : ${invalid.join(", ")}`);
  if (!added.length && !dupes.length && !invalid.length) console.log(`  (nothing to do)`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 22).join("\n").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const data = load();

if (args[0] === "--list") {
  console.log(`blockedPhoneNumbers : ${data.blockedPhoneNumbers.length}`);
  console.log(`blockedSenders      : ${data.blockedSenders.length}`);
  console.log(`ignoreIfContains    : ${data.ignoreIfContains.length}`);
  process.exit(0);
}

if (args[0] === "--check") {
  const { numbers, invalid } = parseNumbers(args.slice(1));
  if (numbers.length !== 1 || invalid.length) {
    console.error(`Provide exactly one valid number to check. Parsed: ${[...numbers, ...invalid.map(i => i + "(invalid)")].join(", ") || "(none)"}`);
    process.exit(1);
  }
  const d = numbers[0];
  console.log(`${d}:`);
  console.log(`  blockedPhoneNumbers : ${data.blockedPhoneNumbers.includes(d) ? "YES" : "no"}`);
  console.log(`  blockedSenders      : ${data.blockedSenders.includes(d) ? "YES" : "no"}`);
  process.exit(0);
}

if (args[0] === "--ignore") {
  const phrase = args.slice(1).join(" ").trim();
  if (!phrase) { console.error("Provide a phrase: node scripts/block.js --ignore \"good morning\""); process.exit(1); }
  const key = phrase.normalize("NFC").toLowerCase();
  const exists = data.ignoreIfContains.some(k => k.normalize("NFC").toLowerCase() === key);
  if (exists) {
    console.log(`already in ignoreIfContains: "${phrase}"`);
    process.exit(0);
  }
  data.ignoreIfContains.push(phrase);
  save(data);
  console.log(`added to ignoreIfContains: "${phrase}"`);
  console.log("Restart the bot(s) to apply.");
  process.exit(0);
}

if (args[0] === "--sender") {
  const result = addNumbers(data, "blockedSenders", args.slice(1));
  report("blockedSenders", result);
  if (result.added.length) { save(data); console.log("Restart the bot(s) to apply."); }
  process.exit(0);
}

// Default: positional args are phone numbers for blockedPhoneNumbers
const result = addNumbers(data, "blockedPhoneNumbers", args);
report("blockedPhoneNumbers", result);
if (result.added.length) { save(data); console.log("Restart the bot(s) to apply."); }
