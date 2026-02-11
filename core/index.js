// =============================================================================
// core/index.js — WhatsApp Bot Core (Bot-2 REFACTORED with Bot-1 stability)
// =============================================================================
// STABILITY FIXES FROM BOT-1 (documents 12-13):
// ✅ Auth state loaded ONCE at startup via closure, never reloaded
// ✅ Single socket lifecycle with proper teardown
// ✅ Exponential backoff: 3s, 6s, 12s, 24s, 48s, cap 60s
// ✅ No concurrent socket creation
// ✅ DisconnectReason.loggedOut exits with process.exit(1)
// ✅ PM2-safe shutdown (SIGINT/SIGTERM/SIGHUP)
// ✅ Crypto error detection for extended backoff
// ✅ B1: Reconnect age gate (30s window, 10s max age)
// ✅ B2: Replay ID dedup (rolling 200 ID set)
// ✅ A4: Settling delay (5-15s after connect)
// ✅ C2: Debounced disk write (30s)
//
// PRESERVED FROM BOT-2:
// ✅ Pipeline-based routing with pickup+drop city matching
// ✅ Human behavior delays
// ✅ Rate limiting
// =============================================================================

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

import express from "express";
import pino from "pino";
import fs from "fs";
import path from "path";

import { getMessageFingerprint } from "./filter.js";
import { processMessage } from "./router.js";
import { GLOBAL_CONFIG } from "./globalConfig.js";

// =============================================================================
// MAIN EXPORT (Bot-1 pattern)
// =============================================================================

export async function startBot(config, log, authDir) {
  // ===========================================================================
  // STATE - All mutable state for this bot instance
  // ===========================================================================

  let sock = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isShuttingDown = false;
  let isConnecting = false;


  // STABILITY FIX: Auth loaded ONCE, stored in closure
  let authState = null;
  let saveCreds = null;

  // Fingerprint deduplication
  const fingerprintSet = new Set();

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
    rejectedByReconnectAgeGate: 0,
    sendSuccesses: 0,
    sendFailures: 0,
    reconnectCount: 0,
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
  const FINGERPRINT_FILE = path.join(config.botDir || process.cwd(), GLOBAL_CONFIG.deduplication.fingerprintFile);

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
        log.info(`📂 Loaded ${loaded} fingerprints (2h TTL)`);
      } else {
        fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify([]), "utf8");
        log.info("📂 Created fingerprint cache file");
      }
    } catch (err) {
      log.warn(`⚠️ Fingerprint load failed: ${err.message}`);
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
        JSON.stringify(data.slice(-GLOBAL_CONFIG.deduplication.fingerprintSaveCap)),
        "utf8"
      );
      fingerprintDirty = false;
      log.info(`📂 Saved ${Math.min(data.length, GLOBAL_CONFIG.deduplication.fingerprintSaveCap)} fingerprints`);
    } catch (err) {
      log.warn(`⚠️ Fingerprint save failed: ${err.message}`);
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
  // MESSAGE HANDLER
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

    // B1: Reconnect age gate
    const timeSinceReconnect = Date.now() - lastReconnectTime;
    if (
      lastReconnectTime > 0 &&
      timeSinceReconnect < GLOBAL_CONFIG.reconnect.strictWindowDuration
    ) {
      const messageAge = Date.now() - messageTimestampMs;
      if (messageAge > GLOBAL_CONFIG.reconnect.strictAgeMs) {
        stats.rejectedByReconnectAgeGate++;
        return;
      }
    }

    // B2: Replay ID check
    if (replayIdSet.has(msgId)) {
      stats.replayIdsSkipped++;
      return;
    }
    trackReplayId(msgId);


    // Extract text
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

    // Bot self-send check
    const participantPhone = (msg.key.participant || "").split("@")[0] || "";
const botPhone = config.botPhone || "";

if (
  participantPhone &&
  normalizePhone(participantPhone) === normalizePhone(botPhone)
) {
  stats.rejectedBotSender++;
  return;
}


    // Min length check
    if (text.length < GLOBAL_CONFIG.validation.minMessageLength) {
      stats.rejectedTooShort++;
      return;
    }

    // Check if source group is monitored
    const isSourceGroup = config.sourceGroupIds.includes(sourceGroup);
    if (!isSourceGroup) {
      return;
    }
    // Fingerprint deduplication
    const timeBucket = Math.floor(messageTimestampMs / (5 * 60 * 1000));
    const fingerprint = getMessageFingerprint(text, null, timeBucket);

    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      return;
    }

    // Add fingerprint NOW
    fingerprintSet.add(fingerprint);
    markDirty();

    // C1: Cleanup if over cap
    if (fingerprintSet.size > GLOBAL_CONFIG.deduplication.maxFingerprintCache) {
      const targetSize = Math.floor(GLOBAL_CONFIG.deduplication.maxFingerprintCache * GLOBAL_CONFIG.deduplication.cleanupTargetRatio);
      const toDelete = fingerprintSet.size - targetSize;
      const iterator = fingerprintSet.values();
      for (let i = 0; i < toDelete; i++) {
        const val = iterator.next().value;
        if (val) fingerprintSet.delete(val);
      }
    }

    // A4: Settling delay
    if (needsSettlingDelay) {
      needsSettlingDelay = false;
      const settleDuration =
        GLOBAL_CONFIG.reconnect.settlingMin +
        Math.floor(Math.random() * (GLOBAL_CONFIG.reconnect.settlingMax - GLOBAL_CONFIG.reconnect.settlingMin));
      log.info(`⏳ Settling delay: ${(settleDuration / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, settleDuration));
    }

    // Process message
    stats.totalProcessed++;
    await processMessage(sock, msg, config);
  }

  // ===========================================================================
  // SOCKET TEARDOWN (Bot-1 pattern)
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
      log.warn(`⚠️ Socket teardown error: ${err.message}`);
    }

    sock = null;
    log.info("✅ Socket destroyed");
  }

  // ===========================================================================
  // RECONNECT LOGIC (Bot-1 pattern)
  // ===========================================================================

  function scheduleReconnect(reason) {
    if (isShuttingDown) {
      log.info("⚠️ Shutdown in progress, skipping reconnect");
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, cap 60s
    const BACKOFF_BASE = 3000;
    const BACKOFF_CAP = 60000;
    const MAX_ATTEMPTS = 10;

    const delay = Math.min(BACKOFF_BASE * Math.pow(2, reconnectAttempts), BACKOFF_CAP);
    reconnectAttempts++;

    if (reconnectAttempts > MAX_ATTEMPTS) {
      log.error("❌ Max reconnect attempts reached");
      process.exit(1);
    }

    log.info(`🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}/${MAX_ATTEMPTS}) [${reason}]`);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await connectToWhatsApp();
    }, delay);
  }

  // ===========================================================================
  // BAILEYS CONNECTION (Bot-1 pattern)
  // ===========================================================================

  async function connectToWhatsApp() {

     if (isConnecting) {
    log.warn("⚠️ connectToWhatsApp already in progress, skipping");
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
        const { state, saveCreds: saveCredsFunc } = await useMultiFileAuthState(authDir);
        authState = state;
        saveCreds = saveCredsFunc;
        log.info("✅ Auth state loaded and locked in closure");
      }

      const { version } = await fetchLatestBaileysVersion();
      log.info(`📦 Baileys version: ${version.join(".")}`);

      const baileysLogger = pino({
        level: "warn",
        hooks: {
          logMethod(inputArgs, method) {
            const msg = inputArgs[0];
            if (
              typeof msg === "string" &&
              (msg.includes("closing session") ||
                msg.includes("decrypt") ||
                msg.includes("bad mac") ||
                msg.includes("failed to decrypt"))
            ) {
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
      // CONNECTION.UPDATE (Bot-1 pattern)
      // =======================================================================

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info("📱 QR Code generated");
        }

        if (connection === "open") {
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info("✅ CONNECTION ESTABLISHED");
          log.info(`📱 Connected as: ${sock.user?.id || "unknown"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          reconnectAttempts = 0;
          lastReconnectTime = Date.now();
          needsSettlingDelay = true;

          if (!botFullyOperational) {
            botFullyOperational = true;
            log.info("🎉 BOT FULLY OPERATIONAL");
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(`   🎯 Pipelines:      ${config.pipelines.length}`);
            config.pipelines.forEach(p => {
              log.info(`      • ${p.name}: ${p.cityScope.join(', ')}`);
            });
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMsg = lastDisconnect?.error?.message || "";

          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info(`⚠️ CONNECTION CLOSED`);
          log.info(`   Status: ${statusCode || "undefined"}`);
          log.info(`   Error: ${errorMsg || "none"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          destroySocket("connection closed");

          if (statusCode === DisconnectReason.loggedOut) {
            log.error("❌ LOGGED OUT - delete baileys_auth/ and restart");
            process.exit(1);
          }

          // Crypto error detection
          if (
            errorMsg.includes("Bad MAC") ||
            errorMsg.includes("prekey") ||
            errorMsg.includes("Decryption error") ||
            statusCode === 440
          ) {
            log.warn("⚠️ Crypto error - applying extended backoff");
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
  // STATS SERVER
  // ===========================================================================

  function startStatsServer() {
    const statsPort = parseInt(process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001", 10);
    const app = express();

    app.get("/ping", (_, res) => res.send("ALIVE"));

    app.get("/stats", (_, res) => {
      res.json({
        bot: {
          name: process.env.BOT_NAME || "unknown",
          phone: config.botPhone || "unknown",
        },
        uptime: ((Date.now() - BOT_START_TIME) / 1000 / 60).toFixed(1) + " minutes",
        operational: botFullyOperational,
        stats,
        cache: {
          fingerprintSet: fingerprintSet.size,
          replayIdSet: replayIdSet.size,
          dirty: fingerprintDirty,
        },
        reconnect: {
          lastReconnectTime: lastReconnectTime ? new Date(lastReconnectTime).toISOString() : null,
          totalReconnects: stats.reconnectCount,
        },
      });
    });

    app.listen(statsPort, "0.0.0.0", () => {
      log.info(`📊 Stats server: http://0.0.0.0:${statsPort}/stats`);
    });
  }

  // ===========================================================================
  // GRACEFUL SHUTDOWN (Bot-1 pattern)
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
  log.info("🚀 TAXI BOT STARTING");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  loadFingerprints();
  startStatsServer();
  await connectToWhatsApp();
}