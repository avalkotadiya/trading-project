/**
 * Structured JSON logger for server-side use.
 * Outputs newline-delimited JSON to stdout/stderr — compatible with
 * Vercel log drains, Datadog, and any log aggregation pipeline.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function shouldRedactKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key")
  );
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      shouldRedactKey(key) ? "[REDACTED]" : redactValue(entry)
    ])
  );
}

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") {
    return env;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function emit(entry: LogEntry) {
  if (process.env.NODE_ENV === "test") return;
  if (LEVEL_RANK[entry.level] < LEVEL_RANK[getMinLevel()]) return;

  const line = JSON.stringify(entry);
  if (entry.level === "warn" || entry.level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  emit({ level, message, context: context ? (redactValue(context) as Record<string, unknown>) : undefined, timestamp: new Date().toISOString() });
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context)
};
