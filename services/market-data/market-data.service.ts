import { logger } from "@/lib/logger";
import { DhanDataProvider } from "@/services/market-data/providers/dhan.provider";
import { getMarketDataConfig } from "@/services/market-data/market-data.config";
import { marketCacheService } from "@/services/market-data/market-cache.service";
import type {
  MarketDataProvider,
  MarketDataProviderKey,
  MarketSnapshot,
  MarketSymbol,
  NormalizedTick,
  ProviderHealth
} from "@/services/market-data/market-data.types";
import {
  InvalidMarketSymbolError,
  MarketProviderUnavailableError
} from "@/services/market-data/market-data.types";
import { SubscriptionManagerService } from "@/services/market-data/subscription-manager.service";
import { getIndianMarketStatus } from "@/services/market-data/tick-normalizer.service";
import { marketHistoryService } from "@/services/market-data/market-history.service";
import { getSegmentKey, getSubscriptionKey, resolveMarketSymbol, resolveMarketSymbolAsync, searchMarketSymbols } from "@/services/market-data/symbol-mapper.service";

function createProvider(provider: MarketDataProviderKey): MarketDataProvider {
  if (provider === "dhan") {
    return new DhanDataProvider();
  }

  return new DhanDataProvider();
}

export class MarketDataService {
  private readonly config = getMarketDataConfig();
  private readonly provider = createProvider(this.config.provider);
  private readonly subscriptionManager = new SubscriptionManagerService(this.provider);
  private readonly tickListeners = new Set<(tick: NormalizedTick) => void>();
  private connectPromise: Promise<void> | null = null;
  private connected = false;

  constructor() {
    this.provider.onTick((tick) => {
      void this.handleTick(tick);
    });
  }

  async connect() {
    if (this.connected) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.provider
        .connect()
        .then(async () => {
          this.connected = true;
          await this.writeHealth();
        })
        .catch(async (error) => {
          // Connection failure is expected and fully handled: reads fall back
          // to cache + REST quote API and the feed self-heals. Log at warn
          // (not console.error, which Next's dev overlay escalates into a
          // blocking error dialog) and never rethrow — a transient provider
          // hiccup must not break SSR pages.
          this.connected = false;
          await this.writeHealth(error instanceof Error ? error.message : "Provider connection failed.");
          logger.warn(`[MarketDataService] ${this.config.provider} connect degraded`, {
            message: error instanceof Error ? error.message : String(error)
          });
        })
        .finally(() => {
          this.connectPromise = null;
        });
    }

    await this.connectPromise;
  }

  async disconnect() {
    await this.provider.disconnect();
    this.connected = false;
    await marketCacheService.disconnect();
  }

  async subscribe(inputs: string[]) {
    const symbols = await this.resolveInputs(inputs);
    await this.ensureAllowedSegments(symbols);
    await this.connect();
    return this.subscriptionManager.subscribe(symbols);
  }

  async unsubscribe(inputs: string[]) {
    const symbols = await this.resolveInputs(inputs);
    await this.connect();
    return this.subscriptionManager.unsubscribe(symbols);
  }

  async getSnapshot(input: string, exchange?: "NSE" | "BSE"): Promise<MarketSnapshot> {
    const symbol = resolveMarketSymbol(input, exchange);

    if (!symbol) {
      throw new InvalidMarketSymbolError(input);
    }

    await this.ensureAllowedSegments([symbol]);

    const cached = await marketCacheService.getSnapshot(symbol);

    if (cached) {
      return cached;
    }

    await this.connect();
    await this.subscriptionManager.subscribe([symbol]);

    const snapshot = await this.provider.getSnapshot(symbol);
    await marketCacheService.setSnapshot(snapshot);
    await marketCacheService.setLatestTick(snapshot);

    return snapshot;
  }

  async getTicks(inputs: string[]) {
    const symbols = await this.resolveInputs(inputs);
    await this.ensureAllowedSegments(symbols);
    marketHistoryService.ensureHistoryForSymbols(symbols);
    // Connecting/subscribing the live feed is best-effort for reads: if the
    // WebSocket can't connect (token/clientId/network), we must still serve
    // ticks from cache + the REST quote API instead of failing the request
    // and tearing down the live UI. The feed self-heals in the background.
    await this.connect().catch(() => undefined);
    await this.subscriptionManager.subscribe(symbols).catch(() => undefined);

    if (this.provider.getSnapshots) {
      const cachedOrMissing: MarketSymbol[] = [];
      const ticks = new Map<string, NormalizedTick>();

      for (const symbol of symbols) {
        const cached = await marketCacheService.getLatestTick(symbol);
        if (cached) {
          ticks.set(getSubscriptionKey(symbol), cached);
        } else {
          cachedOrMissing.push(symbol);
        }
      }

      if (cachedOrMissing.length > 0) {
        const snapshots = await this.provider.getSnapshots(cachedOrMissing);
        for (const snapshot of snapshots) {
          ticks.set(getSubscriptionKey(snapshot), snapshot);
          await marketCacheService.setLatestTick(snapshot);
          await marketCacheService.setSnapshot(snapshot);
        }
      }

      return symbols.map((symbol) => ticks.get(getSubscriptionKey(symbol))).filter(Boolean) as NormalizedTick[];
    }

    return Promise.all(
      symbols.map(async (symbol) => {
        const cached = await marketCacheService.getLatestTick(symbol);

        if (cached) {
          return cached;
        }

        return this.provider.getSnapshot(symbol);
      })
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    const health = await this.provider.healthCheck().catch((error) => ({
      provider: this.config.provider,
      status: "error" as const,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "Health check failed.",
      circuitBreakerOpen: true
    }));
    await marketCacheService.setProviderHealth(health);
    return health;
  }

  getActiveSubscriptions() {
    return this.subscriptionManager.getActiveSubscriptionKeys();
  }

  searchSymbols(query: string) {
    return searchMarketSymbols(query);
  }

  onTick(callback: (tick: NormalizedTick) => void) {
    this.tickListeners.add(callback);

    return () => {
      this.tickListeners.delete(callback);
    };
  }

  private async handleTick(tick: NormalizedTick) {
    await marketCacheService.setLatestTick(tick);
    await marketCacheService.setSnapshot({
      ...tick,
      marketStatus: getIndianMarketStatus()
    });
    marketHistoryService.trackLiveTick(tick);
    
    const { redis } = await import("@/lib/redis");
    await redis.publish("MARKET:TICK", JSON.stringify(tick)).catch(() => null);

    this.tickListeners.forEach((callback) => callback(tick));
  }

  private async resolveInputs(inputs: string[]) {
    const unique = new Map<string, MarketSymbol>();

    const cleaned = inputs.map((value) => value.trim()).filter(Boolean);
    const resolved = await Promise.all(
      cleaned.map((input) => resolveMarketSymbolAsync(input).catch(() => null))
    );

    for (const symbol of resolved) {
      // Skip symbols that cannot be resolved (e.g. not in the Dhan scrip
      // master) instead of throwing — one unknown symbol must never fail
      // an entire batch request and break the live feed for every symbol.
      if (!symbol) continue;
      unique.set(getSubscriptionKey(symbol), symbol);
    }

    return Array.from(unique.values());
  }

  private async ensureAllowedSegments(symbols: MarketSymbol[]) {
    const blocked = symbols.find((symbol) => !this.config.allowedSegments.includes(getSegmentKey(symbol)));

    if (blocked) {
      throw new MarketProviderUnavailableError(
        `${getSubscriptionKey(blocked)} is outside MARKET_DATA_ALLOWED_SEGMENTS.`
      );
    }
  }

  private async writeHealth(message?: string) {
    const health = await this.healthCheck();
    await marketCacheService.setProviderHealth({
      ...health,
      message: message ?? health.message
    });
  }
}

const globalForMarketData = globalThis as unknown as {
  marketDataService?: MarketDataService;
};

export const marketDataService = globalForMarketData.marketDataService ?? new MarketDataService();

if (process.env.NODE_ENV !== "production") {
  globalForMarketData.marketDataService = marketDataService;
}
