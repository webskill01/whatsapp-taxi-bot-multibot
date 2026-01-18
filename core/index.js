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

import { log } from './logger.js';
import { routeMessage, getRouterStats } from './router.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

let sock = null;
let currentQR = null; // ✅ Store QR string instead of file path
let isConnected = false;
let botConfig = null;

// ============================================================================
// BAILEYS CONNECTION
// ============================================================================

export async function connectToWhatsApp(botDir, config, ENV) {
  botConfig = config;
  
  const { state, saveCreds } = await useMultiFileAuthState(ENV.AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    markOnlineOnConnect: false,
  });

  // ✅ QR CODE HANDLING
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // 1. Generate and show QR
    if (qr) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📱 SCAN THIS QR CODE:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      qrcode.generate(qr, { small: true });
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // 2. Store QR string for API (no file saving)
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
        currentQR = null; // ✅ Clear QR on disconnect
        setTimeout(() => {
          connectToWhatsApp(botDir, config, ENV);
        }, 3000);
      }
    } else if (connection === 'open') {
      log.info('✅ WhatsApp Connected!');
      isConnected = true;
      currentQR = null; // ✅ Clear QR after successful connection
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ✅ Handle incoming messages using router
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        await routeMessage(sock, message, botConfig);
      } catch (error) {
        log.error(`❌ Route error: ${error.message}`);
      }
    }
  });

  return sock;
}

// ============================================================================
// QR SERVER (HTTP ENDPOINT)
// ============================================================================

export function startQRServer(ENV, config) {
  const app = express();
  app.use(express.static('public'));
  
  // ✅ Serve QR via HTTP as PNG image
  app.get('/qr', async (req, res) => {
    // Check if already connected
    if (isConnected) {
      return res.status(200).json({ 
        success: true,
        message: 'WhatsApp is already connected',
        connected: true
      });
    }

    // Check if QR exists
    if (!currentQR) {
      return res.status(404).json({ 
        error: 'No QR code available',
        message: 'QR not yet generated. Please wait...',
        connected: false
      });
    }

    try {
      // ✅ Generate QR as PNG buffer in memory (no file saving)
      const qrBuffer = await QRCode.toBuffer(currentQR, {
        type: 'png',
        width: 400,
        margin: 2
      });

      // Send as image
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

  // ✅ Get QR as base64 (alternative endpoint)
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
      timestamp: Date.now()
    });
  });

  app.get('/stats', (req, res) => {
    const routerStats = getRouterStats();
    
    res.json({
      botName: ENV.BOT_NAME,
      connected: isConnected,
      ...routerStats,
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

      // ✅ Categorize groups with proper sorting
      const categorized = groups.map(g => {
        let type = 'other';
        let category = 'Unmonitored';

        // Check if source group
        if (config.sourceGroupIds.includes(g.id)) {
          type = 'source';
          category = 'Source Group';
        } else {
          // Check if in any pipeline
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

      // ✅ Sort by type priority
      const sortOrder = { source: 1, pipeline: 2, other: 3 };
      categorized.sort((a, b) => {
        const orderA = sortOrder[a.type] || 99;
        const orderB = sortOrder[b.type] || 99;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Sort by name within same type
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
  
  if (sock) {
    sock.end();
  }
  
  process.exit(0);
});