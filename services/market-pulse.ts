import type { NormalizedTick } from "@/services/market-data/market-data.types";
import type { MarketTick } from "@/types/market";
import type { MarketPulseCategory, MarketPulseSignal, StockSignal } from "@/types/market-pulse";

export const MARKET_PULSE_SYMBOLS = [
  // Indices
  "NSE:NIFTY",
  "NSE:BANKNIFTY",
  "BSE:SENSEX",
  // Financials
  "NSE:HDFCBANK",
  "NSE:ICICIBANK",
  "NSE:SBIN",
  "NSE:AXISBANK",
  "NSE:KOTAKBANK",
  "NSE:BAJFINANCE",
  "NSE:BAJAJFINSV",
  // IT
  "NSE:TCS",
  "NSE:INFY",
  "NSE:WIPRO",
  "NSE:HCLTECH",
  "NSE:TECHM",
  // Energy & Commodities
  "NSE:RELIANCE",
  "NSE:ONGC",
  "NSE:TATASTEEL",
  "NSE:HINDALCO",
  "NSE:JSWSTEEL",
  // Consumer & Auto
  "NSE:MARUTI",
  "NSE:TITAN",
  "NSE:ITC",
  "NSE:TATAMOTORS",
  "NSE:NESTLEIND",
  // Pharma
  "NSE:SUNPHARMA",
  "NSE:DRREDDY",
  // Infra / Telecom
  "NSE:LT",
  "NSE:BHARTIARTL",
  "NSE:POWERGRID",
];

const COMPANY_NAMES: Record<string, string> = {
  NIFTY: "Nifty 50 Index",
  BANKNIFTY: "Bank Nifty Index",
  SENSEX: "BSE Sensex",
  RELIANCE: "Reliance Industries Ltd",
  HDFCBANK: "HDFC Bank Ltd",
  ICICIBANK: "ICICI Bank Ltd",
  INFY: "Infosys Ltd",
  TCS: "Tata Consultancy Services Ltd",
  ITC: "ITC Ltd",
  BHARTIARTL: "Bharti Airtel Ltd",
  SBIN: "State Bank of India",
  LT: "Larsen & Toubro Ltd",
  AXISBANK: "Axis Bank Ltd",
  KOTAKBANK: "Kotak Mahindra Bank Ltd",
  BAJFINANCE: "Bajaj Finance Ltd",
  BAJAJFINSV: "Bajaj Finserv Ltd",
  MARUTI: "Maruti Suzuki India Ltd",
  SUNPHARMA: "Sun Pharmaceutical Industries Ltd",
  DRREDDY: "Dr. Reddy's Laboratories Ltd",
  TATASTEEL: "Tata Steel Ltd",
  JSWSTEEL: "JSW Steel Ltd",
  HINDALCO: "Hindalco Industries Ltd",
  ONGC: "Oil & Natural Gas Corp Ltd",
  WIPRO: "Wipro Ltd",
  HCLTECH: "HCL Technologies Ltd",
  TECHM: "Tech Mahindra Ltd",
  TATAMOTORS: "Tata Motors Ltd",
  NESTLEIND: "Nestle India Ltd",
  POWERGRID: "Power Grid Corp of India Ltd",
  TITAN: "Titan Company Ltd",
};

type PulseTick = {
  symbol: string;
  companyName: string;
  exchange: string;
  segment?: string;
  price: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open?: number;
  close?: number;
  updatedAt: string;
  totalBuyQty?: number;
  totalSellQty?: number;
  source?: string;
};

type BuildPulseOptions = {
  segment?: string;
  direction?: string;
  sortBy?: string;
  search?: string;
  page?: number;
  limit?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isNormalizedTick(tick: MarketTick | NormalizedTick): tick is NormalizedTick {
  return "lastPrice" in tick;
}

function toPulseTick(tick: MarketTick | NormalizedTick): PulseTick {
  if (isNormalizedTick(tick)) {
    return {
      symbol: tick.symbol,
      companyName: COMPANY_NAMES[tick.symbol] ?? tick.symbol,
      exchange: tick.exchange,
      segment: tick.segment,
      price: tick.lastPrice,
      changePercent: tick.changePercent,
      volume: tick.volume,
      high: tick.high,
      low: tick.low,
      open: tick.open,
      close: tick.close,
      updatedAt: tick.timestamp,
      totalBuyQty: tick.totalBuyQty,
      totalSellQty: tick.totalSellQty,
      source: tick.source
    };
  }

  return {
    symbol: tick.symbol,
    companyName: COMPANY_NAMES[tick.symbol] ?? tick.name ?? tick.symbol,
    exchange: tick.exchange ?? "NSE",
    segment: tick.segment,
    price: tick.price,
    changePercent: tick.changePercent,
    volume: tick.volume,
    high: tick.high,
    low: tick.low,
    open: tick.open,
    close: tick.close,
    updatedAt: tick.updatedAt,
    totalBuyQty: tick.totalBuyQty,
    totalSellQty: tick.totalSellQty,
    source: tick.source
  };
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Live";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function signalFromScore(score: number): MarketPulseSignal {
  if (score >= 58) return "bullish";
  if (score <= 42) return "bearish";
  return "neutral";
}

function flowScore(tick: PulseTick) {
  const buy = tick.totalBuyQty ?? 0;
  const sell = tick.totalSellQty ?? 0;
  if (buy <= 0 && sell <= 0) return 0;
  return clamp(((buy - sell) / Math.max(1, buy + sell)) * 35, -35, 35);
}

function rangePosition(tick: PulseTick) {
  const range = tick.high - tick.low;
  if (!Number.isFinite(range) || range <= 0) return 0.5;
  return clamp((tick.price - tick.low) / range, 0, 1);
}

// Cross-sectional context computed once per scan over the whole universe.
// This is what makes "relative volume" and "relative strength" meaningful —
// a stock is only unusually active relative to its peers in the same scan.
type UniverseStats = {
  logVolMean: number;
  logVolStd: number;
  sortedChange: number[]; // ascending % change, for percentile rank
};

function buildUniverseStats(ticks: PulseTick[]): UniverseStats {
  const logVols: number[] = [];
  const changes: number[] = [];
  for (const t of ticks) {
    if (Number.isFinite(t.price) && Number.isFinite(t.changePercent)) {
      logVols.push(Math.log10(Math.max(10, t.volume)));
      changes.push(t.changePercent);
    }
  }
  const n = logVols.length || 1;
  const logVolMean = logVols.reduce((s, v) => s + v, 0) / n;
  const variance = logVols.reduce((s, v) => s + (v - logVolMean) ** 2, 0) / n;
  return {
    logVolMean,
    logVolStd: Math.sqrt(variance) || 1,
    sortedChange: [...changes].sort((a, b) => a - b)
  };
}

// Volume z-score → an intuitive "x times normal" relative-volume proxy
// (RVOL ≈ 1 is average, > 2 is heavy participation). Spec: volume_zscore.
function relativeVolume(tick: PulseTick, stats: UniverseStats) {
  if (tick.volume <= 0) return 1;
  const z = (Math.log10(Math.max(10, tick.volume)) - stats.logVolMean) / stats.logVolStd;
  return Number(clamp(1 + z * 0.8 + Math.max(0, z) * 0.4, 0.1, 9.99).toFixed(2));
}

// Percentile rank of the stock's % change vs the scanned universe (0-100).
// Spec: relative_strength_score.
function relativeStrength(changePercent: number, stats: UniverseStats) {
  const arr = stats.sortedChange;
  if (arr.length === 0) return 50;
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < changePercent) lo = mid + 1;
    else hi = mid;
  }
  return Number(((lo / arr.length) * 100).toFixed(1));
}

// Money-flux: net order-flow imbalance amplified by participation. Spec:
// money_flux_score (-100 heavy distribution … +100 heavy accumulation).
function moneyFlux(tick: PulseTick, rvol: number) {
  const buy = tick.totalBuyQty ?? 0;
  const sell = tick.totalSellQty ?? 0;
  const imbalance = buy + sell > 0 ? (buy - sell) / (buy + sell) : Math.sign(tick.changePercent) * 0.25;
  return Number(clamp(imbalance * 60 * clamp(rvol, 0.5, 3), -100, 100).toFixed(1));
}

function buildSignalPercent(
  tick: PulseTick,
  category: MarketPulseCategory,
  rvol: number,
  rs: number
) {
  const momentum = clamp(tick.changePercent * 9, -38, 38);
  const position = (rangePosition(tick) - 0.5) * 34;
  const flow = flowScore(tick);
  // Relative-volume conviction replaces the old raw log-volume term: a move
  // on 3x volume is far more significant than the same move on thin volume.
  const volumeConviction = clamp((rvol - 1) * 12, -10, 30);
  const strengthBias = (rs - 50) * 0.18;

  if (category === "breakout-beacon") {
    return clamp(50 + momentum * 0.5 + position * 0.9 + volumeConviction * 0.7 + flow * 0.25 + strengthBias, 1, 99);
  }

  if (category === "intraday-boost") {
    return clamp(50 + momentum * 0.85 + volumeConviction * 0.9 + flow * 0.35 + strengthBias, 1, 99);
  }

  if (category === "top-level") {
    return clamp(50 + position * 1.1 + Math.max(0, momentum) * 0.7 + volumeConviction * 0.4 + flow * 0.2, 1, 99);
  }

  return clamp(50 - position * 1.1 + Math.max(0, -momentum) * 0.7 + volumeConviction * 0.3 - flow * 0.2, 1, 99);
}

function patternFor(category: MarketPulseCategory, signal: MarketPulseSignal) {
  if (category === "breakout-beacon") return signal === "bullish" ? "Resistance breakout" : signal === "bearish" ? "Support breakdown" : "Range watch";
  if (category === "intraday-boost") return signal === "bullish" ? "Buying pressure" : signal === "bearish" ? "Selling pressure" : "Momentum pause";
  if (category === "top-level") return "Near day high";
  return "Near day low";
}

export function buildMarketPulseSignals(
  ticks: Array<MarketTick | NormalizedTick>,
  category: MarketPulseCategory,
  options: BuildPulseOptions = {}
): { data: StockSignal[]; total: number } {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(1000, Math.max(1, options.limit ?? 30));
  const direction = (options.direction ?? "all").toLowerCase();
  const segment = options.segment ?? "All";
  const search = (options.search ?? "").trim().toLowerCase();
  const sortBy = options.sortBy ?? "Strongest Signal %";

  // Single pass: normalise + filter once, derive cross-sectional context
  // once, then map. Avoids re-walking the universe per metric.
  const pulseTicks: PulseTick[] = [];
  for (const raw of ticks) {
    const t = toPulseTick(raw);
    if (Number.isFinite(t.price) && Number.isFinite(t.changePercent)) pulseTicks.push(t);
  }
  const stats = buildUniverseStats(pulseTicks);

  let signals: StockSignal[] = pulseTicks.map((tick) => {
    const rvol = relativeVolume(tick, stats);
    const rs = relativeStrength(tick.changePercent, stats);
    const signalPercent = Number(buildSignalPercent(tick, category, rvol, rs).toFixed(2));
    const signal = signalFromScore(signalPercent);
    const flux = moneyFlux(tick, rvol);
    const rFactor = Number(
      clamp(
        Math.abs(tick.changePercent) * 0.9 + (rvol - 1) * 1.1 + Math.abs(flux) / 30,
        0.5,
        9.99
      ).toFixed(2)
    );
    const pos = rangePosition(tick);
    const rangePct = Number(
      (tick.high > 0 && tick.high > tick.low ? ((tick.high - tick.low) / tick.price) * 100 : 0).toFixed(2)
    );

    return {
      symbol: tick.symbol,
      companyName: tick.companyName,
      exchange: tick.exchange,
      logoUrl: "",
      price: Number(tick.price.toFixed(2)),
      volume: tick.volume,
      volumeMultiplier: rvol,
      percentChange: Number(tick.changePercent.toFixed(2)),
      signalPercent,
      time: formatTime(tick.updatedAt),
      signal,
      signalIcon: signal === "bullish" ? "bull" : signal === "bearish" ? "bear" : "neutral",
      rFactor,
      rFactorChange: Number(clamp(rFactor * 7 + Math.abs(tick.changePercent) * 3, 0, 99).toFixed(2)),
      pattern: patternFor(category, signal),
      isBookmarked: false,
      category,
      source: tick.source ?? "market-data",
      relativeVolume: rvol,
      relativeStrength: rs,
      moneyFlux: flux,
      rangePct,
      coiled: rangePct > 0 && rangePct < 0.9 && rvol < 1.1,
      nearDayHigh: pos >= 0.92,
      nearDayLow: pos <= 0.08
    } satisfies StockSignal;
  });

  if (category === "top-level") {
    signals = signals.filter((signal) => signal.signalPercent >= 48 || signal.percentChange >= 0);
  } else if (category === "low-level") {
    signals = signals.filter((signal) => signal.signalPercent >= 48 || signal.percentChange <= 0);
  }

  if (search) {
    signals = signals.filter((signal) => signal.symbol.toLowerCase().includes(search) || signal.companyName.toLowerCase().includes(search));
  }

  if (segment !== "All") {
    if (segment === "F&O") {
      signals = signals.filter((signal) => !["NIFTY", "BANKNIFTY", "SENSEX"].includes(signal.symbol));
    } else if (segment === "Nifty 50") {
      signals = signals.filter((signal) => signal.exchange === "NSE");
    } else if (segment === "Bank Nifty") {
      signals = signals.filter((signal) => ["BANKNIFTY", "HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK"].includes(signal.symbol));
    } else {
      signals = signals.filter((signal) => signal.exchange === segment);
    }
  }

  if (direction !== "all") {
    signals = signals.filter((signal) => signal.signal === direction);
  }

  if (sortBy === "Highest % Change") {
    signals.sort((a, b) => b.percentChange - a.percentChange);
  } else if (sortBy === "Lowest % Change") {
    signals.sort((a, b) => a.percentChange - b.percentChange);
  } else if (sortBy === "Latest Time") {
    signals.sort((a, b) => b.time.localeCompare(a.time));
  } else if (sortBy === "R-Factor") {
    signals.sort((a, b) => b.rFactor - a.rFactor);
  } else {
    signals.sort((a, b) => b.signalPercent - a.signalPercent);
  }

  const total = signals.length;
  const start = (page - 1) * limit;
  return { data: signals.slice(start, start + limit), total };
}
