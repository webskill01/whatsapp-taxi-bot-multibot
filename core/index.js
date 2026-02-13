// =============================================================================
// core/index.js — WhatsApp Bot Core (Bot-1 STABILITY + Bot-2 ROUTING)
// =============================================================================
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
// ROUTING FROM BOT-2:
// ✅ Multi-pipeline matching (one message → multiple pipelines)
// ✅ Wildcard pipeline support (cityScope: ["*"])
// ✅ Pipeline-based forwarding
//
// HTTP QR ENDPOINT:
// ✅ /qr - PNG image for remote scanning
// ✅ /qr/base64 - Base64 data URL
// ✅ Auto-refresh every 20s (QR expiry handling)
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

  // QR Code state for HTTP endpoint
  let latestQR = null;
  let qrTimestamp = null;

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
    rejectedNotMonitored: 0,
    sendSuccesses: 0,
    sendFailures: 0,
    reconnectCount: 0,
    pipelineMatches: 0,
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
  const FINGERPRINT_FILE = path.join(
    config.botDir || process.cwd(),
    GLOBAL_CONFIG.deduplication.fingerprintFile
  );

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
        `📂 Saved ${Math.min(data.length, GLOBAL_CONFIG.deduplication.fingerprintSaveCap)} fingerprints`
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
  // MESSAGE HANDLER (Bot-1 pattern + Bot-2 router)
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

    // ── B1: Reconnect age gate ──
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

    // ── B2: Replay ID check ──
    if (replayIdSet.has(msgId)) {
      stats.replayIdsSkipped++;
      return;
    }
    trackReplayId(msgId);

    // ── Extract text ──
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
    // 🔒 FINGERPRINT MUTEX (add NOW before any async work)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const timeBucket = Math.floor(messageTimestampMs / (5 * 60 * 1000));
    const fingerprint = getMessageFingerprint(text, null, timeBucket);

    if (fingerprintSet.has(fingerprint)) {
      stats.duplicatesSkipped++;
      return;
    }

    fingerprintSet.add(fingerprint);
    markDirty();

    // ── C1: Cleanup if over cap ──
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

    // ── A4: Settling delay ──
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

    // ── Process message (Bot-2 router) ──
    stats.totalProcessed++;
    
    log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    log.info(`📥 INCOMING MESSAGE #${stats.totalProcessed}`);
    log.info(`   From: ${sourceGroup.substring(0, 20)}...`);
    log.info(`   Text: "${text.substring(0, 60)}${text.length > 60 ? "..." : ""}"`);
    log.info(`   Fingerprint: ${fingerprint}`);

    await processMessage(sock, msg, config, stats, log);
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
      log.warn(`⚠️  Socket teardown error: ${err.message}`);
    }

    sock = null;
    log.info("✅ Socket destroyed");
  }

  // ===========================================================================
  // RECONNECT LOGIC (Bot-1 pattern)
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
  // BAILEYS CONNECTION (Bot-1 pattern)
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
      // CONNECTION.UPDATE (Bot-1 pattern + QR storage)
      // =======================================================================

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          log.info("📱 QR Code generated - scan with WhatsApp");
          
          // Store QR for HTTP endpoint
          latestQR = qr;
          qrTimestamp = Date.now();
          
          // Print to terminal (existing behavior)
          const qrcodeTerminal = (await import("qrcode-terminal")).default;
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === "open") {
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          log.info("✅ CONNECTION ESTABLISHED");
          log.info(`📱 Connected as: ${sock.user?.id || "unknown"}`);
          log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

          // Clear QR on successful connection
          latestQR = null;
          qrTimestamp = null;

          reconnectAttempts = 0;
          lastReconnectTime = Date.now();
          needsSettlingDelay = true;

          if (!botFullyOperational) {
            botFullyOperational = true;
            log.info("🎉 BOT FULLY OPERATIONAL");
            log.info(`   📍 Source groups:  ${config.sourceGroupIds.length}`);
            log.info(`   🎯 Pipelines:      ${config.pipelines.length}`);
            config.pipelines.forEach((p) => {
              log.info(
                `      • ${p.name}: ${p.cityScope.join(", ")} → ${p.targetGroups.length} groups`
              );
            });
            log.info(`   🛡️  Anti-ban: 10-layer protection active`);
            log.info(`   🎲 Shuffling: A3 randomization enabled`);
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

          // Crypto error detection
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
  // STATS SERVER + QR ENDPOINTS (Bot-1 pattern + HTTP QR)
  // ===========================================================================

  function startStatsServer() {
    const statsPort = parseInt(
      process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001",
      10
    );
    const app = express();

    // Serve static files from public directory
    app.use(express.static("public"));

    app.get("/ping", (_, res) => res.send("ALIVE"));

    // Status endpoint (legacy compatibility)
    app.get("/status", (_, res) => {
      res.json({
        connected: botFullyOperational,
        qrAvailable: !!latestQR,
        botName: process.env.BOT_NAME || "unknown",
      });
    });

    // Stats endpoint
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
          replayIdSet: replayIdSet.size,
          dirty: fingerprintDirty,
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

    // QR Code PNG endpoint (for img tag)
    app.get("/qr", async (req, res) => {
      if (!latestQR) {
        res.status(404).send("QR code not available. Bot may already be connected or still starting.");
        return;
      }

      // Check if QR is too old (WhatsApp QR codes expire ~20s)
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

    // QR Code Base64 endpoint (for data URLs)
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
      log.info(`📱 QR scanner: http://0.0.0.0:${statsPort}/qr-scanner.html?port=${statsPort}`);
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

    log.info("📊 Final stats:");
    log.info(`   Processed:   ${stats.totalProcessed}`);
    log.info(`   Duplicates:  ${stats.duplicatesSkipped}`);
    log.info(`   Replays:     ${stats.replayIdsSkipped}`);
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
  log.info("🚀 TAXI BOT STARTING (MULTI-PIPELINE)");
  log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  loadFingerprints();
  startStatsServer();
  await connectToWhatsApp();
}