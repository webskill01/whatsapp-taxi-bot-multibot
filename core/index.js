/**
 * ============================================================================
 * WHATSAPP BOT CORE - PRODUCTION FIXED
 * ============================================================================
 * FIXES APPLIED:
 * - Single socket per process with proper teardown
 * - Auth state loaded ONCE at startup (no re-entry)
 * - Backoff-based reconnect with crypto error handling
 * - Session stabilization window before message processing
 * - Signal message bypass in deduplication
 * - Graceful shutdown for PM2 safety
 * - No recursive reconnect
 * ============================================================================
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
  makeInMemoryStore,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import qrcode from "qrcode";
import path from "path";
import http from "http";
import { loadConfig } from "./configLoader.js";
import { processMessage, resetRouterState } from "./router.js";

// ============================================================================
// GLOBAL STATE - PROCESS LIFETIME SCOPE
// ============================================================================

let activeSocket = null; // Only ONE socket reference allowed
let authState = null; // Auth loaded ONCE at startup
let saveCreds = null; // Creds saver loaded ONCE
let socketCreationInProgress = false; // Serialization guard
let sessionStabilized = false; // Signal handshake safety flag
let reconnectAttempts = 0; // Backoff counter
let isShuttingDown = false; // Graceful shutdown flag
let reconnectTimer = null; // Timer reference for cleanup
let stabilizationTimer = null; // Session stabilization timer reference

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 120000; // 2 minutes
const SESSION_STABILIZATION_DELAY = 15000; // 15 seconds after connection open

// ============================================================================
// STARTUP
// ============================================================================

const BOT_DIR = process.argv[2];

if (!BOT_DIR) {
  console.error("❌ Usage: node index.js <bot-directory>");
  process.exit(1);
}

const { config: CONFIG, ENV } = loadConfig(BOT_DIR);

const logger = pino({
  level: process.env.LOG_LEVEL || "silent",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: false,
      translateTime: "SYS:standard",
      ignore: "hostname",
    },
  },
});

// ============================================================================
// MEMORY STORE
// ============================================================================

const store = makeInMemoryStore({ logger });
store?.readFromFile(path.join(ENV.BOT_DIR, "baileys_store.json"));

setInterval(() => {
  if (!isShuttingDown) {
    store?.writeToFile(path.join(ENV.BOT_DIR, "baileys_store.json"));
  }
}, 120000);

// ============================================================================
// MESSAGE CACHE & DEDUPLICATION
// ============================================================================

const msgRetryCounterCache = new NodeCache({ stdTTL: 3600 });
const processedMessages = new Map(); // Map<string, number> for message deduplication with timestamps
const MESSAGE_CACHE_TTL = 300000; // 5 minutes

function cleanMessageCache() {
  const now = Date.now();
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_CACHE_TTL) {
      processedMessages.delete(key);
    }
  }
}

setInterval(cleanMessageCache, 60000);

// ============================================================================
// QR CODE SERVER
// ============================================================================

let latestQR = null;
let qrExpiryTime = null;
const QR_VALIDITY_MS = 45000;

const qrServer = http.createServer((req, res) => {
  if (req.url === "/qr") {
    res.writeHead(200, { "Content-Type": "text/html" });

    if (!latestQR) {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Code - ${ENV.BOT_NAME}</title>
            <meta http-equiv="refresh" content="3">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
              .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
              h1 { color: #25D366; }
              .status { color: #666; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🔄 ${ENV.BOT_NAME}</h1>
              <p class="status">⏳ Waiting for QR code...</p>
              <p style="color: #999; font-size: 12px;">Page refreshes automatically</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    const now = Date.now();
    const isExpired = qrExpiryTime && now > qrExpiryTime;

    if (isExpired) {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>QR Code - ${ENV.BOT_NAME}</title>
            <meta http-equiv="refresh" content="3">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
              .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
              h1 { color: #ff9800; }
              .status { color: #666; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⏰ ${ENV.BOT_NAME}</h1>
              <p class="status">QR code expired. Waiting for new code...</p>
              <p style="color: #999; font-size: 12px;">Page refreshes automatically</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    const timeLeft = qrExpiryTime ? Math.max(0, Math.floor((qrExpiryTime - now) / 1000)) : 45;

    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Code - ${ENV.BOT_NAME}</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
            h1 { color: #25D366; }
            img { max-width: 100%; border: 2px solid #25D366; border-radius: 10px; margin: 20px 0; }
            .timer { font-size: 18px; color: ${timeLeft < 15 ? "#ff5722" : "#666"}; font-weight: bold; }
            .instructions { color: #666; margin: 20px 0; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 ${ENV.BOT_NAME}</h1>
            <img src="${latestQR}" alt="WhatsApp QR Code" />
            <p class="timer">⏱️ Expires in: ${timeLeft}s</p>
            <div class="instructions">
              <p><strong>Scan with WhatsApp:</strong></p>
              <p>1. Open WhatsApp on your phone<br>
              2. Tap Menu (⋮) → Linked Devices<br>
              3. Tap "Link a Device"<br>
              4. Scan this QR code</p>
            </div>
            <p style="color: #999; font-size: 12px;">Page refreshes automatically</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  }
});

qrServer.listen(ENV.QR_SERVER_PORT, () => {
  console.log(`✅ QR Server: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
});

// ============================================================================
// AUTH STATE - LOAD ONCE AT STARTUP
// ============================================================================

async function initializeAuthState() {
  console.log("🔐 Loading auth state (ONCE per process)...");
  const { state, saveCreds: saveCredsFunc } = await useMultiFileAuthState(ENV.AUTH_DIR);
  authState = state;
  saveCreds = saveCredsFunc;
  console.log("✅ Auth state loaded and locked");
}

// ============================================================================
// SOCKET TEARDOWN
// ============================================================================

function destroySocket(reason = "manual") {
  if (!activeSocket) return;

  console.log(`🔌 Destroying socket: ${reason}`);

  try {
    activeSocket.ev.removeAllListeners();
    activeSocket.end(undefined);
  } catch (err) {
    console.error("⚠️ Socket destruction error:", err.message);
  }

  activeSocket = null;
  sessionStabilized = false;
  
  // Clear stabilization timer to prevent timer leak
  if (stabilizationTimer) {
    clearTimeout(stabilizationTimer);
    stabilizationTimer = null;
  }
  
  console.log("✅ Socket destroyed and nullified");
}

// ============================================================================
// RECONNECT LOGIC WITH BACKOFF
// ============================================================================

function scheduleReconnect(reason = "unknown") {
  if (isShuttingDown) {
    console.log("🛑 Shutdown in progress, no reconnect");
    return;
  }

  if (socketCreationInProgress) {
    console.log("⏳ Socket creation already in progress, skipping reconnect");
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`❌ Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping.`);
    process.exit(0);
  }

  reconnectAttempts++;

  const baseDelay = Math.min(
    BASE_RECONNECT_DELAY * reconnectAttempts,
    MAX_RECONNECT_DELAY
  );
  
  // Add jitter to prevent pattern detection
  const delay = baseDelay + Math.floor(Math.random() * 3000);

  console.log(`🔄 Scheduling reconnect #${reconnectAttempts} in ${delay}ms (reason: ${reason})`);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectToWhatsApp();
  }, delay);
}

// ============================================================================
// SESSION STABILIZATION WINDOW
// ============================================================================

function startSessionStabilization() {
  console.log(`⏳ Session stabilization window: ${SESSION_STABILIZATION_DELAY}ms`);
  
  // Clear any existing stabilization timer
  if (stabilizationTimer) {
    clearTimeout(stabilizationTimer);
    stabilizationTimer = null;
  }
  
  stabilizationTimer = setTimeout(() => {
    if (activeSocket) {
      sessionStabilized = true;
      console.log("✅ Session stabilized - message processing enabled");
    }
    stabilizationTimer = null;
  }, SESSION_STABILIZATION_DELAY);
}

// ============================================================================
// MAIN CONNECTION FUNCTION
// ============================================================================

async function connectToWhatsApp() {
  // Guard against concurrent calls
  if (socketCreationInProgress) {
    console.log("⚠️ Socket creation already in progress, aborting");
    return;
  }

  if (isShuttingDown) {
    console.log("🛑 Shutdown in progress, aborting connection");
    return;
  }

  socketCreationInProgress = true;

  try {
    // Destroy any existing socket first
    if (activeSocket) {
      destroySocket("pre-reconnect cleanup");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`🚀 Connecting: ${ENV.BOT_NAME}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Auth state must already be loaded at startup
    if (!authState || !saveCreds) {
      throw new Error("Auth state not initialized - this should never happen");
    }

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 Baileys version: ${version} ${isLatest ? "(latest)" : "(outdated)"}`);

    // Create new socket with FRESH Signal store per socket
    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      browser: Browsers.macOS("Chrome"),
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      msgRetryCounterCache,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async (key) => {
        if (store) {
          const msg = await store.loadMessage(key.remoteJid, key.id);
          return msg?.message || undefined;
        }
        return undefined;
      },
    });

    // Set as active socket
    activeSocket = sock;

    // Bind store
    if (store) {
      store.bind(sock.ev);
    }

    // ========================================================================
    // CONNECTION UPDATES
    // ========================================================================

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR Code handling
      if (qr) {
        latestQR = await qrcode.toDataURL(qr);
        qrExpiryTime = Date.now() + QR_VALIDITY_MS;
        console.log(`📱 QR Code available at: http://localhost:${ENV.QR_SERVER_PORT}/qr`);

        const qrPath = path.join(ENV.QR_DIR, `qr-${Date.now()}.png`);
        await qrcode.toFile(qrPath, qr);
        console.log(`💾 QR saved: ${qrPath}`);
      }

      // Connection opened
      if (connection === "open") {
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("✅ CONNECTION ESTABLISHED");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        
        latestQR = null;
        qrExpiryTime = null;
        reconnectAttempts = 0; // Reset backoff on successful connection

        // Clear core dedup cache on reconnect
        processedMessages.clear();

        // Reset router state to align with new socket lifecycle
        resetRouterState();

        // DO NOT enable message processing immediately
        // Start stabilization window for Signal handshake
        sessionStabilized = false;
        startSessionStabilization();
      }

      // Connection closed
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`⚠️ CONNECTION CLOSED - Code: ${statusCode}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Destroy current socket
        destroySocket("connection closed");

        if (statusCode === DisconnectReason.loggedOut) {
          console.log("🔐 Logged out - auth preserved, waiting for manual intervention");
          
          latestQR = null;
          qrExpiryTime = null;
          
          // Hard stop - DO NOT delete auth files, require manual restart
          console.log("🛑 Process stopped - delete auth manually if needed, then restart");
          process.exit(0);
        } else if (shouldReconnect) {
          // Determine reconnect strategy based on error type
          const errorMsg = lastDisconnect?.error?.message || "";
          
          // Crypto/Signal errors need longer backoff
          if (
            errorMsg.includes("Bad MAC") ||
            errorMsg.includes("prekey") ||
            errorMsg.includes("Decryption error") ||
            statusCode === 440 // Connection lost
          ) {
            console.log("⚠️ Signal/crypto error detected - using extended backoff");
            reconnectAttempts = Math.max(reconnectAttempts, 3); // Force longer delay
          }

          scheduleReconnect(`statusCode=${statusCode}`);
        } else {
          console.log("🛑 Reconnect not allowed, stopping");
          process.exit(0);
        }
      }
    });

    // ========================================================================
    // CREDENTIALS UPDATE
    // ========================================================================

    sock.ev.on("creds.update", async () => {
      if (saveCreds) {
        await saveCreds();
      }
    });

    // ========================================================================
    // MESSAGE HANDLER - WITH SESSION STABILIZATION GATE
    // ========================================================================

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // CRITICAL: Wait for session stabilization
      if (!sessionStabilized) {
        // Silent drop during stabilization window
        return;
      }

      if (type !== "notify") return;

      for (const m of messages) {
        try {
          // Skip if no message content
          if (!m.message) continue;

          const messageType = Object.keys(m.message)[0];

          // SIGNAL PROTOCOL MESSAGE BYPASS - DO NOT PROCESS THESE
          if (
            messageType === "protocolMessage" ||
            messageType === "senderKeyDistributionMessage" ||
            messageType === "reactionMessage" ||
            !m.message.conversation && !m.message.extendedTextMessage
          ) {
            continue;
          }

          // Only process group messages
          if (!m.key.remoteJid?.endsWith("@g.us")) continue;

          // Skip own messages
          if (m.key.fromMe) continue;

          const messageContent =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            "";

          if (!messageContent) continue;

          // DEDUPLICATION - TEXT MESSAGES ONLY (Signal messages already bypassed)
          // Stable key format: <remoteJid>-<messageId>
          const messageKey = `${m.key.remoteJid}-${m.key.id}`;
          
          if (processedMessages.has(messageKey)) {
            continue;
          }

          processedMessages.set(messageKey, Date.now());

          // Extract sender info
          const senderJid = m.key.participant || m.key.remoteJid;
          const senderNumber = senderJid.split("@")[0];

          console.log("\n" + "=".repeat(60));
          console.log(`📨 Message from: ${senderNumber}`);
          console.log(`📍 Group: ${m.key.remoteJid}`);
          console.log(`💬 Content: ${messageContent.substring(0, 100)}...`);
          console.log("=".repeat(60));

          // Route to processing pipeline
          await processMessage(sock, m, CONFIG);

        } catch (error) {
          console.error("❌ Error processing message:", error);
          
          // If error is crypto-related, log but don't crash
          if (
            error.message?.includes("Decryption error") ||
            error.message?.includes("Bad MAC")
          ) {
            console.error("⚠️ Crypto error in message processing - may need reconnect");
          }
        }
      }
    });

  } catch (error) {
    console.error("❌ Fatal connection error:", error);
    
    // Destroy socket on fatal error
    destroySocket("fatal error");
    
    // Schedule reconnect with backoff
    scheduleReconnect("fatal error");
  } finally {
    socketCreationInProgress = false;
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal} - shutting down gracefully...`);
  
  isShuttingDown = true;

  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Clear stabilization timer
  if (stabilizationTimer) {
    clearTimeout(stabilizationTimer);
    stabilizationTimer = null;
  }

  // Destroy socket
  destroySocket("shutdown");

  // Save store
  try {
    if (store) {
      store.writeToFile(path.join(ENV.BOT_DIR, "baileys_store.json"));
      console.log("💾 Store saved");
    }
  } catch (err) {
    console.error("⚠️ Failed to save store:", err.message);
  }

  // Close QR server
  try {
    qrServer.close(() => {
      console.log("🔌 QR server closed");
    });
  } catch (err) {
    console.error("⚠️ Failed to close QR server:", err.message);
  }

  console.log("✅ Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ============================================================================
// STARTUP SEQUENCE
// ============================================================================

(async () => {
  try {
    // Load auth state ONCE
    await initializeAuthState();

    // Connect
    await connectToWhatsApp();
  } catch (error) {
    console.error("❌ Startup failed:", error);
    process.exit(1);
  }
})();