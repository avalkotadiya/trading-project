function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const DHAN_LIVE_FEED_LIMITS = {
  maxConnections: numberFromEnv("DHAN_WS_MAX_CONNECTIONS", 5),
  instrumentsPerConnection: numberFromEnv("DHAN_WS_INSTRUMENTS_PER_CONNECTION", 5_000),
  instrumentsPerSubscribeMessage: numberFromEnv("DHAN_WS_INSTRUMENTS_PER_MESSAGE", 100)
} as const;

export const DHAN_MAX_LIVE_FEED_INSTRUMENTS =
  DHAN_LIVE_FEED_LIMITS.maxConnections * DHAN_LIVE_FEED_LIMITS.instrumentsPerConnection;

export const DHAN_MARKET_DEPTH_LIMITS = {
  fullDepthInstrumentsPerMessage: numberFromEnv("DHAN_FULL_DEPTH_INSTRUMENTS_PER_MESSAGE", 50),
  marketDepth200InstrumentsPerConnection: numberFromEnv("DHAN_200_DEPTH_INSTRUMENTS_PER_CONNECTION", 1)
} as const;

export const UI_SYMBOL_LIMITS = {
  liveTablePageSize: numberFromEnv("UI_LIVE_TABLE_PAGE_SIZE", 120),
  symbolPickerResults: numberFromEnv("UI_SYMBOL_PICKER_RESULTS", 80),
  registryPageSize: numberFromEnv("UI_SYMBOL_REGISTRY_PAGE_SIZE", 500)
} as const;
