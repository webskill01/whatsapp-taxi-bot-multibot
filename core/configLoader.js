/**
 * ============================================================================
 * CONFIG LOADER
 * ============================================================================
 * Bot-2 pipeline validation PRESERVED
 * Bot-1 loading pattern + error handling
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GLOBAL_CONFIG } from "./globalConfig.js";

export function loadConfig(botDir) {
  // Load .env from bot directory
  const envPath = path.join(botDir, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const configPath = path.join(botDir, "config.json");

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`);
    process.exit(1);
  }

  let config;
  try {
    const configContent = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(configContent);
  } catch (error) {
    console.error(`❌ Failed to parse config file: ${error.message}`);
    process.exit(1);
  }

  // =========================================================================
  // VALIDATE REQUIRED FIELDS (Bot-2 pipeline structure)
  // =========================================================================

  const requiredFields = ["sourceGroupIds", "pipelines"];

  for (const field of requiredFields) {
    if (!config[field]) {
      console.error(`❌ Missing required config field: ${field}`);
      process.exit(1);
    }
  }

  // Validate arrays
  if (!Array.isArray(config.sourceGroupIds)) {
    console.error(`❌ sourceGroupIds must be an array`);
    process.exit(1);
  }

  if (!Array.isArray(config.pipelines)) {
    console.error(`❌ pipelines must be an array`);
    process.exit(1);
  }

  if (config.pipelines.length === 0) {
    console.error(`❌ At least one pipeline must be configured`);
    process.exit(1);
  }

  // =========================================================================
  // VALIDATE EACH PIPELINE (Bot-2 specific)
  // =========================================================================

  config.pipelines.forEach((pipeline, index) => {
    if (!pipeline.name) {
      console.error(`❌ Pipeline ${index} missing 'name'`);
      process.exit(1);
    }
    if (!Array.isArray(pipeline.cityScope)) {
      console.error(
        `❌ Pipeline '${pipeline.name}' cityScope must be an array`
      );
      process.exit(1);
    }
    if (!Array.isArray(pipeline.targetGroups)) {
      console.error(
        `❌ Pipeline '${pipeline.name}' targetGroups must be an array`
      );
      process.exit(1);
    }
    if (pipeline.targetGroups.length === 0) {
      console.error(
        `❌ Pipeline '${pipeline.name}' must have at least one targetGroup`
      );
      process.exit(1);
    }
  });

  // =========================================================================
  // MERGE WITH GLOBAL CONFIG (Bot-1 pattern)
  // =========================================================================

  const mergedConfig = {
    ...config,
    botDir: botDir,
    requestKeywords: GLOBAL_CONFIG.requestKeywords,
    ignoreIfContains: GLOBAL_CONFIG.ignoreIfContains,
    blockedPhoneNumbers: GLOBAL_CONFIG.blockedPhoneNumbers,
    blockedSenders: GLOBAL_CONFIG.blockedSenders,
    rateLimits: GLOBAL_CONFIG.rateLimits,
    validation: GLOBAL_CONFIG.validation,
    humanBehavior: GLOBAL_CONFIG.humanBehavior,
    circuitBreaker: GLOBAL_CONFIG.circuitBreaker,
    deduplication: GLOBAL_CONFIG.deduplication,
    reconnect: GLOBAL_CONFIG.reconnect,
  };

  // =========================================================================
  // VALIDATE GROUP ID FORMATS
  // =========================================================================

  function isValidGroupId(id) {
    if (typeof id !== "string") return false;
    return id.endsWith("@g.us") && id.length > 10;
  }

  // Validate source group IDs
  const invalidSourceGroups = mergedConfig.sourceGroupIds.filter(
    (id) => !isValidGroupId(id)
  );
  if (invalidSourceGroups.length > 0) {
    console.error(
      `❌ Invalid source group IDs: ${invalidSourceGroups.join(", ")}`
    );
    process.exit(1);
  }

  // Validate pipeline target groups
  mergedConfig.pipelines.forEach((pipeline) => {
    const invalidGroups = pipeline.targetGroups.filter(
      (id) => !isValidGroupId(id)
    );
    if (invalidGroups.length > 0) {
      console.error(
        `❌ Pipeline '${pipeline.name}' has invalid group IDs: ${invalidGroups.join(", ")}`
      );
      process.exit(1);
    }
  });

  // =========================================================================
  // ENVIRONMENT VARIABLES
  // =========================================================================

  const ENV = {
    BOT_NAME: process.env.BOT_NAME || path.basename(botDir),
    QR_SERVER_PORT: parseInt(process.env.QR_SERVER_PORT || "3001", 10),
    STATS_PORT: parseInt(
      process.env.STATS_PORT || process.env.QR_SERVER_PORT || "3001",
      10
    ),
    BOT_DIR: botDir,
    AUTH_DIR: path.join(botDir, "baileys_auth"),
  };

  // Validate port
  if (
    isNaN(ENV.QR_SERVER_PORT) ||
    ENV.QR_SERVER_PORT < 1 ||
    ENV.QR_SERVER_PORT > 65535
  ) {
    console.error(`❌ Invalid QR_SERVER_PORT: ${process.env.QR_SERVER_PORT}`);
    process.exit(1);
  }

  // Create necessary directories
  if (!fs.existsSync(ENV.AUTH_DIR)) {
    fs.mkdirSync(ENV.AUTH_DIR, { recursive: true });
  }

  // =========================================================================
  // LOG CONFIGURATION SUMMARY
  // =========================================================================

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📋 CONFIGURATION LOADED: ${ENV.BOT_NAME}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Source Groups: ${mergedConfig.sourceGroupIds.length}`);
  console.log(`✅ Pipelines: ${mergedConfig.pipelines.length}`);
  mergedConfig.pipelines.forEach((p) => {
    const scope =
      p.cityScope.join(", ").substring(0, 40) +
      (p.cityScope.join(", ").length > 40 ? "..." : "");
    console.log(`   → ${p.name}: ${scope} → ${p.targetGroups.length} groups`);
  });
  console.log(
    `✅ Global Request Keywords: ${mergedConfig.requestKeywords.length}`
  );
  console.log(
    `✅ Global Ignore Keywords: ${mergedConfig.ignoreIfContains.length}`
  );
  console.log(
    `✅ Global Blocked Numbers: ${mergedConfig.blockedPhoneNumbers.length}`
  );
  console.log(
    `✅ Global Blocked Senders: ${mergedConfig.blockedSenders.length}`
  );
  console.log(
    `✅ Rate Limits: ${mergedConfig.rateLimits.hourly}/hour, ${mergedConfig.rateLimits.daily}/day`
  );
  console.log(`✅ Stats Port: ${ENV.STATS_PORT}`);
  console.log(`✅ Anti-Ban: 10-layer protection enabled`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return { config: mergedConfig, ENV };
}

// ============================================================================
// GROUP-FIELD VALIDATION (used by the config hot-reload below)
// ============================================================================
function isValidGroupIdStrict(id) {
  return typeof id === "string" && id.endsWith("@g.us") && id.length > 10;
}

/** Returns an array of human-readable errors; empty array = valid. */
export function validateGroupFields(cfg) {
  const errs = [];

  if (!Array.isArray(cfg.sourceGroupIds)) {
    errs.push("config.sourceGroupIds must be an array");
  } else {
    const bad = cfg.sourceGroupIds.filter((id) => !isValidGroupIdStrict(id));
    if (bad.length) errs.push(`Invalid source group IDs: ${bad.join(", ")}`);
  }

  if (!Array.isArray(cfg.pipelines) || cfg.pipelines.length === 0) {
    errs.push("config.pipelines must be a non-empty array");
  } else {
    for (const [i, pl] of cfg.pipelines.entries()) {
      const label = pl?.name || `pipeline ${i}`;
      if (!pl?.name) errs.push(`Pipeline ${i} is missing 'name'`);
      if (!Array.isArray(pl?.cityScope)) errs.push(`Pipeline '${label}' cityScope must be an array`);
      if (!Array.isArray(pl?.targetGroups) || pl.targetGroups.length === 0) {
        errs.push(`Pipeline '${label}' must have at least one targetGroup`);
      } else {
        const bad = pl.targetGroups.filter((id) => !isValidGroupIdStrict(id));
        if (bad.length) errs.push(`Pipeline '${label}' has invalid group IDs: ${bad.join(", ")}`);
      }
    }
  }

  return errs;
}

// ============================================================================
// HOT-RELOAD — routing group lists only (control panel writes config.json)
// ============================================================================
/**
 * Watches the bot's config.json and re-applies sourceGroupIds + pipelines onto
 * the live config object in place, so adding/removing a group in the control
 * panel takes effect with NO restart (same pattern as runtime.json).
 *
 * Only those two fields are re-applied — everything else stays boot-time. A
 * malformed or invalid edit is IGNORED (previous groups stay live) rather than
 * crashing a running bot.
 */
export function watchConfigGroups(config, log) {
  const configPath = path.join(config.botDir, "config.json");
  let debounce = null;

  try {
    fs.watchFile(configPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        let next;
        try {
          next = JSON.parse(fs.readFileSync(configPath, "utf8"));
        } catch (err) {
          log.warn(`⚠️  config.json reload failed to parse — keeping current groups: ${err.message}`);
          return;
        }
        const errs = validateGroupFields(next);
        if (errs.length) {
          log.warn(`⚠️  config.json reload rejected — keeping current groups: ${errs.join("; ")}`);
          return;
        }
        config.sourceGroupIds = next.sourceGroupIds;
        config.pipelines      = next.pipelines;
        log.info(
          `🔄 config.json reloaded — ${config.sourceGroupIds.length} source groups, ` +
          `${config.pipelines.length} pipelines (${config.pipelines.reduce((n, pl) => n + pl.targetGroups.length, 0)} targets)`
        );
      }, 300);
    });
  } catch (err) {
    log.warn(`⚠️  could not watch config.json (live group edits disabled): ${err.message}`);
  }
}
