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
 * Numbers are normalized to bare 10 digits (strips +91 / spaces / dashes).
 * Restart the bot(s) after editing for changes to take effect.
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

/** Strip everything but digits, drop a leading 91 country code on 12-digit inputs. */
function normNumber(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  return d;
}

function isValidNumber(d) {
  return d.length === 10;
}

/** Add normalized numbers to a field, reporting added vs already-present. */
function addNumbers(data, field, inputs) {
  const set = new Set(data[field]);
  const added = [];
  const dupes = [];
  const invalid = [];
  for (const raw of inputs) {
    const d = normNumber(raw);
    if (!isValidNumber(d)) { invalid.push(`${raw} -> "${d}"`); continue; }
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
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 21).join("\n").replace(/^ \* ?/gm, ""));
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
  const d = normNumber(args[1] || "");
  if (!isValidNumber(d)) { console.error(`Not a valid 10-digit number: "${args[1]}"`); process.exit(1); }
  const inNums = data.blockedPhoneNumbers.includes(d);
  const inSenders = data.blockedSenders.includes(d);
  console.log(`${d}:`);
  console.log(`  blockedPhoneNumbers : ${inNums ? "YES" : "no"}`);
  console.log(`  blockedSenders      : ${inSenders ? "YES" : "no"}`);
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
