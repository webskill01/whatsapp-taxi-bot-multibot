module.exports = {
  apps: [
    // ✅ Bot Instance 1: Delhi
    {
      name: "bot-delhi",
      script: "./core/index.js",
      args: "./bots/bot-delhi",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,

      max_memory_restart: "500M",

      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 10,

      kill_timeout: 15000,
      shutdown_with_message: true,

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-delhi-error.log",
      out_file: "./logs/bot-delhi-out.log",
      merge_logs: true,
      log_type: "raw",

      max_size: "10M",
      retain: 7,

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=480",
        TZ: "Asia/Kolkata",
      },
    },

    // ✅ Bot Instance 2: Sachin
    {
      name: "bot-sachin",
      script: "./core/index.js",
      args: "./bots/bot-sachin",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,

      max_memory_restart: "500M",

      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 10,

      kill_timeout: 15000,
      shutdown_with_message: true,

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-sachin-error.log",
      out_file: "./logs/bot-sachin-out.log",
      merge_logs: true,
      log_type: "raw",

      max_size: "10M",
      retain: 7,

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=480",
        TZ: "Asia/Kolkata",
      },
    },

    // ✅ Bot Instance 3: Manny
    {
      name: "bot-manny",
      script: "./core/index.js",
      args: "./bots/bot-manny",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,

      max_memory_restart: "500M",

      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 10,

      kill_timeout: 15000,
      shutdown_with_message: true,

      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/bot-manny-error.log",
      out_file: "./logs/bot-manny-out.log",
      merge_logs: true,
      log_type: "raw",

      max_size: "10M",
      retain: 7,

      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=480",
        TZ: "Asia/Kolkata",
      },
    },
  ],
};
