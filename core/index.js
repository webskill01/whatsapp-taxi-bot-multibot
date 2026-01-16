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
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import { log } from './logger.js';
import { routeMessage, getRouterStats } from './router.js';

// ============================================================================
// GLOBAL STATE
// ============================================================================

let sock = null;
let qrImagePath = null;
let isConnected = false;
let botConfig = null; // Store config for message processing

// ============================================================================
// BAILEYS CONNECTION
// ============================================================================

export async function connectToWhatsApp(botDir, config, ENV) {
  // Store config globally for message handler
  botConfig = config;
  
  const { state, saveCreds } = await useMultiFileAuthState(ENV.AUTH_DIR);
  
  const { version } = await fetchLatestBaileysVersion();

  // Create logger
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

  // ✅ QR CODE HANDLING (3 methods)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // 1. Show QR in terminal
    if (qr) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📱 SCAN THIS QR CODE:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      qrcode.generate(qr, { small: true });
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // 2. Save QR as PNG
      const timestamp = Date.now();
      qrImagePath = path.join(ENV.QR_DIR, `qr-${timestamp}.png`);
      
      try {
        await QRCode.toFile(qrImagePath, qr);
        log.info(`💾 QR saved: ${qrImagePath}`);
        log.info(`🌐 QR available at: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
      } catch (err) {
        log.error(`❌ Failed to save QR: ${err.message}`);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = 
        (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

      log.warn(`⚠️  Connection closed. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        isConnected = false;
        setTimeout(() => {
          connectToWhatsApp(botDir, config, ENV);
        }, 3000);
      }
    } else if (connection === 'open') {
      log.info('✅ WhatsApp Connected!');
      isConnected = true;
      qrImagePath = null; // Clear QR after successful connection
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ✅ Handle incoming messages using router
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        // Use router for multi-pipeline processing
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

  // 3. Serve QR via HTTP
  app.get('/qr', (req, res) => {
    if (!qrImagePath || !fs.existsSync(qrImagePath)) {
      return res.status(404).json({ 
        error: 'No QR code available',
        message: 'Either already connected or QR not yet generated'
      });
    }

    res.sendFile(qrImagePath);
  });

  app.get('/status', (req, res) => {
    res.json({
      connected: isConnected,
      qrAvailable: qrImagePath !== null && fs.existsSync(qrImagePath),
      botName: ENV.BOT_NAME,
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
        error: 'WhatsApp not connected' 
      });
    }

    try {
      const groupsDict = await sock.groupFetchAllParticipating();
      const groups = Object.values(groupsDict).map(g => ({
        id: g.id,
        name: g.subject,
        participantsCount: g.participants.length,
        owner: g.owner,
        creation: g.creation,
        description: g.desc
      }));

      // Categorize groups based on config
      const categorized = groups.map(g => {
        let type = 'other';
        let category = 'Unmonitored';

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

      res.json({
        success: true,
        totalGroups: groups.length,
        groups: categorized
      });

    } catch (error) {
      log.error('❌ Failed to get groups:', error);
      res.status(500).json({ 
        error: error.message 
      });
    }
  });

  app.listen(ENV.QR_SERVER_PORT, () => {
    log.info(`🌐 QR Server: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
    log.info(`📊 Stats: http://localhost:${ENV.QR_SERVER_PORT}/stats`);
    log.info(`👥 Groups: http://localhost:${ENV.QR_SERVER_PORT}/groups`);
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