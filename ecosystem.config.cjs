// =============================================================================
// ecosystem.config.cjs — PM2 process manifest (multi-pipeline bots)
//
// KEY RULE:  "cwd" is always "./" (project root).
//            "script" path is relative to cwd.
//
// STAGGERED STARTS: 20s gap between each bot to avoid hitting WhatsApp's
// simultaneous connection detection. Never start two bots at the same time.
//
//   bot-delhi   → starts at   0s  (port 3001)
//   bot-sachin  → starts at  20s  (port 3002)
//   bot-manny   → starts at  40s  (port 3003)
//   bot-devansh → starts at  60s  (port 3004)  ← was wrongly 40s, now fixed
//
// Adding a new bot = duplicate the nearest block, update:
//   name, script, log paths, STATS_PORT, start_delay (+20000 from last)
// =============================================================================

module.exports = {
  apps: [

    // =========================================================================
    // bot-delhi  [starts at 0s]
    // =========================================================================
    {
      name: "bot-delhi",
      script: "./bots/bot-delhi/start.js",
      cwd: "./",

      instances: 1,
      exec_mode: "fork",

      // ── Restart policy ──────────────────────────────────────────────────────
      autorestart: true,
      watch: false,
      restart_delay: 8000,          // 8s cooldown between PM2-triggered restarts
      exp_backoff_restart_delay: 100, // PM2 exponential backoff seed (ms)
      min_uptime: 20000,            // must stay up 20s or counts as crash
      max_restarts: 5,              // 5 crashes within min_uptime window → stop

      // ── Graceful shutdown ───────────────────────────────────────────────────
      kill_timeout: 15000,          // 15s for SIGTERM handler to finish
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      // ── Memory ─────────────────────────────────────────────────────────────
      max_memory_restart: "500M",

      // ── Staggered start ────────────────────────────────────────────────────
      start_delay: 0,               // first bot — starts immediately

      // ── Logs ───────────────────────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-delhi-error.log",
      out_file: "./logs/bot-delhi-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME: "bot-delhi",
        STATS_PORT: "3001",
      },
    },

    // =========================================================================
    // bot-sachin  [starts at 20s]
    // =========================================================================
    {
      name: "bot-sachin",
      script: "./bots/bot-sachin/start.js",
      cwd: "./",

      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      min_uptime: 20000,
      max_restarts: 5,

      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",

      start_delay: 20000,           // 20s after bot-delhi

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-sachin-error.log",
      out_file: "./logs/bot-sachin-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME: "bot-sachin",
        STATS_PORT: "3002",
      },
    },

    // =========================================================================
    // bot-manny  [starts at 40s]
    // =========================================================================
    {
      name: "bot-manny",
      script: "./bots/bot-manny/start.js",
      cwd: "./",

      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      min_uptime: 20000,
      max_restarts: 5,

      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",

      start_delay: 40000,           // 20s after bot-sachin

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-manny-error.log",
      out_file: "./logs/bot-manny-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME: "bot-manny",
        STATS_PORT: "3003",
      },
    },

    // =========================================================================
    // bot-devansh  [starts at 60s]  ← FIXED: was incorrectly 40s (same as manny)
    // =========================================================================
    {
      name: "bot-devansh",
      script: "./bots/bot-devansh/start.js",
      cwd: "./",

      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      restart_delay: 8000,
      exp_backoff_restart_delay: 100,
      min_uptime: 20000,
      max_restarts: 5,

      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",

      start_delay: 60000,           // 20s after bot-manny ← FIXED from 40000

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-devansh-error.log",
      out_file: "./logs/bot-devansh-out.log",
      merge_logs: true,
      log_type: "raw",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Kolkata",
        NODE_OPTIONS: "--max-old-space-size=480",
        BOT_NAME: "bot-devansh",
        STATS_PORT: "3004",
      },
    },

  ],
};
