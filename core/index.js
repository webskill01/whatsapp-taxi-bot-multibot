// =============================================================================
// core/index.js — WhatsApp Bot Core (Bot-2 FIXED)
// =============================================================================
// ✅ CRITICAL FIXES APPLIED:
//    1. Pass pre-extracted text to router (eliminates double-parse bug)
//    2. Move processing delay AFTER validation (saves 2-7s on rejected msgs)
//    3. Remove verbose fingerprint lock log (cleaner output)
//
// STABILITY FROM BOT-1:
// ✅ Auth state loaded ONCE via closure
// ✅ Single socket lifecycle with proper teardown
// ✅ Exponential backoff: 3s, 6s, 12s, 24s, 48s, cap 60s
// ✅ No concurrent socket creation
// ✅ DisconnectReason.loggedOut exits with process.exit(1)
// ✅ PM2-safe shutdown (SIGINT/SIGTERM/SIGHUP)
// ✅ B1: Reconnect age gate (30s window, 10s max age)
// ✅ B2: Replay ID dedup (rolling 200 ID set)
// ✅ A4: Settling delay (5-15s after connect)
// ✅ C2: Debounced disk write (30s)
//
// ROUTING:
// ✅ Multi-pipeline matching (one message → multiple pipelines)
// ✅ Wildcard pipeline support (cityScope: ["*"])
// ✅ Dual city extraction (pickup AND drop both trigger routing)
// =============================================================================

import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import fs from "fs";
import path from "path";

import { getMessageFingerprint } from "./filter.js";
import { processMessage } from "./router.js";
import { GLOBAL_CONFIG } from "./globalConfig.js";
import { initRuntimeState } from "./runtimeState.js";

// =============================================================================
// CONSTANTS
// =============================================================================
const MAX_MESSAGE_AGE = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// MAIN EXPORT
// =============================================================================

export async function startBot(config, log, authDir) {
  // ===========================================================================
  // STATE
  // ===========================================================================

  let sock = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isShuttingDown = false;
  let isConnecting = false;

  // STABILITY FIX: Auth loaded ONCE, stored in closure
  let authState = null;
  let saveCreds = null;

  // QR Code state for HTTP endpoint
  let latestQR = null;
  let qrTimestamp = null;

  // Fingerprint deduplication (PER-BOT)
  const fingerprintSet = new Set();
  
  // Pending fingerprints (optimistic lock)
  const pendingFingerprints = new Map();
  
  // Cleanup stale pending fingerprints (stuck for >60s)
  setInterval(() => {
    const now = Date.now();
    const staleTimeout = 60000;
    
    for (const [fp, timestamp] of pendingFingerprints.entries()) {
      if (now - timestamp > staleTimeout) {
        pendingFingerprints.delete(fp);
        log.warn(`🧹 Removed stale pending fingerprint: ${fp}`);
      }
    }
  }, 30000);

  // B2: Rolling replay ID set
  const replayIdSet = new Set();

  // Stats
  const stats = {
    totalProcessed: 0,
    duplicatesSkipped: 0,
    replayIdsSkipped: 0,
    rejectedNoPhone: 0,
    rejectedNotTaxi: 0,
    rejectedTooShort: 0,
    rejectedEmptyBody: 0,
    rejectedFromMe: 0,
    rejectedBotSender: 0,
    rejectedBlockedNumber: 0,
    rejectedBlockedSender: 0,
    rejectedByReconnectAgeGate: 0,
    rejectedNotMonitored: 0,
    rejectedRateLimit: 0,
    rejectedPaused: 0,
    rejectedTooOld: 0,
    sendSuccesses: 0,
    sendFailures: 0,
    reconnectCount: 0,
    pipelineMatches: 0,
    cryptoErrors: 0,
    racePrevented: 0,
  };

  // B1: Reconnect state tracking
  let lastReconnectTime = 0;
  let botFullyOperational = false;

  // A4: Settling state
  let needsSettlingDelay = true;

  // C2: Debounced disk write
  let fingerprintDirty = false;
  let saveDebounceTimer = null;

  const BOT_START_TIME = Date.now();
  
  // Stable fingerprint filename (botId + phone)
  const BOT_ID = config.botId || path.basename(config.botDir || process.cwd());
  const PHONE = config.botPhone?.replace(/\D/g, "") || "noPhone";

  const NEW_FINGERPRINT_FILENAME = `fingerprints_${BOT_ID}_${PHONE}.json`;
  const OLD_FINGERPRINT_FILENAME = `fingerprints_${PHONE}.json`;

  const NEW_FINGERPRINT_FILE = path.join(
    config.botDir || process.cwd(),
    NEW_FINGERPRINT_FILENAME
  );
  const OLD_FINGERPRINT_FILE = path.join(
    config.botDir || process.cwd(),
    OLD_FINGERPRINT_FILENAME
  );

  // Migrate old fingerprint file to new stable format (backward compatibility)
  if (fs.existsSync(OLD_FINGERPRINT_FILE) && !fs.existsSync(NEW_FINGERPRINT_FILE)) {
    try {
      fs.renameSync(OLD_FINGERPRINT_FILE, NEW_FINGERPRINT_FILE);
      log.info(`📂 Migrated fingerprint file: ${OLD_FINGERPRINT_FILENAME} → ${NEW_FINGERPRINT_FILENAME}`);
    } catch (err) {
      log.warn(`⚠️  Fingerprint migration failed: ${err.message}`);
    }
  }

  const FINGERPRINT_FILE = NEW_FINGERPRINT_FILE;
  const BOT_FINGERPRINT_FILENAME = NEW_FINGERPRINT_FILENAME;

  // ===========================================================================
  // C2: FINGERPRINT DISK PERSISTENCE (debounced)
  // ===========================================================================

  function loadFingerprints() {
    try {
      if (fs.existsSync(FINGERPRINT_FILE)) {
        const data = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf8"));
        const cutoff = Date.now() - GLOBAL_CONFIG.deduplication.fingerprintTTL;

        let loaded = 0;
        for (const item of data) {
          if (item.timestamp > cutoff) {
            fingerprintSet.add(item.fingerprint);
            loaded++;
          }
        }
        log.info(`📂 Loaded ${loaded} fingerprints (2h TTL) from ${BOT_FINGERPRINT_FILENAME}`);
      } else {
        fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify([]), "utf8");
        log.info(`📂 Created per-bot fingerprint file: ${BOT_FINGERPRINT_FILENAME}`);
      }
    } catch (err) {
      log.warn(`⚠️  Fingerprint load failed: ${err.message}`);
    }
  }

  function saveFingerprints() {
    try {
      const data = Array.from(fingerprintSet).map((fp) => ({
        fingerprint: fp,
        timestamp: Date.now(),
      }));
      fs.writeFileSync(
        FINGERPRINT_FILE,
        JSON.stringify(
          data.slice(-GLOBAL_CONFIG.deduplication.fingerprintSaveCap)
        ),
        "utf8"
      );
      fingerprintDirty = false;
      log.info(
        `📂 Saved ${Math.min(data.length, GLOBAL_CONFIG.deduplication.fingerprintSaveCap)} fingerprints to ${BOT_FINGERPRINT_FILENAME}`
      );
    } catch (err) {
      log.warn(`⚠️  Fingerprint save failed: ${err.message}`);
    }
  }

  function markDirty() {
    fingerprintDirty = true;
    if (!saveDebounceTimer) {
      saveDebounceTimer = setTimeout(() => {
        if (fingerprintDirty) {
          saveFingerprints();
        }
        saveDebounceTimer = null;
      }, GLOBAL_CONFIG.deduplication.saveDebounceMs);
    }
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  function normalizePhone(p) {
    return p.replace(/\D/g, "").slice(-10);
  }

  // B2: Track replay ID with FIFO eviction
  function trackReplayId(msgId) {
    replayIdSet.add(msgId);
    if (replayIdSet.size > GLOBAL_CONFIG.deduplication.maxReplayIds) {
      const first = replayIdSet.values().next().value;
      replayIdSet.delete(first);
    }
  }

  // ===========================================================================
  // MESSAGE HANDLER (FIXED: pass text to router, delay moved inside router)
  // ===========================================================================

  async function handleMessage(msg) {
    // Only group messages
    if (!msg.key.remoteJid?.endsWith("@g.us")) return;

    // Skip own messages
    if (msg.key.fromMe === true) {
      stats.rejectedFromMe++;
      return;
    }

    const msgId = msg.key.id;
    const sourceGroup = msg.key.remoteJid;
    const messageTimestamp = msg.messageTimestamp;
    const messageTimestampMs = messageTimestamp * 1000;

    // ── Message age validation (5-minute max) ──
    const messageAge = Date.now() - messageTimestampMs;

    if (messageAge > MAX_MESSAGE_AGE) {
      stats.rejectedTooOld++;
      log.warn(`⏰ Old message dropped: ${Math.floor(messageAge / 1000)}s old (max ${MAX_MESSAGE_AGE / 1000}s)`);
      return;
    }

    // ── B1: Reconnect age gate ──
    const timeSinceReconnect = Date.now() - lastReconnectTime;
    if (
      lastReconnectTime > 0 &&
      timeSinceReconnect < GLOBAL_CONFIG.reconnect.strictWindowDuration
    ) {
      const reconnectMessageAge = Date.now() - messageTimestampMs;
      if (reconnectMessageAge > GLOBAL_CONFIG.reconnect.strictAgeMs) {
        stats.rejectedByReconnectAgeGate++;
        log.warn(`⏰ [B1] Age gate dropped msg: ${Math.floor(reconnectMessageAge / 1000)}s old (${Math.floor(timeSinceReconnect / 1000)}s since reconnect)`);
        return;
      }
    }

    // ── B2: Replay ID check ──
    if (replayIdSet.has(msgId)) {
      stats.replayIdsSkipped++;
      return;
    }
    trackReplayId(msgId);

    // ── Extract text (done in index.js, not router) ──
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    if (!text || text.trim() === "") {
      stats.rejectedEmptyBody++;
      return;
    }

    // ── Bot self-send check (phone-level) ──
    const participantPhone = (msg.key.participant || "").split("@")[0] || "";
    const botPhone = config.botPhone || "";

    if (
      participantPhone &&
      botPhone &&
      normalizePhone(participantPhone) === normalizePhone(botPhone)
    ) {
      stats.rejectedBotSender++;
      return;
    }

    // ── Blocked sender check (before any text processing) ──
    if (participantPhone && config.blockedSenders && config.blockedSenders.length > 0) {
      const normalizedSender = normalizePhone(participantPhone);
      if (config.blockedSenders.some(blocked => normalizePhone(blocked) === normalizedSender)) {
        stats.rejectedBlockedSender = (stats.rejectedBlockedSender || 0) + 1;
        log.warn(`🚫 BLOCKED SENDER: ${participantPhone}`);
        return;
      }
    }

    // ── Min length check ──
    if (text.length < GLOBAL_CONFIG.validation.minMessageLength) {
      stats.rejectedTooShort++;
      return;
    }

    // ── Source group monitoring check ──
    const isSourceGroup = config.sourceGroupIds.includes(sourceGroup);
    if (!isSourceGroup) {
      stats.rejectedNotMonitored++;
      return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FINGERPRINT DEDUP + OPTIMISTIC LOCK
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const timeBucket = Math.floor(messageTimestampMs / (5 * 60 * 1000));
    const fingerprint = getMessageFingerprint(text, null, timeBucket);

    // Check if fingerprint is permanently saved (already processed)
    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      log.info(`🔁 Duplicate (saved) — skipped: ${fingerprint}`);
      return;
    }

    // Check if fingerprint is currently being processed (race prevention)
    if (pendingFingerprints.has(fingerprint)) {
      stats.duplicatesSkipped++;
      stats.racePrevented++;
      log.warn(`⚡ Race condition prevented! Message already in routing: ${fingerprint}`);
      return;
    }

    // OPTIMISTIC LOCK: Add to pending set IMMEDIATELY
    pendingFingerprints.set(fingerprint, Date.now());

    // ── A4: Settling delay (only on first message) ──
    if (needsSettlingDelay) {
      needsSettlingDelay = false;
      const settleDuration =
        GLOBAL_CONFIG.reconnect.settlingMin +
        Math.floor(
          Math.random() *
            (GLOBAL_CONFIG.reconnect.settlingMax -
              GLOBAL_CONFIG.reconnect.settlingMin)
        );
      log.info(
        `⏳ Settling delay: ${(settleDuration / 1000).toFixed(1)}s (first message after connect)`
      );
      await new Promise((r) => setTimeout(r, settleDuration));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIX: Log BEFORE validation (no processing delay wasted on rejected msgs)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    stats.totalProcessed++;
    
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📥 INCOMING MESSAGE #${stats.totalProcessed}`);
    log.info(`   From: ${sourceGroup.substring(0, 20)}...`);
    log.info(`   Text: "${text.substring(0, 60)}${text.length > 60 ? "..." : ""}"`);
    log.info(`   Fingerprint: ${fingerprint}`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // FIX: Pass pre-extracted text + sourceGroup to router
    // Processing delay happens INSIDE router AFTER validation passes
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    let routingResult = null;
    
    try {
      routingResult = await processMessage(sock, text, sourceGroup, config, stats, log);
    } catch (err) {
      log.error(`❌ Routing error: ${err.message}`);
      routingResult = { wasRouted: false };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // DECISION POINT: Save permanently OR discard pending
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (routingResult && routingResult.wasRouted) {
      // SUCCESS: Message was routed and sent
      pendingFingerprints.delete(fingerprint);
      fingerprintSet.add(fingerprint);
      markDirty();

      log.info(`✅ Fingerprint saved permanently: ${fingerprint}`);

      // C1: Cleanup if over cap
      if (fingerprintSet.size > GLOBAL_CONFIG.deduplication.maxFingerprintCache) {
        const targetSize = Math.floor(
          GLOBAL_CONFIG.deduplication.maxFingerprintCache *
            GLOBAL_CONFIG.deduplication.cleanupTargetRatio
        );
        const toDelete = fingerprintSet.size - targetSize;
        const iterator = fingerprintSet.values();
        for (let i = 0; i < toDelete; i++) {
          const val = iterator.next().value;
          if (val) fingerprintSet.delete(val);
        }
        log.info(
          `🧹 Fingerprint cleanup: deleted ${toDelete}, remaining ${fingerprintSet.size}`
        );
      }
    } else {
      // FAILURE: Message rejected by validation/routing
      pendingFingerprints.delete(fingerprint);
      log.info(`🔓 Fingerprint unlocked (rejected): ${fingerprint}`);
    }
  }

  // ===========================================================================
  // SOCKET TEARDOWN
  // ===========================================================================

  function destroySocket(reason) {
    if (!sock) return;

    log.info(`🔌 Destroying socket: ${reason}`);

    try {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.ev.removeAllListeners("messages.upsert");
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch (err) {
      log.warn(`⚠️  Socket teardown error: ${err.message}`);
    }

    sock = null;
    log.info("✅ Socket destroyed");
  }

  // ===========================================================================
  // RECONNECT LOGIC
  // ===========================================================================

  function scheduleReconnect(reason) {
    if (isShuttingDown) {
      log.info("⚠️  Shutdown in progress, skipping reconnect");
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const BACKOFF_BASE = 3000;
    const BACKOFF_CAP = 60000;
    const MAX_ATTEMPTS = 10;

    const delay = Math.min(
      BACKOFF_BASE * Math.pow(2, reconnectAttempts),
      BACKOFF_CAP
    );
    reconnectAttempts++;

    if (reconnectAttempts > MAX_ATTEMPTS) {
      log.error("❌ Max reconnect attempts reached");
      process.exit(1);
    }

    log.info(
      `🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${MAX_ATTEMPTS}) [${reason}]`
    );

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await connectToWhatsApp();
    }, delay);
  }

  // ===========================================================================
  // BAILEYS CONNECTION
  // ===========================================================================

  async function connectToWhatsApp() {
    if (isConnecting) {
      log.warn("⚠️  connectToWhatsApp already in progress, skipping");
      return;
    }
    isConnecting = true;

    if (sock) {
      destroySocket("reconnect - destroying old socket");
    }

    try {
      // STABILITY FIX: Load auth ONCE
      if (!authState) {
        log.info("🔐 Loading auth state (ONCE per process)...");
        const { state, saveCreds: saveCredsFunc } =
          await useMultiFileAuthState(authDir);
        authState = state;
        saveCreds = saveCredsFunc;
        log.info("✅ Auth state loaded and locked in closure");
      }

      const { version } = await fetchLatestBaileysVersion();
      log.info(`📦 Baileys version: ${version.join(".")}`);

      // Suppress crypto errors (they're normal - devices joining/leaving groups)
      const baileysLogger = pino({
        level: "warn",
        hooks: {
          logMethod(inputArgs, method) {
            // Baileys logs with two patterns:
            //   logger.warn("string message")           → inputArgs[0] is a string
            //   logger.error({key, err}, "message")     → inputArgs[0] is an object, [1] is the string
            // Build a single lowercase string covering both so matching is always case-insensitive.
            const msgStr = (
              (typeof inputArgs[0] === "string" ? inputArgs[0] : "") +
              " " +
              (typeof inputArgs[1] === "string" ? inputArgs[1] : "")
            ).toLowerCase();

            if (
              msgStr.includes("closing session") ||
              msgStr.includes("closing open session") ||
              msgStr.includes("prekey bundle") ||
              msgStr.includes("decrypt") ||
              msgStr.includes("bad mac") ||
              msgStr.includes("no session found") ||
              msgStr.includes("invalidmessageexception")
            ) {
              stats.cryptoErrors++;
              return;
            }
            method.apply(this, inputArgs);
          },
        },
      });

      sock = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
        },
        logger: baileysLogger,
        printQRInTerminal: true,
        browser: ["Taxi Bot", "Chrome", "120.0"],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => undefined,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      log.info("✅ Socket created");

      // =======================================================================
      // CREDS.UPDATE
      // =======================================================================

      sock.ev.on("creds.update", async () => {
        if (saveCreds) {
          await saveCreds();
        }
      });

      // =======================================================================
      // CONNECTION.UPDATE
      // =======================================================================

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info("📱 QR Code generated - scan with WhatsApp");
          
          latestQR = qr;
          qrTimestamp = Date.now();
          
          const qrcodeTerminal = (await import("qrcode-terminal")).default;
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === "open") {
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info("✅ CONNECTION ESTABLISHED");
          log.info(`📱 Connected as: ${sock.user?.id || "unknown"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          latestQR = null;
          qrTimestamp = null;

          reconnectAttempts = 0;
          lastReconnectTime = Date.now();
          needsSettlingDelay = true;

          if (!botFullyOperational) {
            botFullyOperational = true;
            log.info("🎉 BOT FULLY OPERATIONAL (DUAL CITY ROUTING)");
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(`   🎯 Pipelines:      ${config.pipelines.length}`);
            config.pipelines.forEach((p) => {
              log.info(
                `      • ${p.name}: ${p.cityScope.join(", ")} → ${p.targetGroups.length} groups`
              );
            });
            log.info(`   🛡️  Anti-ban: 10-layer protection active`);
            log.info(`   🎲 Shuffling: A3 randomization enabled`);
            log.info(`   ⚡ Race prevention: Optimistic locking enabled`);
            log.info(`   ⏰ Max msg age:   ${MAX_MESSAGE_AGE / 1000}s`);
            log.info(`   📂 Fingerprint file: ${BOT_FINGERPRINT_FILENAME}`);
            log.info(`   🔀 Dual city routing: pickup AND drop both trigger pipelines`);
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || "";

          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info(`⚠️  CONNECTION CLOSED`);
          log.info(`   Status: ${statusCode || "undefined"}`);
          log.info(`   Error: ${errorMsg || "none"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          destroySocket("connection closed");

          if (statusCode === DisconnectReason.loggedOut) {
            log.error("❌ LOGGED OUT - delete baileys_auth/ and restart");
            process.exit(1);
          }

          if (
            errorMsg.includes("Bad MAC") ||
            errorMsg.includes("prekey") ||
            errorMsg.includes("Decryption error") ||
            statusCode === 440
          ) {
            log.warn("⚠️  Crypto error - applying extended backoff");
            reconnectAttempts = Math.max(reconnectAttempts, 2);
          }

          stats.reconnectCount++;
          scheduleReconnect(`statusCode=${statusCode}`);
        }
      });

      // =======================================================================
      // MESSAGES.UPSERT
      // =======================================================================

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
          try {
            await handleMessage(msg);
          } catch (err) {
            log.error(`❌ Error handling message: ${err.message}`);
          }
        }
      });
    } catch (err) {
      log.error(`❌ Connection error: ${err.message}`);
      scheduleReconnect("connection error");
    } finally {
      isConnecting = false;
    }
  }

  // ===========================================================================
  // STATS SERVER + ENDPOINTS (keeping existing endpoints)
  // ===========================================================================

  function startStatsServer() {
    const statsPort = parseInt(
      process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001",
      10
    );
    const app = express();

    // CORS: the dashboard (index.html) is served by ONE bot's port but fetches
    // /stats from EVERY bot port. Those are cross-origin requests; without these
    // headers the browser blocks the responses and every other bot card shows
    // "Offline" with no details. Allow any origin to read the read-only endpoints.
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });

    app.use(express.static("public"));

    app.get("/ping", (_, res) => res.send("ALIVE"));

    app.get("/health", (_, res) => {
      const healthy =
        botFullyOperational &&
        sock?.user;

      const failureRate =
        stats.sendSuccesses + stats.sendFailures > 0
          ? stats.sendFailures / (stats.sendSuccesses + stats.sendFailures)
          : 0;

      res.status(healthy ? 200 : 503).json({
        status: healthy ? "healthy" : "degraded",
        uptime: Date.now() - BOT_START_TIME,
        connected: botFullyOperational,
        reconnects: stats.reconnectCount,
        failures: stats.sendFailures,
        successes: stats.sendSuccesses,
        failureRate: failureRate.toFixed(3),
        lastReconnect: lastReconnectTime
          ? new Date(lastReconnectTime).toISOString()
          : null,
      });
    });

    app.get("/status", (_, res) => {
      res.json({
        connected: botFullyOperational,
        qrAvailable: !!latestQR,
        botName: process.env.BOT_NAME || "unknown",
      });
    });

    app.get("/stats", (_, res) => {
      res.json({
        bot: {
          name: process.env.BOT_NAME || "unknown",
          phone: config.botPhone || "unknown",
        },
        uptime:
          ((Date.now() - BOT_START_TIME) / 1000 / 60).toFixed(1) + " minutes",
        operational: botFullyOperational,
        qrAvailable: !!latestQR,
        stats,
        cache: {
          fingerprintSet: fingerprintSet.size,
          pendingFingerprints: pendingFingerprints.size,
          replayIdSet: replayIdSet.size,
          dirty: fingerprintDirty,
          fingerprintFile: BOT_FINGERPRINT_FILENAME,
        },
        reconnect: {
          lastReconnectTime: lastReconnectTime
            ? new Date(lastReconnectTime).toISOString()
            : null,
          totalReconnects: stats.reconnectCount,
        },
        config: {
          sourceGroups: config.sourceGroupIds.length,
          pipelines: config.pipelines.length,
        },
      });
    });

    // Existing /groups endpoint preserved
    app.get("/groups", async (req, res) => {
      if (!sock || !botFullyOperational) {
        return res.status(503).json({ 
          error: "Bot not connected to WhatsApp",
          operational: botFullyOperational 
        });
      }

      try {
        const groupChats = await sock.groupFetchAllParticipating();
        const allGroups = Object.values(groupChats).map((chat) => ({
          id: chat.id,
          name: chat.subject || "Unknown Group",
          participantsCount: chat.participants?.length || 0,
          createdAt: chat.creation ? new Date(chat.creation * 1000).toISOString() : null,
        }));

        const sourceSet = new Set(config.sourceGroupIds);
        const targetSet = new Set();
        
        config.pipelines.forEach(pipeline => {
          pipeline.targetGroups.forEach(groupId => {
            targetSet.add(groupId);
          });
        });

        const categorized = allGroups.map((group) => {
          let category = "Unmonitored";
          let type = "other";
          let pipelineInfo = null;

          if (sourceSet.has(group.id)) {
            category = "Source Group";
            type = "source";
          } else if (targetSet.has(group.id)) {
            const pipelines = config.pipelines.filter(p => 
              p.targetGroups.includes(group.id)
            );
            
            if (pipelines.length > 0) {
              category = "Target Group";
              type = "target";
              pipelineInfo = pipelines.map(p => ({
                name: p.name,
                cityScope: p.cityScope,
              }));
            }
          }

          return {
            ...group,
            category,
            type,
            pipelineInfo,
          };
        });

        const sortOrder = {
          source: 1,
          target: 2,
          other: 3,
        };

        categorized.sort((a, b) => {
          const orderA = sortOrder[a.type] || 99;
          const orderB = sortOrder[b.type] || 99;
          if (orderA !== orderB) return orderA - orderB;
          return (a.name || "").localeCompare(b.name || "");
        });

        res.json({
          success: true,
          bot: {
            name: process.env.BOT_NAME || "unknown",
            phone: sock.user?.id || "unknown",
          },
          totalGroups: categorized.length,
          breakdown: {
            source: categorized.filter((g) => g.type === "source").length,
            target: categorized.filter((g) => g.type === "target").length,
            unmonitored: categorized.filter((g) => g.type === "other").length,
          },
          pipelines: config.pipelines.map(p => ({
            name: p.name,
            cityScope: p.cityScope,
            targetCount: p.targetGroups.length,
          })),
          groups: categorized,
        });

      } catch (err) {
        log.error(`❌ /groups error: ${err.message}`);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    // QR Code endpoints
    app.get("/qr", async (req, res) => {
      if (!latestQR) {
        res.status(404).send("QR code not available. Bot may already be connected or still starting.");
        return;
      }

      const qrAge = Date.now() - (qrTimestamp || 0);
      if (qrAge > 20000) {
        res.status(410).send("QR code expired. Please wait for a new one (auto-refreshes every ~20s).");
        return;
      }

      try {
        const qrImage = await QRCode.toBuffer(latestQR, {
          type: "png",
          width: 400,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });
        res.type("png").send(qrImage);
      } catch (err) {
        log.error(`❌ QR generation failed: ${err.message}`);
        res.status(500).send("Failed to generate QR code");
      }
    });

    app.get("/qr/base64", async (req, res) => {
      if (!latestQR) {
        res.status(404).json({ 
          error: "QR code not available",
          qrAvailable: false,
        });
        return;
      }

      const qrAge = Date.now() - (qrTimestamp || 0);
      if (qrAge > 20000) {
        res.status(410).json({ 
          error: "QR code expired",
          qrAvailable: false,
          message: "Please wait for a new QR code",
        });
        return;
      }

      try {
        const qrDataURL = await QRCode.toDataURL(latestQR, {
          width: 400,
          margin: 2,
        });
        res.json({ 
          qr: qrDataURL,
          qrAvailable: true,
          timestamp: qrTimestamp,
          age: qrAge,
        });
      } catch (err) {
        log.error(`❌ QR generation failed: ${err.message}`);
        res.status(500).json({ error: "Failed to generate QR code" });
      }
    });

    app.listen(statsPort, "0.0.0.0", () => {
      log.info(`📊 Stats server: http://0.0.0.0:${statsPort}/stats`);
      log.info(`💚 Health check: http://0.0.0.0:${statsPort}/health`);
      log.info(`📱 QR scanner: http://0.0.0.0:${statsPort}/qr-scanner.html?port=${statsPort}`);
      log.info(`👥 Groups API: http://0.0.0.0:${statsPort}/groups`);
    });
  }

  // ===========================================================================
  // GRACEFUL SHUTDOWN
  // ===========================================================================

  async function gracefulShutdown(signal) {
    log.info(`👋 ${signal} received - shutting down gracefully`);
    isShuttingDown = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }

    saveFingerprints();
    destroySocket("shutdown");

    log.info("📊 Final stats:");
    log.info(`   Processed:   ${stats.totalProcessed}`);
    log.info(`   Duplicates:  ${stats.duplicatesSkipped}`);
    log.info(`   Too old:     ${stats.rejectedTooOld}`);
    log.info(`   Replays:     ${stats.replayIdsSkipped}`);
    log.info(`   Races:       ${stats.racePrevented} (prevented)`);
    log.info(`   Crypto Errs: ${stats.cryptoErrors} (normal)`);
    log.info(`   Reconnects:  ${stats.reconnectCount}`);
    log.info(`   Sends OK:    ${stats.sendSuccesses}`);
    log.info(`   Sends FAIL:  ${stats.sendFailures}`);

    log.info("✅ Graceful shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));

  // ===========================================================================
  // BOOT SEQUENCE
  // ===========================================================================

  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log.info("🚀 TAXI BOT STARTING (DUAL CITY ROUTING FIXED)");
  log.info("   ✅ Message age validation (5min max)");
  log.info("   ✅ Stable fingerprint filename");
  log.info("   ✅ Processing delay AFTER validation (optimized)");
  log.info("   ✅ Dual city extraction: pickup AND drop");
  log.info("   ✅ /health endpoint added");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Live control flags (pause / disabled target groups). Attached to config so
  // router.js can read them; mutated in place by the runtime.json watcher.
  config.runtime = initRuntimeState(config.botDir || process.cwd(), log);

  loadFingerprints();
  startStatsServer();
  await connectToWhatsApp();
}