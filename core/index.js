/**
 * ============================================================================
 * BAILEYS CONNECTION & MESSAGE HANDLER
 * ============================================================================
 * Merged: OLD bot's QR server + NEW bot's anti-ban hardening
 * 
 * 🔒 Anti-ban features:
 *   B1: Reconnect age-gate (10s strict for 30s after reconnect)
 *   B2: Replay ID set (200 rolling message IDs)
 *   C2: Disk-backed fingerprint persistence (debounced 30s writes)
 *   A4: Settling delay (5-15s on first message after connect)
 * 
 * 🛡️ Session stability features:
 *   S1: Session stabilization delay (8s after connect before sends)
 *   S2: Reconnect rate limiter (max 3 per 10 minutes)
 */

import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import express from 'express';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

import { routeMessage, getRouterStats, initializeRouter } from './router.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

let sock = null;
let currentQR = null;
let isConnected = false;
let botConfig = null;
let log = null;

// 🔒 B1: Reconnect age-gate (ported from new core)
let reconnectStrictUntil = 0;
const STRICT_AGE_MS = 10000;          // 10s
const STRICT_WINDOW_DURATION = 30000; // 30s

// 🔒 B2: Replay ID set (ported from new core)
const replayIdSet = new Set();
const MAX_REPLAY_IDS = 200;

// 🔒 A4: Settling delay flag (ported from new core)
let needsSettlingDelay = true;

// 🔒 C2: Disk persistence state (ported from new core)
let fingerprintDirty = false;
let fingerprintSaveTimer = null;
const fingerprintSet = new Set();

// 🛡️ S1: Session stabilization (prevents prekey thrashing)
let sessionStableAt = 0;
const SESSION_STABILIZE_MS = 8000; // 8 seconds

// 🛡️ S2: Reconnect rate limiter (prevents WhatsApp prekey spam)
let reconnects = [];
const MAX_RECONNECTS = 3;
const RECONNECT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Stats
const stats = {
  messagesReceived: 0,
  rejected: {
    fromMe: 0,
    oldAfterReconnect: 0,
    replayDuplicate: 0,
    tooShort: 0,
    duplicate: 0,
    sessionNotStable: 0
  }
};

// ============================================================================
// 🛡️ S2: RECONNECT RATE LIMITER
// ============================================================================

/**
 * Checks if reconnect is allowed (max 3 per 10 minutes)
 * WHY: Prevents WhatsApp from spamming prekeys during reconnect storms
 */
function canReconnect() {
  const now = Date.now();
  
  // Remove reconnects older than 10 minutes
  reconnects = reconnects.filter(t => now - t < RECONNECT_WINDOW_MS);
  
  if (reconnects.length >= MAX_RECONNECTS) {
    const oldestReconnect = Math.min(...reconnects);
    const waitTimeMs = RECONNECT_WINDOW_MS - (now - oldestReconnect);
    const waitMinutes = Math.ceil(waitTimeMs / 60000);
    
    log.warn(`⚠️  Reconnect rate limit hit (${reconnects.length}/${MAX_RECONNECTS})`);
    log.warn(`⏳ Must wait ${waitMinutes} minutes before reconnecting`);
    
    return false;
  }
  
  // Record this reconnect attempt
  reconnects.push(now);
  return true;
}

/**
 * Sleeps before reconnect if rate limited
 */
async function sleepIfRateLimited() {
  const now = Date.now();
  reconnects = reconnects.filter(t => now - t < RECONNECT_WINDOW_MS);
  
  if (reconnects.length >= MAX_RECONNECTS) {
    const oldestReconnect = Math.min(...reconnects);
    const waitTimeMs = RECONNECT_WINDOW_MS - (now - oldestReconnect);
    const waitMinutes = Math.ceil(waitTimeMs / 60000);
    
    log.warn(`🛑 Reconnect rate limited - sleeping ${waitMinutes} minutes`);
    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
  }
}

// ============================================================================
// 🔒 C2: DISK-BACKED FINGERPRINT PERSISTENCE (ported from new core)
// ============================================================================

/**
 * Loads fingerprints from disk with TTL filtering
 */
function loadFingerprintsFromDisk(botDir) {
  const fpFile = path.join(botDir, botConfig.deduplication.fingerprintFile);
  
  if (!fs.existsSync(fpFile)) {
    log.info('📂 No existing fingerprint file found');
    return;
  }

  try {
    const content = fs.readFileSync(fpFile, 'utf8');
    const entries = JSON.parse(content);
    
    if (!Array.isArray(entries)) {
      log.warn('⚠️  Invalid fingerprint file format');
      return;
    }

    const now = Date.now();
    const ttl = botConfig.deduplication.fingerprintTTL;
    let loaded = 0;

    for (const entry of entries) {
      if (entry.fp && entry.ts) {
        const age = now - entry.ts;
        if (age < ttl) {
          fingerprintSet.add(entry.fp);
          loaded++;
        }
      }
    }

    log.info(`📥 Loaded ${loaded} fingerprints from disk (${entries.length - loaded} expired)`);
  } catch (error) {
    log.error(`❌ Failed to load fingerprints: ${error.message}`);
  }
}

/**
 * Marks fingerprints as dirty (triggers debounced save)
 */
function markDirty() {
  fingerprintDirty = true;

  // Clear existing timer
  if (fingerprintSaveTimer) {
    clearTimeout(fingerprintSaveTimer);
  }

  // Debounced save
  fingerprintSaveTimer = setTimeout(() => {
    saveFingerprintsToDisk();
  }, botConfig.deduplication.saveDebounceMs);
}

/**
 * Saves fingerprints to disk
 */
function saveFingerprintsToDisk() {
  if (!fingerprintDirty) return;

  const fpFile = path.join(botConfig.botDir, botConfig.deduplication.fingerprintFile);

  try {
    const now = Date.now();
    const entries = [];
    
    // Convert Set to array with timestamps
    for (const fp of fingerprintSet) {
      entries.push({ fp, ts: now });
      
      // Cap at max save size
      if (entries.length >= botConfig.deduplication.fingerprintSaveCap) {
        break;
      }
    }

    fs.writeFileSync(fpFile, JSON.stringify(entries, null, 2), 'utf8');
    log.info(`💾 Saved ${entries.length} fingerprints to disk`);
    
    fingerprintDirty = false;
  } catch (error) {
    log.error(`❌ Failed to save fingerprints: ${error.message}`);
  }
}

/**
 * Force save on shutdown
 */
function forceSaveFingerprints() {
  if (fingerprintSaveTimer) {
    clearTimeout(fingerprintSaveTimer);
  }
  saveFingerprintsToDisk();
}

// ============================================================================
// MESSAGE HANDLER WITH ANTI-BAN HARDENING
// ============================================================================

/**
 * 🔒 Core message handler with all anti-ban gates
 */
async function handleMessage(message) {
  stats.messagesReceived++;

  try {
    const messageKey = message.key;
    const messageContent = message.message;
    const messageTimestamp = (message.messageTimestamp || 0) * 1000;
    const now = Date.now();

    // Gate 1: fromMe check
    if (messageKey.fromMe) {
      stats.rejected.fromMe++;
      return;
    }

    // 🛡️ S1: Session stability check (prevents prekey thrashing)
    // WHY: Sending immediately after connect can trigger prekey errors
    if (now < sessionStableAt) {
      stats.rejected.sessionNotStable++;
      log.warn(`🛑 Session not stable yet — skipping message (${Math.ceil((sessionStableAt - now) / 1000)}s remaining)`);
      return;
    }

    // 🔒 B1: Reconnect age-gate (strict window enforcement)
    if (reconnectStrictUntil && now < reconnectStrictUntil) {
      const messageAge = now - messageTimestamp;
      if (messageAge > STRICT_AGE_MS) {
        stats.rejected.oldAfterReconnect++;
        log.info(`🕐 Rejected old message (${Math.floor(messageAge / 1000)}s old, strict window active)`);
        return;
      }
    }

    // 🔒 B2: Replay ID deduplication
    const messageId = messageKey.id;
    if (replayIdSet.has(messageId)) {
      stats.rejected.replayDuplicate++;
      log.info(`🔁 Rejected replay duplicate: ${messageId}`);
      return;
    }
    
    // Add to replay set with size limit
    replayIdSet.add(messageId);
    if (replayIdSet.size > MAX_REPLAY_IDS) {
      const oldest = replayIdSet.values().next().value;
      replayIdSet.delete(oldest);
    }

    // Extract text
    let messageText = '';
    if (messageContent?.conversation) {
      messageText = messageContent.conversation;
    } else if (messageContent?.extendedTextMessage?.text) {
      messageText = messageContent.extendedTextMessage.text;
    }

    // Gate 2: Minimum length
    if (!messageText || messageText.length < botConfig.validation.minMessageLength) {
      stats.rejected.tooShort++;
      return;
    }

    // 🔒 A4: Settling delay on first message after connect
    if (needsSettlingDelay) {
      const settlingMs = botConfig.reconnect.settlingMin + 
        Math.random() * (botConfig.reconnect.settlingMax - botConfig.reconnect.settlingMin);
      
      log.info(`⏳ Settling delay: ${Math.floor(settlingMs / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, settlingMs));
      
      needsSettlingDelay = false;
    }

    // Pass to router for processing
    await routeMessage(sock, message, botConfig);

  } catch (error) {
    log.error(`❌ Message handler error: ${error.message}`);
  }
}

// ============================================================================
// BAILEYS CONNECTION
// ============================================================================

export async function connectToWhatsApp(botDir, config, ENV, logger) {
  botConfig = config;
  log = logger || console;
  
  // 🛡️ S2: Check reconnect rate limit
  if (!canReconnect()) {
    await sleepIfRateLimited();
  }
  
  const { state, saveCreds } = await useMultiFileAuthState(ENV.AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const pinoLogger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    logger: pinoLogger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    markOnlineOnConnect: false,
  });

  // 🔒 C2: Load fingerprints from disk on startup
  loadFingerprintsFromDisk(botDir);

  // Initialize router
  initializeRouter(config, log);

  // QR CODE HANDLING
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📱 SCAN THIS QR CODE:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      qrcode.generate(qr, { small: true });
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      currentQR = qr;
      log.info(`🔄 QR code refreshed`);
      log.info(`🌐 QR available at: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
    }

    if (connection === 'close') {
      const shouldReconnect = 
        (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

      log.warn(`⚠️  Connection closed. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        isConnected = false;
        currentQR = null;
        
        // 🔒 C2: Force save fingerprints before reconnect
        forceSaveFingerprints();
        
        setTimeout(() => {
          connectToWhatsApp(botDir, config, ENV, log);
        }, 3000);
      }
    } else if (connection === 'open') {
      log.info('✅ WhatsApp Connected!');
      isConnected = true;
      currentQR = null;
      
      // 🛡️ S1: Activate session stabilization delay
      // WHY: Prevents prekey thrashing by waiting 8s before any sends
      sessionStableAt = Date.now() + SESSION_STABILIZE_MS;
      log.info(`🧠 Signal session stabilizing for ${SESSION_STABILIZE_MS / 1000}s`);
      
      // 🔒 B1: Activate strict age window
      reconnectStrictUntil = Date.now() + STRICT_WINDOW_DURATION;
      log.info(`🔒 Strict age window active for ${STRICT_WINDOW_DURATION / 1000}s`);
      
      // 🔒 A4: Reset settling delay flag
      needsSettlingDelay = true;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      await handleMessage(message);
    }
  });

  return sock;
}

// ============================================================================
// QR SERVER (HTTP ENDPOINT)
// ============================================================================

export function startQRServer(ENV, config, logger) {
  log = logger || console;
  
  const app = express();
  app.use(express.static('public'));
  
  // Serve QR via HTTP as PNG image
  app.get('/qr', async (req, res) => {
    if (isConnected) {
      return res.status(200).json({ 
        success: true,
        message: 'WhatsApp is already connected',
        connected: true
      });
    }

    if (!currentQR) {
      return res.status(404).json({ 
        error: 'No QR code available',
        message: 'QR not yet generated. Please wait...',
        connected: false
      });
    }

    try {
      const qrBuffer = await QRCode.toBuffer(currentQR, {
        type: 'png',
        width: 400,
        margin: 2
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(qrBuffer);
    } catch (error) {
      log.error(`❌ Failed to generate QR: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to generate QR code',
        message: error.message
      });
    }
  });

  // Get QR as base64
  app.get('/qr/base64', async (req, res) => {
    if (isConnected) {
      return res.json({ 
        success: true,
        message: 'WhatsApp is already connected',
        connected: true
      });
    }

    if (!currentQR) {
      return res.status(404).json({ 
        error: 'No QR code available',
        message: 'QR not yet generated. Please wait...',
        connected: false
      });
    }

    try {
      const qrDataURL = await QRCode.toDataURL(currentQR, {
        width: 400,
        margin: 2
      });

      res.json({
        success: true,
        qr: qrDataURL,
        message: 'Scan this QR code with WhatsApp',
        connected: false
      });
    } catch (error) {
      log.error(`❌ Failed to generate QR: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to generate QR code',
        message: error.message
      });
    }
  });

  app.get('/status', (req, res) => {
    res.json({
      connected: isConnected,
      qrAvailable: currentQR !== null,
      botName: ENV.BOT_NAME,
      timestamp: Date.now(),
      stats: {
        messagesReceived: stats.messagesReceived,
        rejected: stats.rejected
      }
    });
  });

  app.get('/stats', (req, res) => {
    const routerStats = getRouterStats();
    
    res.json({
      botName: ENV.BOT_NAME,
      connected: isConnected,
      ...routerStats,
      messageHandler: {
        received: stats.messagesReceived,
        rejected: stats.rejected
      },
      antiBan: {
        reconnectProtection: {
          strictWindowActive: Date.now() < reconnectStrictUntil,
          strictAgeMs: STRICT_AGE_MS,
          strictWindowDuration: STRICT_WINDOW_DURATION
        },
        replayProtection: {
          cachedIds: replayIdSet.size,
          maxIds: MAX_REPLAY_IDS
        },
        fingerprintPersistence: {
          inMemory: fingerprintSet.size,
          dirty: fingerprintDirty
        },
        sessionStability: {
          sessionStable: Date.now() >= sessionStableAt,
          stabilizeMs: SESSION_STABILIZE_MS,
          remainingMs: Math.max(0, sessionStableAt - Date.now())
        },
        reconnectRateLimit: {
          reconnectsInWindow: reconnects.length,
          maxReconnects: MAX_RECONNECTS,
          windowMs: RECONNECT_WINDOW_MS
        }
      },
      config: {
        sourceGroups: config.sourceGroupIds.length,
        pipelines: config.pipelines.length,
        pipelineDetails: config.pipelines.map(p => ({
          name: p.name,
          cityScope: p.cityScope,
          targetGroupCount: p.targetGroups.length
        }))
      }
    });
  });

  app.get('/groups', async (req, res) => {
    if (!sock || !isConnected) {
      return res.status(503).json({ 
        error: 'WhatsApp not connected',
        message: 'Please scan QR code first'
      });
    }

    try {
      const groupsDict = await sock.groupFetchAllParticipating();
      const groups = Object.values(groupsDict).map(g => ({
        id: g.id,
        name: g.subject,
        participantsCount: g.participants.length
      }));

      // Categorize groups
      const categorized = groups.map(g => {
        let type = 'other';
        let category = 'Unmonitored';

        if (config.sourceGroupIds.includes(g.id)) {
          type = 'source';
          category = 'Source Group';
        } else {
          for (const pipeline of config.pipelines) {
            if (pipeline.targetGroups.includes(g.id)) {
              type = 'pipeline';
              category = `Pipeline: ${pipeline.name}`;
              break;
            }
          }
        }

        return { ...g, type, category };
      });

      // Sort by type priority
      const sortOrder = { source: 1, pipeline: 2, other: 3 };
      categorized.sort((a, b) => {
        const orderA = sortOrder[a.type] || 99;
        const orderB = sortOrder[b.type] || 99;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      res.json({
        success: true,
        totalGroups: groups.length,
        connectedAs: sock.user?.id || 'Unknown',
        breakdown: {
          source: categorized.filter(g => g.type === 'source').length,
          pipeline: categorized.filter(g => g.type === 'pipeline').length,
          other: categorized.filter(g => g.type === 'other').length,
        },
        groups: categorized
      });

    } catch (error) {
      log.error('❌ Failed to get groups:', error);
      res.status(500).json({ 
        error: error.message,
        success: false
      });
    }
  });

  app.get('/health', (req, res) => {
    const routerStats = getRouterStats();
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    
    const health = {
      status: isConnected ? 'healthy' : 'unhealthy',
      uptime: Math.floor(uptime),
      uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      whatsapp: {
        connected: isConnected,
        user: sock?.user?.id || null
      },
      memory: {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
      },
      stats: {
        processed: routerStats.stats.processed,
        hourly: `${routerStats.messageCount.hourly}/${config.rateLimits.hourly}`,
        daily: `${routerStats.messageCount.daily}/${config.rateLimits.daily}`
      },
      circuitBreaker: {
        open: routerStats.circuitBreaker.isOpen,
        failures: routerStats.circuitBreaker.failureCount
      }
    };
    
    res.status(isConnected ? 200 : 503).json(health);
  });

  app.listen(ENV.QR_SERVER_PORT, () => {
    log.info(`🌐 QR Server: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
    log.info(`🌐 QR Base64: http://localhost:${ENV.QR_SERVER_PORT}/qr/base64`);
    log.info(`📊 Stats: http://localhost:${ENV.QR_SERVER_PORT}/stats`);
    log.info(`👥 Groups: http://localhost:${ENV.QR_SERVER_PORT}/groups`);
    log.info(`💚 Health: http://localhost:${ENV.QR_SERVER_PORT}/health`);
  });
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGINT', () => {
  log.info('👋 Shutting down...');
  
  // 🔒 C2: Force save fingerprints
  forceSaveFingerprints();
  
  if (sock) {
    sock.end();
  }
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('📥 Received SIGTERM');
  
  // 🔒 C2: Force save fingerprints
  forceSaveFingerprints();
  
  if (sock) {
    sock.end();
  }
  
  process.exit(0);
});