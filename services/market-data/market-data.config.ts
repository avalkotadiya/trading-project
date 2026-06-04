import type { MarketDataProviderKey } from "@/services/market-data/market-data.types";
import {
  DHAN_CHART_EXCHANGE_SEGMENTS,
  type DhanChartExchangeSegment
} from "@/services/dhan/dhanChartValidation";

type SegmentKey = DhanChartExchangeSegment;

type ProviderCredentials = {
  apiKey?: string;
  apiSecret?: string;
  apiUrl?: string;
  wsUrl?: string;
};

export type MarketDataConfig = {
  provider: MarketDataProviderKey;
  allowedSegments: SegmentKey[];
  redisUrl?: string;
  credentials: {
    dhan: ProviderCredentials;
  };
};

const defaultAllowedSegments: SegmentKey[] = [...DHAN_CHART_EXCHANGE_SEGMENTS];

function readAllowedSegments() {
  const configured = process.env.MARKET_DATA_ALLOWED_SEGMENTS?.split(",")
    .map((segment) => segment.trim())
    .filter(Boolean) as SegmentKey[] | undefined;

  return configured?.length ? configured : defaultAllowedSegments;
}

function normalizeProvider(value: string | undefined): MarketDataProviderKey {
  const normalized = value?.toLowerCase().replace(/[-_]/g, "");

  if (normalized === "dhan" || normalized === "dhanhq") return "dhan";

  // Default to Dhan provider for paid/live market data.
  return "dhan";
}

function buildMarketDataConfig(): MarketDataConfig {
  return {
    provider: normalizeProvider(process.env.MARKET_DATA_PROVIDER),
    allowedSegments: readAllowedSegments(),
    redisUrl: process.env.REDIS_URL,
    credentials: {
      dhan: {
        apiKey: process.env.DHAN_API_KEY || "",
        apiSecret: process.env.DHAN_API_SECRET || "",
        apiUrl: process.env.DHAN_API_BASE_URL || "https://api.dhan.co/v2",
        wsUrl: process.env.DHAN_WS_URL || "wss://api-feed.dhan.co"
      }
    }
  };
}

let _config: MarketDataConfig | null = null;

export function getMarketDataConfig(): MarketDataConfig {
  return (_config ??= buildMarketDataConfig());
}

export function resetMarketDataConfig() {
  _config = null;
}

export function shouldRequireMarketDataAuth() {
  return true;
}

export function getMissingCredentialKeys(provider: MarketDataProviderKey) {
  const config = getMarketDataConfig();
  const credentials = config.credentials[provider as keyof typeof config.credentials];

  if (!credentials) return [];

  if (provider === "dhan") {
    return [
      ["DHAN_CLIENT_ID", process.env.DHAN_CLIENT_ID],
      ["DHAN_ACCESS_TOKEN", process.env.DHAN_ACCESS_TOKEN]
    ]
      .filter(([, value]) => !value)
      .map(([key]) => String(key));
  }

  return [];
}
