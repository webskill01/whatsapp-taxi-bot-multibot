/**
 * ============================================================================
 * control-panel/server.js — admin + scoped-friend control dashboard
 * ============================================================================
 * A SEPARATE PM2 process (not inside any bot) that owns all control ACTIONS:
 *   • PM2 restart / reset-auth for each bot
 *   • Pause / resume forwarding + disable a target group (writes runtime.json)
 *   • Dedup-safe blocked-number / ignore-phrase submission (hot-reloaded by bots)
 *   • Read-only Groups / Stats views (proxied from each bot's own stats port)
 *
 * ACCESS (per the agreed model):
 *   • ADMIN token  → every bot + destructive ops (remove from block list, etc.)
 *   • Per-bot FRIEND token → ONLY their bot: restart, reset+QR, pause/resume,
 *     disable target, and (append-only) submit block numbers.
 * Tokens live in control-panel/tokens.json (gitignored, auto-generated on first
 * run). Put this whole panel behind your cf-tunnel with access auth.
 * ============================================================================
 */

import express from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  dirname, join, resolve, basename,
} from "path";
import {
  existsSync, readFileSync, writeFileSync, rmSync, readdirSync, appendFileSync,
} from "fs";
import { randomBytes } from "crypto";

import {
  readData, writeData, addNumbersToField, addIgnorePhrase, checkNumber,
} from "../core/blockData.js";
import { validateGroupFields } from "../core/configLoader.js";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const PORT = parseInt(process.env.CONTROL_PORT || "3000", 10);
const TOKENS_PATH = join(__dirname, "tokens.json");
const AUDIT_PATH = join(__dirname, "audit.log");

// ============================================================================
// BOT DISCOVERY — read the PM2 manifest so the panel always matches reality
// ============================================================================
function discoverBots() {
  const ecosystem = require("../ecosystem.config.cjs");
  return ecosystem.apps
    .filter((a) => typeof a.script === "string" && a.script.includes("bots/"))
    .map((a) => ({
      id: a.name,                                   // pm2 process name
      dir: resolve(ROOT, dirname(a.script)),        // bots/bot-x absolute dir
      statsPort: parseInt(a.env?.STATS_PORT || "0", 10),
    }));
}
const BOTS = discoverBots();
const BOT_IDS = new Set(BOTS.map((b) => b.id));
const botById = (id) => BOTS.find((b) => b.id === id);

// ============================================================================
// TOKENS — load or generate. Admin token + one token per bot.
// ============================================================================
function loadOrCreateTokens() {
  if (existsSync(TOKENS_PATH)) {
    return JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
  }
  const tokens = {
    admin: randomBytes(24).toString("hex"),
    bots: {},
  };
  for (const b of BOTS) tokens.bots[b.id] = randomBytes(16).toString("hex");
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2) + "\n", "utf8");
  return tokens;
}
const TOKENS = loadOrCreateTokens();
// Reverse lookup: token -> { role:'admin' } | { role:'friend', botId }
const tokenMap = new Map();
tokenMap.set(TOKENS.admin, { role: "admin" });
for (const [botId, tok] of Object.entries(TOKENS.bots || {})) {
  if (BOT_IDS.has(botId)) tokenMap.set(tok, { role: "friend", botId });
}

function audit(who, action, detail = "") {
  const line = `${new Date().toISOString()} | ${who} | ${action} | ${detail}\n`;
  try { appendFileSync(AUDIT_PATH, line); } catch { /* non-fatal */ }
}

// ============================================================================
// EXPRESS
// ============================================================================
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Resolve token (query ?token= or x-token header) into req.auth.
app.use((req, res, next) => {
  const token = req.query.token || req.headers["x-token"] || "";
  req.auth = tokenMap.get(String(token)) || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: "Invalid or missing token" });
  next();
}
function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}
// Ensure the caller may act on :id (admin = any, friend = only their bot).
function scopeToBot(req, res, next) {
  const id = req.params.id;
  if (!BOT_IDS.has(id)) return res.status(404).json({ error: "Unknown bot" });
  if (req.auth.role === "admin" || req.auth.botId === id) return next();
  return res.status(403).json({ error: "Not your bot" });
}
const who = (req) => (req.auth.role === "admin" ? "admin" : `friend:${req.auth.botId}`);

// ── PM2 helpers (bot id is validated against BOT_IDS, so safe to interpolate) ──
async function pm2(action, id) {
  await execAsync(`pm2 ${action} ${id}`, { cwd: ROOT });
}
// Stop and CONFIRM via pm2 jlist. On Windows `pm2 stop` often exits non-zero
// (writes "^C" to stderr from the interrupt it sends) even when the stop
// succeeds, so we ignore its exit code and poll the real status instead. This
// is what made Reset flaky — it aborted on that bogus error before wiping auth.
async function pm2StopAndWait(id, timeoutMs = 10000) {
  try { await pm2("stop", id); } catch { /* exit code unreliable on Windows — verify below */ }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const map = await pm2StatusMap();
    if (!map[id] || map[id].status === "stopped") return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function pm2StatusMap() {
  try {
    const { stdout } = await execAsync("pm2 jlist", { cwd: ROOT });
    const list = JSON.parse(stdout);
    const map = {};
    for (const p of list) {
      map[p.name] = {
        status: p.pm2_env?.status || "unknown",
        uptime: p.pm2_env?.pm_uptime || null,
        restarts: p.pm2_env?.restart_time ?? null,
        cpu: p.monit?.cpu ?? null,
        memory: p.monit?.memory ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}
function readRuntime(dir) {
  const f = join(dir, "runtime.json");
  try {
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  } catch { /* ignore */ }
  return { paused: false, disabledTargets: [] };
}
function writeRuntime(dir, state) {
  writeFileSync(join(dir, "runtime.json"), JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ============================================================================
// ROUTES — status
// ============================================================================
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ role: req.auth.role, botId: req.auth.botId || null });
});

app.get("/api/bots", requireAuth, async (req, res) => {
  const status = await pm2StatusMap();
  const visible = req.auth.role === "admin"
    ? BOTS
    : BOTS.filter((b) => b.id === req.auth.botId);
  res.json({
    role: req.auth.role,
    bots: visible.map((b) => ({
      id: b.id,
      statsPort: b.statsPort,
      pm2: status[b.id] || { status: "unknown" },
      runtime: readRuntime(b.dir),
    })),
  });
});

// ============================================================================
// ROUTES — per-bot control (scoped)
// ============================================================================
app.post("/api/bot/:id/restart", requireAuth, scopeToBot, async (req, res) => {
  try {
    await pm2("restart", req.params.id);
    audit(who(req), "restart", req.params.id);
    res.json({ ok: true, message: `${req.params.id} restarting` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop the bot process (stays in the PM2 list, just not running). Use Restart
// to bring it back online — `pm2 restart` starts a stopped process.
app.post("/api/bot/:id/stop", requireAuth, scopeToBot, async (req, res) => {
  try {
    const stopped = await pm2StopAndWait(req.params.id);
    audit(who(req), "stop", req.params.id);
    res.json({
      ok: true,
      message: stopped ? `${req.params.id} stopped` : `${req.params.id} stop requested (still shutting down)`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset auth — the safe corruption-recovery sequence a friend should follow:
//   1. stop <bot> + CONFIRM stopped (so files aren't held open / half-read)
//   2. delete baileys_auth/    (the corrupted WhatsApp session)
//   3. delete fingerprints_*.json + .forwarded-messages.json (dedup cache)
//   4. pm2 start <bot>         (fresh boot → emits a new QR to scan)
// We deliberately STOP-then-clear-then-START rather than wiping a live process,
// so the bot never reads a half-deleted auth dir. runtime.json (pause/disabled
// prefs) is kept — a reset is about WhatsApp auth only, not the friend's settings.
app.post("/api/bot/:id/reset", requireAuth, scopeToBot, async (req, res) => {
  const bot = botById(req.params.id);
  try {
    const stopped = await pm2StopAndWait(bot.id);
    if (!stopped) throw new Error("Bot did not stop in time — try Reset again");
    await new Promise((r) => setTimeout(r, 800)); // brief grace for handle release

    // rmSync can transiently fail (Windows file locks); retry until the dir is gone.
    const authDir = join(bot.dir, "baileys_auth");
    for (let i = 0; existsSync(authDir) && i < 6; i++) {
      try { rmSync(authDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (existsSync(authDir)) throw new Error("Could not delete baileys_auth (file locked) — try Reset again");

    for (const f of readdirSync(bot.dir)) {
      if (f.startsWith("fingerprints_") || f === ".forwarded-messages.json") {
        try { rmSync(join(bot.dir, f), { force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* non-fatal */ }
      }
    }

    await pm2("start", bot.id);
    audit(who(req), "reset-auth", bot.id);
    res.json({ ok: true, message: `${bot.id} auth wiped — scan the new QR to re-pair` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bot/:id/pause", requireAuth, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const paused = req.body?.paused === true;
  const state = readRuntime(bot.dir);
  state.paused = paused;
  writeRuntime(bot.dir, state);
  audit(who(req), paused ? "pause" : "resume", bot.id);
  res.json({ ok: true, paused });
});

// Disable/enable a single target group (e.g. a friend's trial group)
app.post("/api/bot/:id/target", requireAuth, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const groupId = String(req.body?.groupId || "");
  const disabled = req.body?.disabled === true;
  if (!groupId.endsWith("@g.us")) {
    return res.status(400).json({ error: "groupId must end with @g.us" });
  }
  const state = readRuntime(bot.dir);
  const set = new Set(state.disabledTargets || []);
  if (disabled) set.add(groupId); else set.delete(groupId);
  state.disabledTargets = [...set];
  writeRuntime(bot.dir, state);
  audit(who(req), disabled ? "disable-target" : "enable-target", `${bot.id} ${groupId}`);
  res.json({ ok: true, disabledTargets: state.disabledTargets });
});

// ── Read-only proxies to the bot's own stats server (QR / groups / stats) ──
async function proxyBot(bot, path, res, asJson = true) {
  try {
    const r = await fetch(`http://127.0.0.1:${bot.statsPort}${path}`);
    if (asJson) {
      res.status(r.status).json(await r.json());
    } else {
      res.status(r.status).send(await r.text());
    }
  } catch (err) {
    res.status(503).json({ error: `Bot ${bot.id} unreachable: ${err.message}` });
  }
}
app.get("/api/bot/:id/qr", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/qr/base64", res));
app.get("/api/bot/:id/groups", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/groups", res));
app.get("/api/bot/:id/stats", requireAuth, scopeToBot, (req, res) =>
  proxyBot(botById(req.params.id), "/stats", res));

// ============================================================================
// ROUTES — live group config (ADMIN only)
// ============================================================================
// Adding a group used to mean: edit config.json → commit → push → pull on the VM
// → pm2 restart. Each bot now watches its own config.json (watchConfigGroups in
// core/configLoader.js), so writing the file here is enough — routing picks the
// change up in ~1.3s with no restart and no QR re-scan.
function readBotConfig(dir)  { return JSON.parse(readFileSync(join(dir, "config.json"), "utf8")); }
function writeBotConfig(dir, cfg) {
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// A group may hold exactly ONE role. Source + target on the same group is a
// forwarding loop, so adds are refused when the group is already configured.
function currentRole(cfg, groupId) {
  if (cfg.sourceGroupIds.includes(groupId)) return "source";
  const pl = cfg.pipelines.find((p) => p.targetGroups.includes(groupId));
  return pl ? `target of ${pl.name}` : null;
}

app.get("/api/bot/:id/config", requireAuth, requireAdmin, scopeToBot, (req, res) => {
  try {
    const cfg = readBotConfig(botById(req.params.id).dir);
    res.json({
      ok: true,
      sourceGroupIds: cfg.sourceGroupIds,
      pipelines: cfg.pipelines.map((p) => ({
        name: p.name, cityScope: p.cityScope, targetGroups: p.targetGroups,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// { action:"add"|"remove", role:"source"|"target", groupId, pipeline? }
app.post("/api/bot/:id/config/group", requireAuth, requireAdmin, scopeToBot, (req, res) => {
  const bot = botById(req.params.id);
  const action   = String(req.body?.action || "");
  const role     = String(req.body?.role || "");
  const groupId  = String(req.body?.groupId || "").trim();
  const pipeName = String(req.body?.pipeline || "").trim();

  if (!["add", "remove"].includes(action)) return res.status(400).json({ error: "action must be add or remove" });
  if (!["source", "target"].includes(role)) return res.status(400).json({ error: "role must be source or target" });
  if (!groupId.endsWith("@g.us")) return res.status(400).json({ error: "groupId must end with @g.us" });

  try {
    const cfg = readBotConfig(bot.dir);
    let message;

    if (action === "add") {
      const held = currentRole(cfg, groupId);
      if (held) return res.status(400).json({ error: `Already configured as ${held} — remove it first` });

      if (role === "source") {
        cfg.sourceGroupIds.push(groupId);
        message = `Added as source (${cfg.sourceGroupIds.length} total)`;
      } else {
        const pl = cfg.pipelines.find((p) => p.name === pipeName);
        if (!pl) return res.status(400).json({ error: `Unknown pipeline "${pipeName}"` });
        pl.targetGroups.push(groupId);
        message = `Added as target of ${pl.name} (${pl.targetGroups.length} in that pipeline)`;
      }
    } else if (role === "source") {
      const n = cfg.sourceGroupIds.length;
      cfg.sourceGroupIds = cfg.sourceGroupIds.filter((g) => g !== groupId);
      if (cfg.sourceGroupIds.length === n) return res.status(404).json({ error: "Not a source group" });
      message = `Removed from sources (${cfg.sourceGroupIds.length} left)`;
    } else {
      // "*" = caller does not care which pipeline (group is only in one).
      const pl = pipeName && pipeName !== "*"
        ? cfg.pipelines.find((p) => p.name === pipeName)
        : cfg.pipelines.find((p) => p.targetGroups.includes(groupId));
      if (!pl || !pl.targetGroups.includes(groupId)) {
        return res.status(404).json({ error: "Not a target of that pipeline" });
      }
      if (pl.targetGroups.length === 1) {
        return res.status(400).json({
          error: `Can't remove the last target of "${pl.name}" — a pipeline needs at least one`,
        });
      }
      pl.targetGroups = pl.targetGroups.filter((g) => g !== groupId);
      message = `Removed from ${pl.name} (${pl.targetGroups.length} left)`;
    }

    // Same validator the bots use, so the panel can never write a config that a
    // running bot would reject (or that would kill it on the next restart).
    const errs = validateGroupFields(cfg);
    if (errs.length) return res.status(400).json({ error: errs.join("; ") });

    writeBotConfig(bot.dir, cfg);
    audit(who(req), `config-${action}-${role}`, `${bot.id} ${groupId}${pipeName ? " " + pipeName : ""}`);
    res.json({ ok: true, message: message + " — live in a couple of seconds" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ROUTES — shared block list (append-only for friends, full control for admin)
// ============================================================================
app.post("/api/block/number", requireAuth, (req, res) => {
  try {
    const data = readData();
    const report = addNumbersToField(data, "blockedPhoneNumbers", req.body?.input || "");
    if (report.added.length) writeData(data);
    audit(who(req), "block-number", report.added.join(",") || "(none)");
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/block/sender", requireAuth, (req, res) => {
  try {
    const data = readData();
    const report = addNumbersToField(data, "blockedSenders", req.body?.input || "");
    if (report.added.length) writeData(data);
    audit(who(req), "block-sender", report.added.join(",") || "(none)");
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/block/ignore", requireAuth, (req, res) => {
  try {
    const data = readData();
    const report = addIgnorePhrase(data, req.body?.phrase || "");
    if (report.added) writeData(data);
    audit(who(req), "block-ignore", report.phrase || "(none)");
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/block/check", requireAuth, (req, res) => {
  try {
    const result = checkNumber(readData(), req.query.number || "");
    if (!result) return res.status(400).json({ error: "Provide exactly one valid number" });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/block/list", requireAuth, (req, res) => {
  try {
    const data = readData();
    const counts = {
      blockedPhoneNumbers: data.blockedPhoneNumbers.length,
      blockedSenders: data.blockedSenders.length,
      ignoreIfContains: data.ignoreIfContains.length,
    };
    // Friends get counts only; admin gets the full lists for management.
    if (req.auth.role !== "admin") return res.json({ counts });
    res.json({ counts, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Remove an entry — ADMIN only (friends are append-only).
app.post("/api/block/remove", requireAuth, requireAdmin, (req, res) => {
  try {
    const field = req.body?.field;
    const value = String(req.body?.value || "");
    if (!["blockedPhoneNumbers", "blockedSenders", "ignoreIfContains"].includes(field)) {
      return res.status(400).json({ error: "Invalid field" });
    }
    const data = readData();
    const before = data[field].length;
    data[field] = data[field].filter((v) => v !== value);
    const removed = before - data[field].length;
    if (removed) writeData(data);
    audit("admin", "block-remove", `${field}:${value}`);
    res.json({ ok: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// BOOT
// ============================================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log("============================================================");
  console.log(`🎛️  Control panel listening on http://0.0.0.0:${PORT}`);
  console.log(`   Managed bots: ${BOTS.map((b) => b.id).join(", ")}`);
  console.log("------------------------------------------------------------");
  console.log(`   ADMIN  : /admin.html?token=${TOKENS.admin}`);
  for (const b of BOTS) {
    console.log(`   ${b.id.padEnd(12)} : /friend.html?token=${TOKENS.bots[b.id]}`);
  }
  console.log("   (tokens saved in control-panel/tokens.json — keep private)");
  console.log("============================================================");
});
