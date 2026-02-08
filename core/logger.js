/**
 * ============================================================================
 * LOGGER
 * ============================================================================
 * E1: Bot identity prefix on every log line
 * Ported from NEW bot with backward compat for OLD bot usage
 */

import pino from "pino";

const transport = pino.transport({
  target: "pino-pretty",
  options: { translateTime: true, colorize: true }
});

/**
 * Creates a logger instance bound to a specific bot identity.
 * Every log line is prefixed with [botId] for instant identification.
 * 
 * @param {string} botId - e.g. "bot-delhi", "bot-punjab"
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(botId) {
  const prefix = `[${botId}]`;

  const pinoInstance = pino({ level: "info" }, transport);

  return {
    info:  (...args) => pinoInstance.info(`${prefix} ${args[0]}`, ...args.slice(1)),
    warn:  (...args) => pinoInstance.warn(`${prefix} ${args[0]}`, ...args.slice(1)),
    error: (...args) => pinoInstance.error(`${prefix} ${args[0]}`, ...args.slice(1)),
  };
}

/**
 * Backward compatibility: export default logger for OLD bot usage
 */
const defaultLogger = pino({ level: "info" }, transport);

export const log = {
  info:  (...args) => defaultLogger.info(...args),
  warn:  (...args) => defaultLogger.warn(...args),
  error: (...args) => defaultLogger.error(...args),
};

/**
 * Kills the process with a logged error.
 * @param {Error} err
 * @param {string} context
 */
export function panic(err, context = "fatal-error") {
  log.error({ err }, `[PANIC] ${context}`);
  process.exit(1);
}