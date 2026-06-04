import type {
  MarketSessionState,
  MarketSnapshot,
  MarketSymbol,
  NormalizedTick
} from "@/services/market-data/market-data.types";

type RawTickInput = Partial<Omit<NormalizedTick, "exchange" | "segment" | "symbol" | "instrumentToken" | "source">> & {
  ltp?: number;
  price?: number;
};

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

export function getIndianMarketStatus(now = new Date()): MarketSessionState {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const totalMinutes = hour * 60 + minute;

  if (weekday === "Sat" || weekday === "Sun") {
    return "closed";
  }

  if (totalMinutes >= 9 * 60 && totalMinutes < 9 * 60 + 15) {
    return "preopen";
  }

  if (totalMinutes >= 9 * 60 + 15 && totalMinutes <= 15 * 60 + 30) {
    return "open";
  }

  if (totalMinutes > 15 * 60 + 30 && totalMinutes <= 16 * 60) {
    return "postclose";
  }

  return "closed";
}

export function normalizeTick(symbol: MarketSymbol, raw: RawTickInput, source: string): NormalizedTick {
  const lastPrice = Number(raw.lastPrice ?? raw.ltp ?? raw.price ?? raw.close ?? 0);
  const close = Number(raw.close ?? lastPrice);
  const change = Number.isFinite(raw.change) ? Number(raw.change) : lastPrice - close;
  const changePercent = Number.isFinite(raw.changePercent)
    ? Number(raw.changePercent)
    : close > 0
      ? (change / close) * 100
      : 0;

  return {
    exchange: symbol.exchange,
    segment: symbol.segment,
    symbol: symbol.symbol,
    instrumentToken: symbol.instrumentToken,
    lastPrice: round(lastPrice),
    change: round(change),
    changePercent: round(changePercent),
    volume: Math.max(0, Math.round(Number(raw.volume ?? 0))),
    averageTradedPrice: round(Number(raw.averageTradedPrice ?? lastPrice)),
    open: round(Number(raw.open ?? close)),
    high: round(Math.max(Number(raw.high ?? lastPrice), lastPrice)),
    low: round(Math.min(Number(raw.low ?? lastPrice), lastPrice)),
    close: round(close),
    lastTradedQuantity: raw.lastTradedQuantity === undefined ? undefined : Math.max(0, Math.round(Number(raw.lastTradedQuantity))),
    totalBuyQty: raw.totalBuyQty === undefined ? undefined : Math.max(0, Math.round(Number(raw.totalBuyQty))),
    totalSellQty: raw.totalSellQty === undefined ? undefined : Math.max(0, Math.round(Number(raw.totalSellQty))),
    bidPrice: raw.bidPrice === undefined ? undefined : round(Number(raw.bidPrice)),
    askPrice: raw.askPrice === undefined ? undefined : round(Number(raw.askPrice)),
    bidQty: raw.bidQty === undefined ? undefined : Math.max(0, Math.round(Number(raw.bidQty))),
    askQty: raw.askQty === undefined ? undefined : Math.max(0, Math.round(Number(raw.askQty))),
    openInterest: raw.openInterest === undefined ? undefined : Math.max(0, Math.round(Number(raw.openInterest))),
    timestamp: raw.timestamp ?? new Date().toISOString(),
    source
  };
}

export function toMarketSnapshot(symbol: MarketSymbol, tick: NormalizedTick): MarketSnapshot {
  return {
    ...tick,
    marketStatus: getIndianMarketStatus(),
    companyName: symbol.companyName
  };
}
