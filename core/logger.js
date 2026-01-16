import pino from "pino";

const transport = pino.transport({
  target: "pino-pretty",
  options: { translateTime: true, colorize: true }
});

export const log = pino({ level: "info" }, transport);

export function panic(err, context = "fatal-error") {
  log.error({ err }, `[PANIC] ${context}`);
  process.exit(1);
}
