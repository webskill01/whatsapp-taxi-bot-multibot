module.exports = {
  apps: [
    // ✅ Bot Instance 1: Delhi
    {
      name: "bot-delhi",
      script: "./bots/bot-delhi/start.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,

      // ✅ Memory management
      max_memory_restart: "500M",

      // ✅ Restart behavior
      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 10,

      // ✅ Graceful shutdown
      kill_timeout: 15000,
      shutdown_with_message: true,

      // ✅ Logging
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-delhi-error.log",
      out_file: "./logs/bot-delhi-out.log",
      merge_logs: true,
      log_type: "raw",

      // ✅ Rotate logs daily
      max_size: "10M",
      retain: 7, // Keep 7 days of logs

      // ✅ Environment
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=480",
      },
    },

    // ✅ Bot Instance 2: Kanav (FIXED LOG PATHS)
    // {
    //   name: "bot-sachin",
    //   script: "./bots/bot-sachin/start.js",
    //   cwd: "./",
    //   instances: 1,
    //   exec_mode: "fork",
    //   autorestart: true,
    //   watch: false,

    //   // ✅ Memory management
    //   max_memory_restart: "500M",

    //   // ✅ Restart behavior
    //   restart_delay: 5000,
    //   min_uptime: 15000,
    //   max_restarts: 10,

    //   // ✅ Graceful shutdown
    //   kill_timeout: 15000,
    //   shutdown_with_message: true,

    //   // ✅ Logging (FIXED - was using bot-delhi paths)
    //   log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    //   error_file: "./logs/bot-kanav-error.log",  // ← FIXED
    //   out_file: "./logs/bot-kanav-out.log",      // ← FIXED
    //   merge_logs: true,
    //   log_type: "raw",

    //   // ✅ Rotate logs daily
    //   max_size: "10M",
    //   retain: 7, // Keep 7 days of logs

    //   // ✅ Environment
    //   env: {
    //     NODE_ENV: "production",
    //     NODE_OPTIONS: "--max-old-space-size=480",
    //   },
    // },

    // ============================================================================
    // 📝 Template for adding more bots:
    // ============================================================================
    // {
    //   name: "bot-punjab",
    //   script: "./bots/bot-punjab/start.js",
    //   cwd: "./",
    //   instances: 1,
    //   exec_mode: "fork",
    //   autorestart: true,
    //   watch: false,
    //   max_memory_restart: "500M",
    //   restart_delay: 5000,
    //   min_uptime: 15000,
    //   max_restarts: 10,
    //   kill_timeout: 15000,
    //   shutdown_with_message: true,
    //   log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    //   error_file: "./logs/bot-punjab-error.log",
    //   out_file: "./logs/bot-punjab-out.log",
    //   merge_logs: true,
    //   log_type: "raw",
    //   max_size: "10M",
    //   retain: 7,
    //   env: {
    //     NODE_ENV: "production",
    //     NODE_OPTIONS: "--max-old-space-size=480",
    //   },
    // },
  ],
};