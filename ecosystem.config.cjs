module.exports = {
  apps: [
    {
      name: "bot-delhi",
      script: "./bots/bot-delhi/start.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",

      // 🔒 Bot-1 Stability Settings
      autorestart: true,
      watch: false,
      restart_delay: 8000,         // 8s cooldown between restarts
      min_uptime: 20000,            // Must stay up 20s or counts as crash
      max_restarts: 5,              // 5 crashes in min_uptime window = stop

      // 🧹 Graceful shutdown
      kill_timeout: 15000,          // 15s for SIGTERM handler
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      // 🧠 Memory
      max_memory_restart: "500M",

      start_delay: 0, // 🚀 start immediately

      // 📜 Logs
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

    {
      name: "bot-sachin",
      script: "./bots/bot-sachin/start.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      restart_delay: 8000,
      min_uptime: 20000,
      max_restarts: 5,

      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",
      start_delay: 20000,

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

    {
      name: "bot-manny",
      script: "./bots/bot-manny/start.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      restart_delay: 8000,
      min_uptime: 20000,
      max_restarts: 5,

      kill_timeout: 15000,
      kill_signal: "SIGTERM",
      shutdown_with_message: true,

      max_memory_restart: "500M",
      start_delay: 40000,

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
  ],
};