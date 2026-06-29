/**
 * Minimal structured logger. Zero dependencies.
 * Set QUARRY_LOG=debug for verbose output; defaults to info.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = ORDER[(process.env.QUARRY_LOG as Level) ?? "info"] ?? 1;

export interface ILogger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export function createLogger(scope: string): ILogger {
  const emit = (level: Level, msg: string, meta?: unknown) => {
    if (ORDER[level] < threshold) return;
    const line = `[${level.toUpperCase()}] ${scope}: ${msg}`;
    const stream =
      level === "error" || level === "warn" ? console.error : console.log;
    meta === undefined ? stream(line) : stream(line, meta);
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}
