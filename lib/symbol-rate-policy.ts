function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const SYMBOL_RATE_LIMITS = {
  registry: {
    limit: numberFromEnv("SYMBOL_REGISTRY_RATE_LIMIT", 240),
    windowMs: numberFromEnv("SYMBOL_REGISTRY_RATE_WINDOW_MS", 60_000)
  },
  search: {
    limit: numberFromEnv("SYMBOL_SEARCH_RATE_LIMIT", 90),
    windowMs: numberFromEnv("SYMBOL_SEARCH_RATE_WINDOW_MS", 60_000)
  },
  liveTable: {
    limit: numberFromEnv("SYMBOL_LIVE_TABLE_RATE_LIMIT", 90),
    windowMs: numberFromEnv("SYMBOL_LIVE_TABLE_RATE_WINDOW_MS", 60_000)
  }
} as const;
