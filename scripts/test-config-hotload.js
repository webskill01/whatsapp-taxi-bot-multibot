/**
 * Self-check for live config group edits:
 *   node scripts/test-config-hotload.js
 * Exits non-zero if hot-reload or validation breaks.
 */
import assert from "assert";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateGroupFields, watchConfigGroups } from "../core/configLoader.js";

const G = (n) => `12036300000000000${n}@g.us`;
const base = {
  sourceGroupIds: [G(1)],
  pipelines: [
    { name: "delhi-ncr-cluster", cityScope: ["Delhi"], targetGroups: [G(2)] },
    { name: "all-mix", cityScope: ["*"], targetGroups: [G(3)] },
  ],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── validator ──
assert.deepStrictEqual(validateGroupFields(base), []);
assert.ok(validateGroupFields({ ...base, pipelines: [] }).length, "empty pipelines must fail");
assert.ok(validateGroupFields({ ...base, sourceGroupIds: ["nope"] }).length, "bad group id must fail");
const noTargets = clone(base); noTargets.pipelines[0].targetGroups = [];
assert.ok(validateGroupFields(noTargets).length, "pipeline with no targets must fail");

// ── hot reload ──
const dir = mkdtempSync(join(tmpdir(), "cfg-hotload-"));
const file = join(dir, "config.json");
const write = (o) => writeFileSync(file, JSON.stringify(o, null, 2), "utf8");
write(base);

const live = { ...clone(base), botDir: dir };
watchConfigGroups(live, { info: () => {}, warn: () => {} });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // add a source group + a pipeline target → picked up without restart
  const edited = clone(base);
  edited.sourceGroupIds.push(G(4));
  edited.pipelines[1].targetGroups.push(G(5));
  write(edited);
  await settle(2500);
  assert.deepStrictEqual(live.sourceGroupIds, [G(1), G(4)], "source group not hot-loaded");
  assert.deepStrictEqual(live.pipelines[1].targetGroups, [G(3), G(5)], "pipeline target not hot-loaded");

  // a broken edit must be ignored, not applied and not thrown
  writeFileSync(file, "{ not json", "utf8");
  await settle(2500);
  assert.deepStrictEqual(live.sourceGroupIds, [G(1), G(4)], "broken config must keep previous groups");

  // an invalid-but-parsable edit must also be ignored
  write({ ...base, pipelines: [] });
  await settle(2500);
  assert.strictEqual(live.pipelines.length, 2, "invalid config must keep previous pipelines");

  console.log("✅ config hot-load self-check passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
