#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../core/configLoader.js';
import { connectToWhatsApp, startQRServer } from '../../core/index.js';
import { initializeRouter, routeMessage, cleanupRouter } from '../../core/router.js';
import { log, panic } from '../../core/logger.js';

// ============================================================================
// BOT INSTANCE SETUP
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOT_DIR = __dirname; // This is bots/bot-delhi/

log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
log.info(`🚀 STARTING TAXI BOT INSTANCE`);
log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
log.info(`📁 Bot Directory: ${BOT_DIR}`);

// ============================================================================
// LOAD CONFIGURATION
// ============================================================================

let config, ENV;

try {
  const result = loadConfig(BOT_DIR);
  config = result.config;
  ENV = result.ENV;
  
  // Add botDir to config for router access
  config.botDir = BOT_DIR;
  
} catch (error) {
  panic(error, 'config-load-failed');
}

// ============================================================================
// INITIALIZE ROUTER
// ============================================================================

try {
  initializeRouter(config);
} catch (error) {
  panic(error, 'router-init-failed');
}

// ============================================================================
// START BAILEYS CONNECTION
// ============================================================================

let sock = null;
let isReady = false;

async function start() {
  try {
    log.info(`🔌 Connecting to WhatsApp...`);
    
    // Connect to WhatsApp
    sock = await connectToWhatsApp(BOT_DIR, config, ENV);
    
    // Start QR server
    startQRServer(ENV, config, sock);
    
    // Wait for connection
    await new Promise((resolve) => {
      const checkConnection = setInterval(() => {
        if (sock && sock.user) {
          clearInterval(checkConnection);
          isReady = true;
          resolve();
        }
      }, 1000);
      
      // Timeout after 2 minutes
      setTimeout(() => {
        clearInterval(checkConnection);
        if (!isReady) {
          log.warn('⚠️  Connection timeout - scan QR code');
          log.info(`🌐 QR available at: http://localhost:${ENV.QR_SERVER_PORT}/qr`);
        }
      }, 120000);
    });
    
    if (isReady) {
      log.info(`✅ Bot fully operational!`);
      log.info(`📱 Connected as: ${sock.user.id}`);
      printOperationalSummary();
    }
    
  } catch (error) {
    panic(error, 'connection-failed');
  }
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

// Override the default message handler from core/index.js
// We'll use the router instead
export function setupMessageHandler(sock) {
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const message of messages) {
      try {
        // Use router for multi-pipeline processing
        await routeMessage(sock, message, config);
      } catch (error) {
        log.error(`❌ Route error: ${error.message}`);
      }
    }
  });
}

// ============================================================================
// OPERATIONAL SUMMARY
// ============================================================================

function printOperationalSummary() {
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`📋 BOT CONFIGURATION`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`🤖 Bot Name: ${ENV.BOT_NAME}`);
  log.info(`🌐 QR Server: http://localhost:${ENV.QR_SERVER_PORT}`);
  log.info(`📊 Stats: http://localhost:${ENV.QR_SERVER_PORT}/stats`);
  log.info(`👥 Groups: http://localhost:${ENV.QR_SERVER_PORT}/groups`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`📍 SOURCE GROUPS`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  config.sourceGroupIds.forEach((id, idx) => {
    log.info(`   ${idx + 1}. ${id.substring(0, 20)}...`);
  });
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`🎯 PIPELINES (${config.pipelines.length})`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  config.pipelines.forEach((pipeline, idx) => {
    log.info(`   ${idx + 1}. ${pipeline.name}`);
    log.info(`      Cities: ${pipeline.cityScope.join(', ')}`);
    log.info(`      Targets: ${pipeline.targetGroups.length} groups`);
    pipeline.targetGroups.forEach(g => {
      log.info(`         → ${g.substring(0, 20)}...`);
    });
  });
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`⚙️  SETTINGS`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   • Rate Limits: 80/hour, 700/day (GLOBAL)`);
  log.info(`   • Min Message Length: 10 chars`);
  log.info(`   • Human Delays: 2-4s typing, 2-4s between groups`);
  log.info(`   • Random Pauses: 15% chance`);
  log.info(`   • Duplicate Detection: Text fingerprints (2h cache)`);
  log.info(`   • Blocked Numbers: ${config.blockedPhoneNumbers?.length || 0}`);
  log.info(`   • Request Keywords: ${config.requestKeywords.length}`);
  log.info(`   • Ignore Keywords: ${config.ignoreIfContains.length}`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`🛡️  ROUTING LOGIC`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   1. Message arrives from source group`);
  log.info(`   2. Validate: Not from bot, has phone, is taxi request`);
  log.info(`   3. Check: Blocked numbers, duplicates, rate limits`);
  log.info(`   4. Extract cities from route patterns ONLY`);
  log.info(`      ✅ "from Delhi to Mohali" → ["Delhi", "Mohali"]`);
  log.info(`      ❌ "Singh Travels Amritsar" → Ignored`);
  log.info(`   5. Match against all pipelines:`);
  log.info(`      • Wildcard (*) → Always match`);
  log.info(`      • City match → Forward to pipeline targets`);
  log.info(`   6. Send to ALL matched pipeline targets`);
  log.info(`   7. One message can trigger multiple pipelines`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`📈 RATE LIMIT CLARIFICATION`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   ⚠️  IMPORTANT: Limits are GLOBAL per bot`);
  log.info(`   • 80 messages/hour across ALL pipelines`);
  log.info(`   • 700 messages/day across ALL pipelines`);
  log.info(`   • Example: Pipeline 1 sends 30, Pipeline 2 sends 25`);
  log.info(`   •          → Total counter = 55/80 for the hour`);
  log.info(`   • Why? WhatsApp tracks per phone number, not per group`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`🎉 BOT READY - Listening for messages...`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGINT', () => {
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`👋 Shutting down ${ENV.BOT_NAME}...`);
  
  cleanupRouter(config);
  
  if (sock) {
    sock.end();
  }
  
  log.info(`✅ Cleanup complete`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('📥 Received SIGTERM');
  process.exit(0);
});

// ============================================================================
// START BOT
// ============================================================================

start().catch((err) => panic(err, 'startup-failed'));