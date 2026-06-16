#!/usr/bin/env node

// =============================================================================
// start.js — PM2 Entry Point (promoter bot)
// =============================================================================
// Identical wiring to the other bots. The promo behaviour is driven entirely by
// the "promoMode" block in this bot's config.json (number → app link rewrite).
// =============================================================================

import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../../core/configLoader.js";
import { startBot } from "../../core/index.js";
import { createLogger } from "../../core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const BOT_DIR = path.dirname(__filename);
const AUTH_DIR = path.join(BOT_DIR, "baileys_auth");

const BOT_NAME = process.env.BOT_NAME || path.basename(BOT_DIR);

const log = createLogger(BOT_NAME);

log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
log.info(`🟢 ${BOT_NAME} — entry point (PROMOTER)`);
log.info(`   Bot Dir : ${BOT_DIR}`);
log.info(`   Auth Dir: ${AUTH_DIR}`);
log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { config, ENV } = loadConfig(BOT_DIR);

config.botDir = BOT_DIR;
config.botPhone = config.botPhone || "";

if (config.promoMode?.enabled) {
  log.info("📣 Promo mode CONFIGURED");
  log.info(`   • App link    : ${config.promoMode.appLink}`);
  log.info(`   • Activate at : ${config.promoMode.activateAt || "(warm-up — not set)"}`);
  log.info(`   • CTA variants: ${config.promoMode.ctaVariants?.length || 0}`);
  log.info("   • Until active, forwards rides normally (warm-up phase)");
}

await startBot(config, log, AUTH_DIR);
