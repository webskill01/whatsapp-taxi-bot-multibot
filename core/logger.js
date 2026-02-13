/**
 * ============================================================================
 * LOGGER
 * ============================================================================
 * E1: Bot identity prefix on every log line
 */

import pino from "pino";

const transport = pino.transport({
  target: "pino-pretty",
  options: { translateTime: true, colorize: true },
});

/**
 * Creates a logger instance bound to a specific bot identity.
 * Every log line is prefixed with [botId] for instant identification.
 *
 * @param {string} botId - e.g. "bot-delhi", "bot-sachin"
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(botId) {
  const prefix = `[${botId}]`;

  const pinoInstance = pino({ level: "info" }, transport);

  return {
    info: (...args) =>
      pinoInstance.info(`${prefix} ${args[0]}`, ...args.slice(1)),
    warn: (...args) =>
      pinoInstance.warn(`${prefix} ${args[0]}`, ...args.slice(1)),
    error: (...args) =>
      pinoInstance.error(`${prefix} ${args[0]}`, ...args.slice(1)),
  };
}

/**
 * Kills the process with a logged error.
 * @param {Error} err
 * @param {string} context
 */
export function panic(err, context = "fatal-error") {
  console.error(`[PANIC] ${context} —`, err);
  process.exit(1);
}