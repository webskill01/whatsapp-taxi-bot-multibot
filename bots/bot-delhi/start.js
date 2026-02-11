#!/usr/bin/env node

// =============================================================================
// start.js — PM2 Entry Point (REFACTORED TO BOT-1 PATTERN)
// =============================================================================
// STABILITY FIXES:
// ✅ Clean separation: start.js only handles wiring
// ✅ Path resolution via __filename
// ✅ .env loaded before imports
// ✅ Calls core startBot() function (Bot-1 pattern)
// =============================================================================

import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './configLoader.js';
import { startBot } from './index.js';
import { createLogger } from './logger.js';

// =============================================================================
// PATH RESOLUTION
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const BOT_DIR = path.dirname(__filename);
const AUTH_DIR = path.join(BOT_DIR, 'baileys_auth');

// =============================================================================
// BOT IDENTITY
// =============================================================================

const BOT_NAME = process.env.BOT_NAME || path.basename(BOT_DIR);

// =============================================================================
// BOOT
// =============================================================================

const log = createLogger(BOT_NAME);

log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
log.info(`🟢 ${BOT_NAME} — entry point`);
log.info(`   Bot Dir : ${BOT_DIR}`);
log.info(`   Auth Dir: ${AUTH_DIR}`);
log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Load + validate config (throws on error, PM2 restarts)
const { config, ENV } = loadConfig(BOT_DIR);

// Add botDir to config for disk persistence
config.botDir = BOT_DIR;
config.botPhone = config.botPhone || "";

// Hand off to main event loop (never returns)
await startBot(config, log, AUTH_DIR);