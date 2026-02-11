#!/usr/bin/env node

/**
 * ============================================================================
 * BOT INSTANCE STARTER
 * ============================================================================
 * This file is placed in each bot's folder (e.g., bots/bot-manny/start.js)
 * It wires the bot to the refactored core with anti-ban hardening
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../core/configLoader.js';
import { connectToWhatsApp, startQRServer } from '../../core/index.js';
import { cleanupRouter } from '../../core/router.js';
import { createLogger, panic } from '../../core/logger.js';

// ============================================================================
// BOT INSTANCE SETUP
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOT_DIR = __dirname; // e.g., bots/bot-manny/

// Extract bot name from directory
const BOT_NAME = path.basename(BOT_DIR);

// Create logger with bot-specific prefix
const log = createLogger(BOT_NAME);

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
  
  // Add botDir to config for disk persistence
  config.botDir = BOT_DIR;
  
} catch (error) {
  panic(error, 'config-load-failed', log);
}

// ============================================================================
// START BAILEYS CONNECTION
// ============================================================================

let sock = null;
let isReady = false;

async function start() {
  try {
    log.info(`🔌 Connecting to WhatsApp...`);
    
    // Connect to WhatsApp with logger
    sock = await connectToWhatsApp(BOT_DIR, config, ENV, log);
    
    // Start QR server with logger
    startQRServer(ENV, config, log);
    
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
    panic(error, 'connection-failed', log);
  }
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
  log.info(`💚 Health: http://localhost:${ENV.QR_SERVER_PORT}/health`);
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
  log.info(`   • Rate Limits: ${config.rateLimits.hourly}/hour, ${config.rateLimits.daily}/day (GLOBAL)`);
  log.info(`   • Min Message Length: ${config.validation.minMessageLength} chars`);
  log.info(`   • Typing Delay: ${config.humanBehavior.typingMin}-${config.humanBehavior.typingMax}ms (length-scaled)`);
  log.info(`   • Between Groups: ${config.humanBehavior.betweenMin}-${config.humanBehavior.betweenMax}ms (weighted)`);
  log.info(`   • Random Pauses: ${config.humanBehavior.randomPauseChance * 100}% chance`);
  log.info(`   • Fingerprint Cache: ${config.deduplication.maxFingerprintCache} entries (2h TTL)`);
  log.info(`   • Blocked Numbers: ${config.blockedPhoneNumbers?.length || 0}`);
  log.info(`   • Request Keywords: ${config.requestKeywords.length}`);
  log.info(`   • Ignore Keywords: ${config.ignoreIfContains.length}`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`🎯 ROUTING LOGIC`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   1. Message arrives from source group`);
  log.info(`   2. Anti-ban gates: age check, replay ID, fingerprint`);
  log.info(`   3. Validation: Not from bot, has phone, is taxi request`);
  log.info(`   4. Filters: Blocked numbers, ignore keywords, rate limits`);
  log.info(`   5. Extract cities from route patterns ONLY`);
  log.info(`      ✅ "from Delhi to Mohali" → ["Delhi", "Mohali"]`);
  log.info(`      ❌ "Singh Travels Amritsar" → Ignored (business name)`);
  log.info(`   6. Match against all pipelines:`);
  log.info(`      • Wildcard (*) → Always match`);
  log.info(`      • City match → Forward to pipeline targets`);
  log.info(`   7. Shuffle targets (random order)`);
  log.info(`   8. Send with human-like delays`);
  log.info(`   9. One message can trigger multiple pipelines`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`📈 RATE LIMIT CLARIFICATION`);
  log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log.info(`   ⚠️  IMPORTANT: Limits are GLOBAL per bot`);
  log.info(`   • ${config.rateLimits.hourly} messages/hour across ALL pipelines`);
  log.info(`   • ${config.rateLimits.daily} messages/day across ALL pipelines`);
  log.info(`   • Example: Pipeline 1 sends 30, Pipeline 2 sends 25`);
  log.info(`   •          → Total counter = 55/${config.rateLimits.hourly} for the hour`);
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

start().catch((err) => panic(err, 'startup-failed', log));