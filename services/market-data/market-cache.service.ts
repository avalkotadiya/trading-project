import Redis from "ioredis";
import { getCache, getCacheProviderName, setCache } from "@/lib/cache";
import type { MarketSnapshot, MarketSymbol, NormalizedTick, ProviderHealth } from "@/services/market-data/market-data.types";

const DEFAULT_TICK_TTL_SECONDS = 30;
const DEFAULT_SNAPSHOT_TTL_SECONDS = 30;
const DEFAULT_SUBSCRIPTION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_HEALTH_TTL_SECONDS = 60;

let redisClient: Redis | null = null;

function getRedisClient() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      connectTimeout: 1000,
      commandTimeout: 1000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy() {
        return null;
      }
    });

    redisClient.on("error", () => {
      // Fall back to in-memory cache when Redis is not reachable locally.
    });
  }

  return redisClient;
}

async function ensureRedisConnected(client: Redis) {
  if (client.status === "wait" || client.status === "end") {
    await client.connect();
  }
}

async function readJson<T>(key: string): Promise<T | null> {
  const client = getRedisClient();

  if (client) {
    try {
      await ensureRedisConnected(client);
      const value = await client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  return getCache<T>(key);
}

async function writeJson<T>(key: string, value: T, ttlSeconds: number) {
  const client = getRedisClient();

  if (client) {
    try {
      await ensureRedisConnected(client);
      await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch {
      return;
    }
  }

  await setCache(key, value, ttlSeconds);
}

export function getMarketTickCacheKey(symbol: Pick<MarketSymbol, "exchange" | "symbol">) {
  return `market:tick:${symbol.exchange}:${symbol.symbol}`;
}

export function getMarketSnapshotCacheKey(symbol: Pick<MarketSymbol, "exchange" | "symbol">) {
  return `market:snapshot:${symbol.exchange}:${symbol.symbol}`;
}

export class MarketCacheService {
  getProviderName() {
    return process.env.REDIS_URL ? "redis" : getCacheProviderName();
  }

  async setLatestTick(tick: NormalizedTick, ttlSeconds = DEFAULT_TICK_TTL_SECONDS) {
    await writeJson(getMarketTickCacheKey(tick), tick, ttlSeconds);
  }

  async getLatestTick(symbol: Pick<MarketSymbol, "exchange" | "symbol">) {
    return readJson<NormalizedTick>(getMarketTickCacheKey(symbol));
  }

  async getLatestTicks(symbols: Array<Pick<MarketSymbol, "exchange" | "symbol">>) {
    return Promise.all(symbols.map((symbol) => this.getLatestTick(symbol)));
  }

  async setLatestTicks(ticks: NormalizedTick[], ttlSeconds = DEFAULT_TICK_TTL_SECONDS) {
    await Promise.all(ticks.map((tick) => this.setLatestTick(tick, ttlSeconds)));
  }

  async setSnapshot(snapshot: MarketSnapshot, ttlSeconds = DEFAULT_SNAPSHOT_TTL_SECONDS) {
    await writeJson(getMarketSnapshotCacheKey(snapshot), snapshot, ttlSeconds);
  }

  async setSnapshots(snapshots: MarketSnapshot[], ttlSeconds = DEFAULT_SNAPSHOT_TTL_SECONDS) {
    await Promise.all(snapshots.map((snapshot) => this.setSnapshot(snapshot, ttlSeconds)));
  }

  async getSnapshot(symbol: Pick<MarketSymbol, "exchange" | "symbol">) {
    return readJson<MarketSnapshot>(getMarketSnapshotCacheKey(symbol));
  }

  async setActiveSubscriptions(symbols: string[], ttlSeconds = DEFAULT_SUBSCRIPTION_TTL_SECONDS) {
    await writeJson("market:subscriptions", Array.from(new Set(symbols)).sort(), ttlSeconds);
  }

  async getActiveSubscriptions() {
    return readJson<string[]>("market:subscriptions");
  }

  async setProviderHealth(health: ProviderHealth, ttlSeconds = DEFAULT_HEALTH_TTL_SECONDS) {
    await writeJson("market:provider:health", health, ttlSeconds);
  }

  async getProviderHealth() {
    return readJson<ProviderHealth>("market:provider:health");
  }

  async disconnect() {
    if (redisClient) {
      await redisClient.quit().catch(() => null);
      redisClient = null;
    }
  }
}

export const marketCacheService = new MarketCacheService();
