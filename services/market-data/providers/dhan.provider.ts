import type {
  MarketDataProvider,
  MarketSnapshot,
  MarketSymbol,
  NormalizedTick,
  ProviderHealth
} from "@/services/market-data/market-data.types";
import { getSubscriptionKey } from "@/services/market-data/symbol-mapper.service";
import { getIndianMarketStatus, normalizeTick, toMarketSnapshot } from "@/services/market-data/tick-normalizer.service";
import { marketHistoryService } from "@/services/market-data/market-history.service";
import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";
import { dhanMarketQuoteService } from "@/services/dhan/dhanMarketQuote";
import { resolveDhanInstrumentForMarketSymbol } from "@/lib/dhan-symbols";

type DhanPacket = {
  type?: string;
  securityId?: string;
  ltp?: number;
  lastTradedQuantity?: number;
  volume?: number;
  atp?: number;
  open?: number;
  high?: number;
  low?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
  openInterest?: number;
  prevClose?: number;
  receivedAt?: string;
};

export class DhanDataProvider implements MarketDataProvider {
  private readonly callbacks = new Set<(tick: NormalizedTick) => void>();
  private readonly latestTicks = new Map<string, NormalizedTick>();
  private readonly symbolsBySecurityId = new Map<string, MarketSymbol>();
  private readonly prevCloseBySecurityId = new Map<string, number>();
  private connected = false;
  private unregister?: () => void;

  async connect() {
    await dhanMarketFeedService.ensureConnected();
    if (!this.unregister) {
      this.unregister = dhanMarketFeedService.onTick((packet) => this.handlePacket(packet as DhanPacket));
    }
    this.connected = true;
  }

  async disconnect() {
    this.unregister?.();
    this.unregister = undefined;
    await dhanMarketFeedService.disconnect();
    this.connected = false;
  }

  async subscribe(symbols: MarketSymbol[]) {
    const instruments: Array<{ ExchangeSegment: string; SecurityId: string }> = [];

    for (const symbol of symbols) {
      const instrument = resolveDhanInstrumentForMarketSymbol(symbol);
      if (!instrument) continue;
      this.symbolsBySecurityId.set(instrument.SecurityId, symbol);
      instruments.push(instrument);
    }

    if (instruments.length > 0) {
      await dhanMarketFeedService.subscribe(instruments, 17);
    }
  }

  async unsubscribe(symbols: MarketSymbol[]) {
    for (const symbol of symbols) {
      const key = getSubscriptionKey(symbol);
      this.latestTicks.delete(key);
    }
  }

  onTick(callback: (tick: NormalizedTick) => void) {
    this.callbacks.add(callback);
  }

  async getSnapshot(symbol: MarketSymbol): Promise<MarketSnapshot> {
    const [snapshot] = await this.getSnapshots([symbol]);
    return snapshot;
  }

  async getSnapshots(symbols: MarketSymbol[]): Promise<MarketSnapshot[]> {
    const snapshots = new Map<string, MarketSnapshot>();
    const missing: MarketSymbol[] = [];

    for (const symbol of symbols) {
      const key = getSubscriptionKey(symbol);
      const existing = this.latestTicks.get(key);
      if (existing) {
        snapshots.set(key, toMarketSnapshot(symbol, existing));
      } else {
        missing.push(symbol);
      }
    }

    if (missing.length > 0) {
      // Best-effort: a feed/subscribe failure must never throw out of the
      // read path. We still fall through to the REST quote API below so
      // ticks keep flowing even when the WebSocket feed is unavailable.
      await this.subscribe(missing).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const stillMissing: MarketSymbol[] = [];
    for (const symbol of missing) {
      const key = getSubscriptionKey(symbol);
      const maybeTick = this.latestTicks.get(key);
      if (maybeTick) {
        snapshots.set(key, toMarketSnapshot(symbol, maybeTick));
      } else {
        stillMissing.push(symbol);
      }
    }

    if (stillMissing.length > 0) {
      const quoteTicks = await dhanMarketQuoteService.getQuoteTicks(stillMissing).catch(() => []);
      for (const tick of quoteTicks) {
        const key = getSubscriptionKey(tick);
        this.latestTicks.set(key, tick);
        snapshots.set(key, toMarketSnapshot(tick, tick));
      }
    }

    const unresolved = symbols.filter((symbol) => !snapshots.has(getSubscriptionKey(symbol)));
    if (unresolved.length > 0) {
      // Warm history in background for larger batches; for small batches we
      // wait for one backfill pass so the dashboard can avoid 0/empty ticks.
      const historyFallback = unresolved.length <= 25
        ? await marketHistoryService.getLastKnownTicksWithBackfill(unresolved)
        : await marketHistoryService.getLastKnownTicks(unresolved);
      if (unresolved.length > 25) {
        marketHistoryService.ensureHistoryForSymbols(unresolved);
      }
      for (const symbol of unresolved) {
        const key = getSubscriptionKey(symbol);
        const tick = historyFallback.get(key);
        if (!tick) continue;
        this.latestTicks.set(key, tick);
        snapshots.set(key, toMarketSnapshot(symbol, tick));
      }
    }

    return symbols.map((symbol) => {
      const key = getSubscriptionKey(symbol);
      const snapshot = snapshots.get(key);
      if (snapshot) return snapshot;

      const empty = normalizeTick(
        symbol,
        {
          lastPrice: 0,
          close: 0,
          change: 0,
          changePercent: 0,
          volume: 0,
          averageTradedPrice: 0,
          open: 0,
          high: 0,
          low: 0,
          timestamp: new Date().toISOString()
        },
        "dhan:empty"
      );
      return toMarketSnapshot(symbol, empty);
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const status = dhanMarketFeedService.getStatus();
    return {
      provider: "dhan",
      status: status.connected ? "connected" : "degraded",
      checkedAt: new Date().toISOString(),
      message: status.lastError ?? undefined,
      marketStatus: getIndianMarketStatus(),
      circuitBreakerOpen: !status.connected
    };
  }

  private handlePacket(packet: DhanPacket) {
    const type = packet?.type ?? "";
    const securityId = packet?.securityId ?? "";
    if (!securityId) return;

    if (type === "prev_close" && typeof packet.prevClose === "number") {
      this.prevCloseBySecurityId.set(securityId, packet.prevClose);
      return;
    }

    if (type !== "index" && type !== "ticker" && type !== "quote" && type !== "full") return;
    if (typeof packet.ltp !== "number") return;

    const symbol = this.symbolsBySecurityId.get(securityId);
    if (!symbol) return;

    const close = this.prevCloseBySecurityId.get(securityId) ?? packet.ltp;
    const tick = normalizeTick(
      symbol,
      {
        lastPrice: packet.ltp,
        close,
        change: packet.ltp - close,
        changePercent: close > 0 ? ((packet.ltp - close) / close) * 100 : 0,
        volume: packet.volume ?? 0,
        averageTradedPrice: packet.atp ?? packet.ltp,
        lastTradedQuantity: packet.lastTradedQuantity,
        totalBuyQty: packet.totalBuyQty,
        totalSellQty: packet.totalSellQty,
        bidPrice: packet.bidPrice,
        askPrice: packet.askPrice,
        bidQty: packet.bidQty,
        askQty: packet.askQty,
        open: packet.open ?? close,
        high: packet.high ?? packet.ltp,
        low: packet.low ?? packet.ltp,
        openInterest: packet.openInterest,
        timestamp: packet.receivedAt ?? new Date().toISOString()
      },
      "dhan"
    );

    const key = getSubscriptionKey(symbol);
    this.latestTicks.set(key, tick);
    for (const callback of this.callbacks) {
      callback(tick);
    }
  }
}
