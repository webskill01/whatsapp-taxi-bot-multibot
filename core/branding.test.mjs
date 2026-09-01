// Self-check for fleet branding. Run: node core/branding.test.mjs
//
// Every bot stamps a "Forwarded Duty" variant with its own emoji, so a ride's
// last forwarder is identifiable without any company name. Our bots read each
// other's output, so the stamp must be swapped, never stacked.
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyBranding, stripBranding, getMessageFingerprint } from "./filter.js";
import { GLOBAL_CONFIG } from "./globalConfig.js";

const BOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bots");
const KNOWN = GLOBAL_CONFIG.knownBrandings;
const ride = "Delhi to Noida\nSedan needed\n9876543210";
const count = (t, vs) => vs.reduce((n, v) => n + t.split(v).length - 1, 0);

const configs = fs
  .readdirSync(BOTS)
  .map((b) => [b, path.join(BOTS, b, "config.json")])
  .filter(([, p]) => fs.existsSync(p))
  .map(([b, p]) => [b, JSON.parse(fs.readFileSync(p, "utf8"))]);

assert.ok(configs.length > 0, "no bot configs found");

// 1. THE drift guard: a bot whose stamp is missing from the registry means the
//    rest of the fleet cannot strip it, and every hop stacks another line.
for (const [bot, cfg] of configs) {
  for (const v of cfg.brandingSuffixes || []) {
    assert.ok(KNOWN.includes(v), `${bot}: "${v}" missing from GLOBAL_CONFIG.knownBrandings`);
  }
}

// 2. No variant may be a suffix of another, or peeling one leaves the other's
//    debris glued to the ride text.
for (const a of KNOWN) {
  for (const b of KNOWN) {
    assert.ok(a === b || !a.endsWith(b), `"${a}" ends with "${b}" — peeling breaks`);
  }
}

// 3. Each bot is distinguishable: no two bots share a stamp.
const seen = new Map();
for (const [bot, cfg] of configs) {
  for (const v of cfg.brandingSuffixes || []) {
    assert.ok(!seen.has(v), `${bot} and ${seen.get(v)} both stamp "${v}"`);
    seen.set(v, bot);
  }
}

// 4. A ride wearing ANY fleet stamp comes out wearing exactly one — ours.
for (const [bot, cfg] of configs) {
  const own = cfg.brandingSuffixes || [];
  if (own.length === 0) continue;
  for (const incoming of KNOWN) {
    const out = applyBranding(`${ride}\n\n${incoming}`, own, KNOWN);
    assert.strictEqual(count(out, KNOWN), 1, `${bot}: exactly one stamp`);
    assert.ok(own.some((v) => out.endsWith(v)), `${bot}: must be our own stamp`);
    assert.ok(out.startsWith(ride), `${bot}: ride text preserved`);
  }
}

// 5. Round-tripping through the whole fleet never stacks.
let msg = ride;
for (let i = 0; i < 10; i++) {
  for (const [, cfg] of configs) {
    if (cfg.brandingSuffixes?.length) {
      msg = applyBranding(msg, cfg.brandingSuffixes, KNOWN);
    }
  }
}
assert.strictEqual(count(msg, KNOWN), 1, "fleet loop must stay at 1 stamp");

// 6. The dedup bug this prevents: the same ride wearing different stamps must
//    fingerprint identically once stripped, or it forwards once per variant.
const fps = new Set(
  KNOWN.map((v) => getMessageFingerprint(stripBranding(`${ride}\n\n${v}`, KNOWN), null, 1))
);
assert.strictEqual(fps.size, 1, "stripped variants must share one fingerprint");

// Guard: unstripped they genuinely differ — proves the check has teeth.
const raw = new Set(KNOWN.map((v) => getMessageFingerprint(`${ride}\n\n${v}`, null, 1)));
assert.ok(raw.size > 1, "unstripped variants should differ (else test is vacuous)");

// 7. No branding configured → strip only, never append.
assert.strictEqual(applyBranding(`${ride}\n\n${KNOWN[0]}`, [], KNOWN), ride);

console.log(
  `✅ fleet branding: ${configs.length} bots, ${KNOWN.length} registered stamps, all checks passed`
);

// globalConfig watchFile()s blocked-data.json, which holds the event loop open.
// Same reason scripts/*.js end this way.
process.exit(0);
