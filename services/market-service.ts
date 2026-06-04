import { cacheGetOrSet } from "@/lib/cache";
import { DASHBOARD_SYMBOLS } from "@/lib/constants";
import { marketDataService } from "@/services/market-data/market-data.service";
import { dhanOptionChainService } from "@/services/dhan/dhanOptionChain";
import type { MarketSnapshot as ProviderMarketSnapshot, NormalizedTick } from "@/services/market-data/market-data.types";
import type { MarketOverviewCard, MarketTick, ScannerResult, ScannerSignal } from "@/types/market";

function formatIndexValue(value: number | null | undefined) {
  if (value === null || value === undefined || isNaN(value)) {
    return "0.00";
  }
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  });
}

function toMarketTick(tick: NormalizedTick | ProviderMarketSnapshot): MarketTick {
  return {
    exchange: tick.exchange,
    segment: tick.segment,
    symbol: tick.symbol,
    name: "companyName" in tick ? tick.companyName ?? tick.symbol : tick.symbol,
    price: tick.lastPrice,
    change: tick.change,
    changePercent: tick.changePercent,
    volume: tick.volume,
    high: tick.high,
    low: tick.low,
    open: tick.open,
    close: tick.close,
    direction: tick.changePercent > 0 ? "up" : tick.changePercent < 0 ? "down" : "flat",
    updatedAt: tick.timestamp,
    instrumentToken: tick.instrumentToken,
    source: tick.source,
    lastTradedQuantity: tick.lastTradedQuantity,
    averageTradedPrice: tick.averageTradedPrice,
    totalBuyQty: tick.totalBuyQty,
    totalSellQty: tick.totalSellQty,
    openInterest: tick.openInterest,
    bidPrice: tick.bidPrice,
    askPrice: tick.askPrice,
    bidQty: tick.bidQty,
    askQty: tick.askQty
  };
}

function buildMarketOverview(ticks: MarketTick[]): MarketOverviewCard[] {
  const bySymbol = new Map(ticks.map((tick) => [tick.symbol, tick]));
  const indexSymbols = ["NIFTY", "BANKNIFTY", "SENSEX"];

  // Use a type predicate so TypeScript narrows MarketTick | undefined → MarketTick
  // This eliminates the need for optional chaining on every property access below.
  return indexSymbols
    .map((symbol) => bySymbol.get(symbol))
    .filter((tick): tick is MarketTick => tick !== undefined)
    .map((tick) => ({
      label: tick.symbol === "BANKNIFTY" ? "BANK NIFTY" : tick.symbol === "NIFTY" ? "NIFTY 50" : "SENSEX",
      value: formatIndexValue(tick.price),
      change: `${tick.changePercent >= 0 ? "+" : ""}${tick.changePercent.toFixed(2)}%`,
      tone: tick.changePercent > 0 ? "positive" : tick.changePercent < 0 ? "negative" : "neutral"
    })) satisfies MarketOverviewCard[];
}

export async function getMarketSnapshot(symbols?: string[]) {
  const selectedSymbols = symbols?.length ? symbols : DASHBOARD_SYMBOLS;
  const key = `market:snapshot:${selectedSymbols.join(",")}`;

  return cacheGetOrSet(key, 3, async () => {
    const [providerTicks, providerHealth] = await Promise.all([
      marketDataService.getTicks(selectedSymbols),
      marketDataService.healthCheck()
    ]);
    const ticks = providerTicks.map(toMarketTick);

    return {
      overview: buildMarketOverview(ticks),
      ticks,
      providerHealth
    };
  });
}

function scannerResultFromTick(tick: NormalizedTick): ScannerResult {
  const absoluteMove = Math.abs(tick.changePercent);
  const range = Math.max(0.01, tick.high - tick.low);
  const closeLocation = Math.max(0, Math.min(1, (tick.lastPrice - tick.low) / range));
  const relativeVolume = tick.volume > 0 ? Math.max(0.5, Math.min(5, Math.log10(tick.volume + 1) / 2)) : 1;
  const momentumScore = Math.max(
    0,
    Math.min(100, Math.round(50 + tick.changePercent * 9 + (closeLocation - 0.5) * 24 + relativeVolume * 3))
  );
  const signal: ScannerSignal = momentumScore >= 58 ? "bullish" : momentumScore <= 42 ? "bearish" : "neutral";

  return {
    symbol: tick.symbol,
    company: tick.symbol,
    price: tick.lastPrice,
    changePercent: Number(tick.changePercent.toFixed(2)),
    volume: tick.volume,
    relativeVolume: Number(relativeVolume.toFixed(2)),
    momentumScore,
    signal,
    setup:
      absoluteMove >= 1.25
        ? signal === "bullish"
          ? "Live momentum expansion"
          : signal === "bearish"
            ? "Live downside expansion"
            : "Volatile range expansion"
        : closeLocation > 0.7
          ? "Trading near session high"
          : closeLocation < 0.3
            ? "Trading near session low"
            : "Range consolidation",
    sector: tick.segment === "INDEX" ? "Index" : tick.exchange
  };
}

function filterScannerResults(results: ScannerResult[], filters?: {
  strategy?: string;
  minRelativeVolume?: number;
  signal?: ScannerSignal | "all";
}) {
  return results.filter((result) => {
    if (filters?.signal && filters.signal !== "all" && result.signal !== filters.signal) {
      return false;
    }

    if (filters?.minRelativeVolume && result.relativeVolume < filters.minRelativeVolume) {
      return false;
    }

    if (!filters?.strategy || filters.strategy === "all") {
      return true;
    }

    if (filters.strategy === "volume") {
      return result.relativeVolume >= 2;
    }

    if (filters.strategy === "momentum") {
      return result.momentumScore >= 70;
    }

    if (filters.strategy === "breakout") {
      return result.relativeVolume >= 2.5 && result.momentumScore >= 75 && result.changePercent > 0;
    }

    if (filters.strategy === "gap") {
      return Math.abs(result.changePercent) >= 1.25;
    }

    if (filters.strategy === "reversal") {
      return result.relativeVolume >= 1.4 && result.momentumScore >= 55 && Math.abs(result.changePercent) < 1.2;
    }

    return result.signal === filters.strategy;
  });
}

export async function getAdvancedScannerResults(filters?: Parameters<typeof filterScannerResults>[1]) {
  const key = `scanner:${JSON.stringify(filters ?? {})}`;
  return cacheGetOrSet(key, 5, async () => {
    const ticks = await marketDataService.getTicks(DASHBOARD_SYMBOLS);
    return filterScannerResults(ticks.map(scannerResultFromTick), filters);
  });
}

function getUnavailableOptionsAnalytics(symbol = "NIFTY") {
  return {
    pcr: [],
    optionChain: [],
    overview: {
      totalCallOi: 0,
      totalPutOi: 0,
      maxPain: 0,
      maxOi: 0,
      sentiment: "DhanHQ option-chain unavailable",
      symbol,
      spotPrice: 0,
      expiry: "unavailable",
      expiries: [],
      source: "unavailable" as const,
      updatedAt: new Date().toISOString()
    }
  };
}

export async function getOptionsAnalytics(symbol = "NIFTY", expiry?: string | null) {
  try {
    return await dhanOptionChainService.getOptionChainAnalytics(symbol, expiry);
  } catch {
    return getUnavailableOptionsAnalytics(symbol);
  }
}
