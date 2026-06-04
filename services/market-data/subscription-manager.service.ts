import type { MarketDataProvider, MarketSymbol } from "@/services/market-data/market-data.types";
import { marketCacheService, type MarketCacheService } from "@/services/market-data/market-cache.service";
import { getSubscriptionKey } from "@/services/market-data/symbol-mapper.service";

export class SubscriptionManagerService {
  private activeSubscriptions = new Map<string, MarketSymbol>();

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly cache: MarketCacheService = marketCacheService
  ) {}

  async subscribe(symbols: MarketSymbol[]) {
    const newSymbols = symbols.filter((symbol) => !this.activeSubscriptions.has(getSubscriptionKey(symbol)));

    if (newSymbols.length === 0) {
      return this.getActiveSubscriptions();
    }

    await this.provider.subscribe(newSymbols);

    for (const symbol of newSymbols) {
      this.activeSubscriptions.set(getSubscriptionKey(symbol), symbol);
    }

    await this.persist();
    return this.getActiveSubscriptions();
  }

  async unsubscribe(symbols: MarketSymbol[]) {
    const existingSymbols = symbols.filter((symbol) => this.activeSubscriptions.has(getSubscriptionKey(symbol)));

    if (existingSymbols.length === 0) {
      return this.getActiveSubscriptions();
    }

    await this.provider.unsubscribe(existingSymbols);

    for (const symbol of existingSymbols) {
      this.activeSubscriptions.delete(getSubscriptionKey(symbol));
    }

    await this.persist();
    return this.getActiveSubscriptions();
  }

  getActiveSubscriptions() {
    return Array.from(this.activeSubscriptions.values());
  }

  getActiveSubscriptionKeys() {
    return Array.from(this.activeSubscriptions.keys()).sort();
  }

  private async persist() {
    await this.cache.setActiveSubscriptions(this.getActiveSubscriptionKeys());
  }
}
