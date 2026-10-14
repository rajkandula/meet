/**
 * Structured logger that works in any runtime.
 *
 * The sink is the console, which every host collects. Each entry is a single
 * JSON line so log tools can filter on level/scope/fields.
 *
 * Usage:
 *   const log = createLogger("api/meetings");
 *   log.info("meeting created", { meetingId, ownerId });
 *   log.error("mongodb query failed", { error });
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Context keys that must never reach the logs verbatim. */
const SECRET_KEY_PATTERN = /token|secret|password|authorization|cookie|credential|apikey|api_key/i;

function threshold(): number {
  // Read per call, so LOG_LEVEL changes apply without a restart during local
  // development.
  const configured = (process.env.LOG_LEVEL || "").toLowerCase() as Level;
  return LEVEL_WEIGHT[configured] ?? LEVEL_WEIGHT.info;
}

/** Errors don't JSON.stringify to anything useful, so flatten them first. */
function describeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack?.split("\n").slice(0, 5).join("\n") };
  }
  return { message: String(error) };
}

/** Mongo URIs embed credentials (`mongodb+srv://user:pass@...`) — strip them. */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/(\w+:\/\/)([^@/\s]+)@/g, "$1<redacted>@");
  return value;
}

function sanitize(context: Record<string, unknown> | undefined) {
  if (!context) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (SECRET_KEY_PATTERN.test(key)) clean[key] = "<redacted>";
    else if (key === "error") clean.error = describeError(value);
    else clean[key] = redactValue(value);
  }
  return clean;
}

export type Logger = {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export function createLogger(scope: string): Logger {
  function write(level: Level, message: string, context?: Record<string, unknown>) {
    if (LEVEL_WEIGHT[level] < threshold()) return;
    const entry = { time: new Date().toISOString(), level, scope, message, ...sanitize(context) };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
