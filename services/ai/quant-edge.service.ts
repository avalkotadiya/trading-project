import { getCache, setCache } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { getMarketSnapshot } from "@/services/market-service";
import {
  dhanHistoricalDataService,
  isDhanHistoricalRateLimitError
} from "@/services/dhan/dhanHistoricalData";
import { normalizeDhanChartInstrument } from "@/services/dhan/dhanChartValidation";
import { getSectionSymbols } from "@/services/symbols/symbol-registry";
import { DHAN_DASHBOARD_INSTRUMENTS } from "@/lib/dhan-symbols";
import type { Candle } from "@/types/ai-trading";
import { lastRsi, macd, adx, bollinger, obv, composite } from "@/services/ai/indicators";

/**
 * Quant-Edge model
 * -----------------
 * A deterministic, statistics-driven replacement for the old heuristic
 * scoring. For each equity it pulls ~1 year of daily candles, derives
 * trend / volatility / mean-reversion measures, then *backtests* a
 * trend-pullback rule over that history to estimate the real edge:
 *
 *   win probability p, payoff ratio b = avgWin / avgLoss,
 *   expected value  EV% = p·avgWin − (1−p)·avgLoss   (per trade)
 *   Half-Kelly      f   = 0.5 · max(0, p − (1−p)/b)
 *
 * Stops / targets are volatility-scaled (ATR) so risk is consistent
 * across symbols. The bot only trades when EV% clears the user gate and
 * the live bar is currently in the same setup the backtest measured.
 */

// Strategy constants (kept fixed — fewer knobs, more robust).
const LOOKBACK_DAYS = 300;
const WARMUP = 55;
const ATR_LEN = 14;
const STOP_ATR = 1.5;
const TARGET_ATR = 3.0;
const MAX_HOLD_BARS = 8;
const Z_LOW = -2.5;
const Z_HIGH = -0.3;
const MIN_SAMPLES = 10;
// Full-universe scans (thousands of symbols) need a longer cache window so
// the cycle ticker isn't waiting on a cold rebuild every 15 min. Override
// with QUANT_EDGE_CACHE_SECONDS in env.
const EDGE_HOT_CACHE_SECONDS = Number(process.env.QUANT_EDGE_CACHE_SECONDS || "1800");
const EDGE_STALE_CACHE_SECONDS = Math.max(
  EDGE_HOT_CACHE_SECONDS,
  Number(process.env.QUANT_EDGE_STALE_CACHE_SECONDS || "21600")
);
const EDGE_FAST_MODE = (process.env.QUANT_EDGE_FAST_MODE ?? "true").toLowerCase() !== "false";
// How many symbols to fetch in parallel. The Dhan REST throttle in
// dhanHistoricalData.ts is the actual rate governor, so higher numbers don't
// translate to higher Dhan load — this is just batch granularity for progress
// logs and per-batch error isolation.
const SCAN_CHUNK = Math.max(1, Number(process.env.QUANT_EDGE_CHUNK || "8"));
// Hard ceiling on universe size. Dhan's per-minute quota for historical data
// is 100/min — at our sustained ~1.5 req/s × 2 endpoints per symbol, a full
// fresh scan of N symbols takes roughly N seconds. Default 200 keeps cold
// scans closer to 3-4 min; subsequent scans within 6 h hit cache. Raise only
// if you're willing
// to wait longer for the first scan after deploy.
const MAX_UNIVERSE = Math.max(50, Number(process.env.QUANT_EDGE_MAX_UNIVERSE || "200"));
// Intraday context is optional. When false, the bot uses the daily-close-only
// signal pipeline, which is half the Dhan REST traffic and still produces
// valid daily-trend signals. Intraday is OFF by default for speed; set
// QUANT_EDGE_USE_INTRADAY=true to re-enable it.
const USE_INTRADAY = (process.env.QUANT_EDGE_USE_INTRADAY ?? "false").toLowerCase() !== "false";
const EDGE_CACHE_KEY = "quant:edge:v9:hot";
const EDGE_STALE_CACHE_KEY = "quant:edge:v9:stale";

export type EdgeSignal = {
  symbol: string;
  price: number;
  inSetup: boolean;
  edgePct: number; // expected value % per trade
  winProb: number; // 0-100
  payoff: number; // avgWin / avgLoss
  kelly: number; // suggested fraction of equity (half-Kelly, capped at 1)
  sampleSize: number;
  atr: number;
  stopPrice: number;
  targetPrice: number;
  trendUp: boolean;
  zScore: number;
  momentum: number; // 20-day price return %
  rvol: number; // latest volume / 20-day average volume
  intradayMomentum: number; // latest intraday return %
  intradayTrendUp: boolean;
  intradayPullback: boolean;
  // Bot v2 — multi-indicator stack and blended quality score
  rsi14: number;
  macdHist: number;
  adx14: number;
  plusDi: number;
  minusDi: number;
  bbPctB: number;
  obvSlope: number;
  compositeScore: number; // 0-100, drives Kelly multiplier
  scoreParts: Record<string, number>; // per-factor scores, for the UI
  reasons: string[];
};

// Internal type carries SMA/stdev so getEdgeSignals can recompute z-score from live price.
type EdgeSignalRaw = EdgeSignal & { sma20: number; sd20: number };
type EdgeStalePayload = { generatedAt: number; signals: EdgeSignal[] };

let edgeRefreshInFlight: Promise<EdgeSignal[]> | null = null;
let lastDhanRateLimitLogAt = 0;

// ---------------------------------------------------------------------------
// Progressive scan feed
// ---------------------------------------------------------------------------
// Subscribers receive every signal as it's computed instead of waiting for the
// full universe scan to finish. Used by /api/bot/signals/stream (SSE) so the
// UI can render symbols incrementally during a 30-60 min cold full-universe scan.
// In-process only; multi-instance deployments would need a Redis pub/sub bridge.

export type EdgeScanStatus = {
  scanning: boolean;
  processed: number;
  total: number;
  kept: number;
  dropped: number;
  startedAt: number | null;
  finishedAt: number | null;
};

let currentScanStatus: EdgeScanStatus = {
  scanning: false,
  processed: 0,
  total: 0,
  kept: 0,
  dropped: 0,
  startedAt: null,
  finishedAt: null
};

const signalListeners = new Set<(signal: EdgeSignal) => void>();
const statusListeners = new Set<(status: EdgeScanStatus) => void>();

function emitSignal(signal: EdgeSignal) {
  for (const fn of signalListeners) {
    try { fn(signal); } catch { /* listener errors must not break the scan */ }
  }
}

function emitStatus() {
  const snapshot = { ...currentScanStatus };
  for (const fn of statusListeners) {
    try { fn(snapshot); } catch { /* listener errors must not break the scan */ }
  }
}

export function subscribeEdgeSignals(listener: (signal: EdgeSignal) => void): () => void {
  signalListeners.add(listener);
  return () => signalListeners.delete(listener);
}

export function subscribeEdgeScanStatus(listener: (status: EdgeScanStatus) => void): () => void {
  statusListeners.add(listener);
  // Push current status immediately so a fresh subscriber doesn't sit blank
  // until the next emission.
  try { listener({ ...currentScanStatus }); } catch { /* ignore */ }
  return () => statusListeners.delete(listener);
}

export function getEdgeScanStatus(): EdgeScanStatus {
  return { ...currentScanStatus };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function stdev(xs: number[], over: number, end: number): number {
  const start = Math.max(0, end - over + 1);
  const slice = xs.slice(start, end + 1);
  if (slice.length < 2) return 0;
  const m = mean(slice);
  return Math.sqrt(mean(slice.map((x) => (x - m) ** 2)));
}

function sma(xs: number[], over: number, end: number): number {
  const start = Math.max(0, end - over + 1);
  return mean(xs.slice(start, end + 1));
}

function emaSeries(xs: number[], len: number): number[] {
  const k = 2 / (len + 1);
  const out: number[] = [];
  let prev = xs[0] ?? 0;
  for (let i = 0; i < xs.length; i++) {
    prev = i === 0 ? xs[0] : xs[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function atrSeries(c: Candle[], len: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) {
      tr.push(c[i].high - c[i].low);
      continue;
    }
    const prevClose = c[i - 1].close;
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - prevClose), Math.abs(c[i].low - prevClose)));
  }
  // Wilder smoothing
  const out: number[] = [];
  let prev = mean(tr.slice(0, len));
  for (let i = 0; i < tr.length; i++) {
    prev = i < len ? mean(tr.slice(0, i + 1)) : (prev * (len - 1) + tr[i]) / len;
    out.push(prev);
  }
  return out;
}

type Stats = {
  p: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  edgePct: number;
  kelly: number;
  samples: number;
};

function backtest(c: Candle[], ema20: number[], ema50: number[], atr: number[]): Stats {
  const closes = c.map((x) => x.close);
  let samples = 0;
  let wins = 0;
  let losses = 0;
  let sumWin = 0;
  let sumLoss = 0;
  let i = WARMUP;

  while (i < c.length - 1) {
    const trendUp = ema20[i] > ema50[i] && closes[i] > ema50[i];
    // Backtest must match the runtime entry rule, otherwise its EV / Kelly
    // numbers describe a strategy we never actually execute. v3 runtime
    // trades any uptrend, so the backtest enters on every trend-up bar
    // (still non-overlapping via i += MAX_HOLD_BARS so trades don't compound).
    const inSetup = trendUp;
    if (!inSetup || atr[i] <= 0) {
      i += 1;
      continue;
    }

    const entry = closes[i];
    const stop = entry - STOP_ATR * atr[i];
    const target = entry + TARGET_ATR * atr[i];
    let exitRet: number | null = null;

    for (let j = i + 1; j <= Math.min(c.length - 1, i + MAX_HOLD_BARS); j++) {
      if (c[j].low <= stop) {
        exitRet = ((stop - entry) / entry) * 100;
        break;
      }
      if (c[j].high >= target) {
        exitRet = ((target - entry) / entry) * 100;
        break;
      }
      if (j === Math.min(c.length - 1, i + MAX_HOLD_BARS)) {
        exitRet = ((c[j].close - entry) / entry) * 100;
      }
    }

    if (exitRet !== null) {
      samples += 1;
      if (exitRet > 0) {
        wins += 1;
        sumWin += exitRet;
      } else {
        losses += 1;
        sumLoss += Math.abs(exitRet);
      }
      i += MAX_HOLD_BARS; // non-overlapping trades
    } else {
      i += 1;
    }
  }

  const p = samples ? wins / samples : 0;
  const avgWin = wins ? sumWin / wins : 0;
  const avgLoss = losses ? sumLoss / losses : 0;
  const payoff = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 3 : 0;
  const edgePct = p * avgWin - (1 - p) * avgLoss;
  const rawKelly = payoff > 0 ? p - (1 - p) / payoff : 0;
  const kelly = clamp(0.5 * rawKelly, 0, 1); // half-Kelly

  return {
    p,
    avgWin: Number(avgWin.toFixed(3)),
    avgLoss: Number(avgLoss.toFixed(3)),
    payoff: Number(payoff.toFixed(2)),
    edgePct: Number(edgePct.toFixed(3)),
    kelly: Number(kelly.toFixed(4)),
    samples
  };
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function marketDate() {
  return MARKET_DATE_FORMATTER.format(new Date());
}

function logDhanHistoryFailure(symbol: string, error: unknown, scope: "daily" | "intraday") {
  const message = error instanceof Error ? error.message : "unknown";
  if (!isDhanHistoricalRateLimitError(error)) {
    logger.warn(`[QuantEdge] ${symbol} Dhan ${scope} history failed: ${message}`);
    return;
  }

  const now = Date.now();
  if (now - lastDhanRateLimitLogAt > 120_000) {
    lastDhanRateLimitLogAt = now;
    logger.warn(
      `[QuantEdge] Dhan historical quota reached (${message}); shared throttle is cooling down and remaining symbols will be skipped quietly.`
    );
  }
}

async function buildIntradayContext(inst: UniverseInstrument) {
  if (!USE_INTRADAY) return null;
  try {
    const today = marketDate();
    const raw = await dhanHistoricalDataService.intraday({
      securityId: inst.SecurityId,
      exchangeSegment: inst.exchangeSegment,
      instrument: inst.instrument,
      interval: process.env.BOT_INTRADAY_INTERVAL || "5",
      fromDate: today,
      toDate: today
    });
    const candles = dhanHistoricalDataService.normalizeCandles(raw).filter((c) => c.close > 0);
    if (candles.length < 24) return null;

    const closes = candles.map((c) => c.close);
    const ema9 = emaSeries(closes, 9);
    const ema21 = emaSeries(closes, 21);
    const last = candles.length - 1;
    const sd = stdev(closes, 20, last);
    const z = sd > 0 ? (closes[last] - sma(closes, 20, last)) / sd : 0;
    const trendUp = ema9[last] > ema21[last] && closes[last] > ema21[last];
    const pullback = trendUp && z >= -1.8 && z <= -0.15;
    const open = candles[0].open || closes[0];
    const intradayMomentum = open > 0 ? ((closes[last] - open) / open) * 100 : 0;
    const avgVol20 = mean(candles.slice(Math.max(0, last - 19), last + 1).map((c) => c.volume));
    const latestVol = candles[last].volume;

    return {
      price: closes[last],
      intradayMomentum: Number(intradayMomentum.toFixed(2)),
      intradayTrendUp: trendUp,
      intradayPullback: pullback,
      intradayRvol: avgVol20 > 0 ? Number((latestVol / avgVol20).toFixed(2)) : 0,
      intradayZ: Number(z.toFixed(2))
    };
  } catch (error) {
    logDhanHistoryFailure(inst.symbol, error, "intraday");
    return null;
  }
}

async function buildEdgeForSymbol(
  inst: UniverseInstrument,
  fromDate: string,
  toDate: string
): Promise<EdgeSignalRaw | null> {
  // Dhan is the single source of truth. The historical-data service applies
  // a token-bucket throttle + per-request caching so this call is safe to
  // fan out across the whole universe without tripping DH-904 rate limits.
  let candles: Candle[] = [];
  try {
    const raw = await dhanHistoricalDataService.daily({
      securityId: inst.SecurityId,
      exchangeSegment: inst.exchangeSegment,
      instrument: inst.instrument,
      fromDate,
      toDate
    });
    candles = dhanHistoricalDataService.normalizeCandles(raw);
  } catch (error) {
    // F&O strikes, expired contracts, commodity back-months etc. routinely
    // fail Dhan history with 404. Rate-limit failures are shared quota events,
    // so log them once per cooldown window instead of once per symbol.
    logDhanHistoryFailure(inst.symbol, error, "daily");
  }

  if (candles.length < WARMUP + 20) {
    // Quiet skip — at full-universe scale this is the common case for
    // non-equity instruments and would otherwise drown the log.
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const atr = atrSeries(candles, ATR_LEN);

  const stats = backtest(candles, ema20, ema50, atr);

  const last = candles.length - 1;
  const dailyClose = closes[last];
  const trendUpDaily = ema20[last] > ema50[last] && dailyClose > ema50[last];
  // Fast path: intraday is the most expensive side-call; only fetch it for
  // symbols already in a daily uptrend where it can change execution quality.
  const intraday = trendUpDaily ? await buildIntradayContext(inst) : null;
  const lastClose = intraday?.price && intraday.price > 0 ? intraday.price : closes[last];
  const lastAtr = atr[last] || stdev(closes, 20, last) || lastClose * 0.01;
  const sd = stdev(closes, 20, last);
  const z = sd > 0 ? (lastClose - sma(closes, 20, last)) / sd : 0;
  const trendUp = ema20[last] > ema50[last] && lastClose > ema50[last];
  const dailyPullback = trendUp && z >= Z_LOW && z <= Z_HIGH;
  // v3: any uptrend qualifies as "in setup" — the composite score (RSI +
  // MACD + ADX + BB + OBV + EV) does the real quality filtering downstream,
  // gated at botMinCompositeScore (45 by default). The old "trend-pullback
  // only" rule was so narrow that 0-1 symbols qualified on most days, which
  // made the bot appear broken even when it was wired correctly.
  const inSetup = trendUp || Boolean(intraday?.intradayPullback);

  // Extra context factors (computed from the candles already in hand).
  const volumes = candles.map((c) => c.volume);
  const momoBase = closes[last - 20];
  const momentum =
    momoBase && momoBase > 0 ? Number((((lastClose - momoBase) / momoBase) * 100).toFixed(2)) : 0;
  const avgVol20 = mean(volumes.slice(Math.max(0, last - 19), last + 1));
  const rvolDaily = avgVol20 > 0 ? Number((volumes[last] / avgVol20).toFixed(2)) : 0;
  const rvol = Math.max(rvolDaily, intraday?.intradayRvol ?? 0);

  // --- Advanced indicator stack (v2) -----------------------------------
  // All read from the same candle series — one DB/Dhan fetch, many signals.
  // Computed AFTER we know lastClose so we can splice it onto the closes
  // array for indicators that should react to the live price (RSI/MACD/BB).
  const liveCloses = lastClose !== closes[last] ? [...closes.slice(0, -1), lastClose] : closes;
  const rsiVal = lastRsi(liveCloses);
  const macdR = macd(liveCloses);
  const adxR = adx(candles);
  const bbR = bollinger(liveCloses);
  const obvR = obv(candles);

  const compR = composite({
    edgePct: stats.edgePct,
    winProb: stats.p * 100,
    payoff: stats.payoff,
    rsi14: rsiVal,
    macdHist: macdR.histogram,
    macdHistSlope: macdR.histogramSlope,
    adx14: adxR.adx,
    plusDi: adxR.plusDi,
    minusDi: adxR.minusDi,
    bbPctB: bbR.pctB,
    obvSlope: obvR.slope,
    rvol
  });

  const reasons: string[] = [];
  if (trendUp) reasons.push("Uptrend (EMA20>EMA50)");
  if (dailyPullback) reasons.push(`Daily pullback z=${z.toFixed(2)}`);
  if (intraday?.intradayPullback) reasons.push(`Intraday pullback z=${intraday.intradayZ.toFixed(2)}`);
  if (intraday?.intradayTrendUp) reasons.push(`Intraday trend ${intraday.intradayMomentum.toFixed(2)}%`);
  if (stats.samples >= MIN_SAMPLES) reasons.push(`${stats.samples} backtested trades`);
  reasons.push(`Win ${(stats.p * 100).toFixed(0)}% · payoff ${stats.payoff}R`);
  // Indicator highlights (only the ones earning their keep, to keep chips tight).
  if (rsiVal >= 35 && rsiVal <= 55) reasons.push(`RSI ${rsiVal.toFixed(0)} (sweet spot)`);
  else if (rsiVal > 70) reasons.push(`RSI ${rsiVal.toFixed(0)} (overbought)`);
  if (macdR.histogram > 0 && macdR.histogramSlope > 0) reasons.push("MACD↑ accelerating");
  else if (macdR.histogram < 0) reasons.push("MACD↓ weak");
  if (adxR.adx >= 20 && adxR.plusDi > adxR.minusDi) reasons.push(`ADX ${adxR.adx.toFixed(0)} +DI`);
  else if (adxR.adx < 15) reasons.push(`ADX ${adxR.adx.toFixed(0)} (chop)`);
  if (obvR.confirmsTrend && obvR.slope > 0) reasons.push("OBV confirms");
  else if (obvR.slope < 0 && trendUp) reasons.push("OBV divergence");
  reasons.push(`Score ${compR.score}/100`);

  return {
    symbol: inst.symbol,
    price: Number(lastClose.toFixed(2)),
    inSetup,
    edgePct: stats.edgePct,
    winProb: Number((stats.p * 100).toFixed(1)),
    payoff: stats.payoff,
    kelly: stats.kelly,
    sampleSize: stats.samples,
    atr: Number(lastAtr.toFixed(2)),
    stopPrice: Number((lastClose - STOP_ATR * lastAtr).toFixed(2)),
    targetPrice: Number((lastClose + TARGET_ATR * lastAtr).toFixed(2)),
    trendUp,
    zScore: Number(z.toFixed(2)),
    momentum,
    rvol,
    intradayMomentum: intraday?.intradayMomentum ?? 0,
    intradayTrendUp: intraday?.intradayTrendUp ?? false,
    intradayPullback: intraday?.intradayPullback ?? false,
    rsi14: Number(rsiVal.toFixed(1)),
    macdHist: Number(macdR.histogram.toFixed(3)),
    adx14: Number(adxR.adx.toFixed(1)),
    plusDi: Number(adxR.plusDi.toFixed(1)),
    minusDi: Number(adxR.minusDi.toFixed(1)),
    bbPctB: Number(bbR.pctB.toFixed(3)),
    obvSlope: Number(obvR.slope.toFixed(4)),
    compositeScore: compR.score,
    scoreParts: compR.parts,
    reasons,
    sma20: sma(closes, 20, last),
    sd20: sd
  };
}

// What the per-symbol pipeline needs to fetch history + intraday. Threaded
// through from getEdgeSignals so the universe can come from anywhere.
type UniverseInstrument = {
  symbol: string;
  SecurityId: string;
  exchangeSegment: string;
  instrument: string;
};

/**
 * Build the bot's tradeable universe.
 *
 * Modes (QUANT_EDGE_UNIVERSE env):
 *   - "curated"  — 55 hand-picked DHAN_DASHBOARD_INSTRUMENTS. ~40s cold, ~5s warm.
 *                  Best for development / first-run demos.
 *   - "registry" — same as "curated" surface scope but pulled from the registry's
 *                  bot-universe view, hard-capped at MAX_UNIVERSE (default 200).
 *                  Back-compat shim — prefer "full" for production scans.
 *   - "full"     — every tradeable symbol the registry knows: equities + ETFs +
 *                  front-month futures/options/commodity/currency (no indices).
 *                  Typically 3-6k symbols depending on master freshness. Cold
 *                  scan takes ~30-60 min under Dhan's 100/min historical quota;
 *                  subsequent scans hit the per-symbol candle cache (6h) so they
 *                  complete in seconds. Hard cap raised to QUANT_EDGE_MAX_UNIVERSE
 *                  (default 10000) to admit the full set.
 *
 * Bot's downstream code already handles 404s for illiquid / expired contracts,
 * so feeding a wide universe is safe — the rate limiter just paces the scan.
 */
async function buildFullUniverse(): Promise<UniverseInstrument[]> {
  const mode = (process.env.QUANT_EDGE_UNIVERSE || "full").toLowerCase();

  if (mode === "curated") {
    // Curated path — fast, all liquid. Drop INDEX entries (indices are signal-only;
    // the broker rejects buy orders on them, so they waste a Dhan history call).
    const curated: UniverseInstrument[] = DHAN_DASHBOARD_INSTRUMENTS
      .filter((i) => i.segment !== "INDEX")
      .map((i) => ({
        symbol: i.symbol,
        SecurityId: i.SecurityId,
        exchangeSegment: i.ExchangeSegment,
        instrument: normalizeDhanChartInstrument(i.segment === "EQ" ? "EQUITY" : i.segment, i.ExchangeSegment)
      }));
    logger.info(`[QuantEdge] universe = curated (${curated.length} symbols)`);
    return curated;
  }

  // "full" and "registry" both pull from bot-universe; difference is the cap.
  const view = await getSectionSymbols("bot-universe");
  const cap = mode === "full"
    ? Math.max(MAX_UNIVERSE, Number(process.env.QUANT_EDGE_MAX_UNIVERSE || "10000"))
    : MAX_UNIVERSE;
  const out: UniverseInstrument[] = view.symbols.slice(0, cap).map((r) => ({
    symbol: r.symbol,
    SecurityId: r.securityId,
    exchangeSegment: r.exchangeSegment,
    instrument: r.chartInstrument
  }));
  if (view.symbols.length > cap) {
    logger.warn(
      `[QuantEdge] universe capped at ${cap} (registry had ${view.symbols.length}; raise QUANT_EDGE_MAX_UNIVERSE to admit more).`
    );
  }
  logger.info(`[QuantEdge] universe = ${mode} (${out.length} symbols)`);
  return out;
}

async function scanEdgeSignals(): Promise<EdgeSignal[]> {
  const universe = await buildFullUniverse();
  if (universe.length === 0) {
    throw new Error("empty universe from Dhan instrument master");
  }

  // Live prices overlay the (slightly stale) daily close so stops/targets
  // reflect the current market. Bulk-snapshot the EQUITY subset only - F&O /
  // COMM / CURR don't share the same symbol->quote endpoint.
  const equitySymbols = universe
    .filter((u) => u.exchangeSegment === "NSE_EQ" || u.exchangeSegment === "BSE_EQ")
    .map((u) => `${u.exchangeSegment === "BSE_EQ" ? "BSE" : "NSE"}:${u.symbol}`);
  const livePrice = new Map<string, number>();
  try {
    const snap = await getMarketSnapshot(equitySymbols);
    for (const t of snap.ticks) if (t.price > 0) livePrice.set(t.symbol, t.price);
    logger.info(`[QuantEdge] Dhan live prices resolved for ${livePrice.size}/${equitySymbols.length} equities`);
  } catch (error) {
    logger.warn(
      `[QuantEdge] Dhan price snapshot failed: ${error instanceof Error ? error.message : "unknown"} - using daily close as live`
    );
  }

  const out: EdgeSignalRaw[] = [];
  let processed = 0;
  let dropped = 0;
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 86_400_000);
  const fromDate = fmtDate(from);
  const toDate = fmtDate(to);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(universe.length, SCAN_CHUNK));

  // Initialise scan status + announce start to subscribers (SSE consumers etc.)
  currentScanStatus = {
    scanning: true,
    processed: 0,
    total: universe.length,
    kept: 0,
    dropped: 0,
    startedAt: Date.now(),
    finishedAt: null
  };
  emitStatus();

  // Incremental cache write: every PARTIAL_CACHE_EVERY signals we persist the
  // current sorted set to the hot cache so /api/bot/state polling sees the list
  // grow during a long scan. Throttled to avoid Redis hammering.
  const PARTIAL_CACHE_EVERY = Math.max(10, Number(process.env.QUANT_EDGE_PARTIAL_CACHE_EVERY || "25"));
  let lastPartialCacheAt = 0;
  const flushPartialCache = async () => {
    const now = Date.now();
    if (now - lastPartialCacheAt < 1500) return; // also rate-limit by time
    lastPartialCacheAt = now;
    const partial = [...out].sort(
      (a, b) => b.compositeScore - a.compositeScore || b.edgePct - a.edgePct
    );
    try {
      await setCache(EDGE_CACHE_KEY, partial, EDGE_HOT_CACHE_SECONDS);
    } catch {
      // cache write failures are non-fatal — SSE consumers still get live events
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= universe.length) return;
        const inst = universe[idx];
        const sig = await buildEdgeForSymbol(inst, fromDate, toDate).catch((e) => {
          logger.warn(`[QuantEdge] ${inst.symbol} threw: ${e instanceof Error ? e.message : "unknown"}`);
          return null;
        });

        processed += 1;
        if (!sig) {
          dropped += 1;
        } else {
          const live = livePrice.get(sig.symbol);
          if (live && live > 0) {
            const k = sig.atr;
            sig.price = live;
            sig.stopPrice = Number((live - STOP_ATR * k).toFixed(2));
            sig.targetPrice = Number((live + TARGET_ATR * k).toFixed(2));
            if (sig.sd20 > 0) {
              const liveZ = (live - sig.sma20) / sig.sd20;
              sig.zScore = Number(liveZ.toFixed(2));
            }
            sig.inSetup = sig.trendUp;
          }
          out.push(sig);
          emitSignal(sig);
        }

        // Push the latest status to every subscriber after each symbol so the
        // UI's progress bar moves continuously rather than in big chunks.
        currentScanStatus = {
          scanning: true,
          processed,
          total: universe.length,
          kept: out.length,
          dropped,
          startedAt: currentScanStatus.startedAt,
          finishedAt: null
        };
        emitStatus();

        if (sig && processed % PARTIAL_CACHE_EVERY === 0) {
          void flushPartialCache();
        }

        if (processed % 500 === 0 && processed > 0) {
          logger.info(
            `[QuantEdge] scan progress: ${processed}/${universe.length} (${out.length} kept, ${dropped} skipped)`
          );
        }
      }
    })
  );
  logger.info(`[QuantEdge] scan complete: ${out.length} signals from ${universe.length} symbols (${dropped} skipped)`);

  out.sort((a, b) => b.compositeScore - a.compositeScore || b.edgePct - a.edgePct);

  currentScanStatus = {
    scanning: false,
    processed,
    total: universe.length,
    kept: out.length,
    dropped,
    startedAt: currentScanStatus.startedAt,
    finishedAt: Date.now()
  };
  emitStatus();

  if (out.length === 0) throw new Error("no signals produced (Dhan history unavailable)");
  return out;
}

function parseStalePayload(input: EdgeStalePayload | EdgeSignal[] | null): EdgeStalePayload | null {
  if (!input) return null;
  if (Array.isArray(input)) return { generatedAt: Date.now(), signals: input };
  if (!Array.isArray(input.signals)) return null;
  return {
    generatedAt: Number(input.generatedAt) || Date.now(),
    signals: input.signals
  };
}

async function writeEdgeCaches(signals: EdgeSignal[]) {
  await Promise.all([
    setCache(EDGE_CACHE_KEY, signals, EDGE_HOT_CACHE_SECONDS),
    setCache<EdgeStalePayload>(
      EDGE_STALE_CACHE_KEY,
      { generatedAt: Date.now(), signals },
      EDGE_STALE_CACHE_SECONDS
    )
  ]);
}

async function refreshEdgeSignals(): Promise<EdgeSignal[]> {
  if (edgeRefreshInFlight) return edgeRefreshInFlight;
  edgeRefreshInFlight = (async () => {
    const signals = await scanEdgeSignals();
    await writeEdgeCaches(signals);
    return signals;
  })();

  try {
    return await edgeRefreshInFlight;
  } finally {
    edgeRefreshInFlight = null;
  }
}

function kickBackgroundRefresh(reason: string) {
  if (edgeRefreshInFlight) return;
  logger.info(`[QuantEdge] background refresh triggered (${reason})`);
  void refreshEdgeSignals().catch((error) => {
    logger.warn(`[QuantEdge] background refresh failed: ${error instanceof Error ? error.message : "unknown"}`);
  });
}

export async function getEdgeSignals(): Promise<EdgeSignal[]> {
  try {
    const hot = await getCache<EdgeSignal[]>(EDGE_CACHE_KEY);
    if (hot && hot.length > 0) return hot;

    const staleRaw = await getCache<EdgeStalePayload | EdgeSignal[]>(EDGE_STALE_CACHE_KEY);
    const stale = parseStalePayload(staleRaw);
    if (EDGE_FAST_MODE && stale && stale.signals.length > 0) {
      const ageSec = Math.max(0, Math.floor((Date.now() - stale.generatedAt) / 1000));
      kickBackgroundRefresh(`stale cache hit (${ageSec}s old)`);
      return stale.signals;
    }

    return await refreshEdgeSignals();
  } catch (error) {
    logger.warn(
      `[QuantEdge] edge scan produced no signals: ${error instanceof Error ? error.message : "unknown"}`
    );
    return [];
  }
}

export async function getCachedEdgeSignals(options: { warmIfMissing?: boolean } = {}): Promise<EdgeSignal[] | null> {
  const hot = await getCache<EdgeSignal[]>(EDGE_CACHE_KEY);
  if (hot && hot.length > 0) return hot;
  const staleRaw = await getCache<EdgeStalePayload | EdgeSignal[]>(EDGE_STALE_CACHE_KEY);
  const stale = parseStalePayload(staleRaw);
  if (stale?.signals?.length) return stale.signals;
  if (options.warmIfMissing) {
    kickBackgroundRefresh("cache miss");
  }
  return null;
}

export { MIN_SAMPLES };

/**
 * Internal pure helpers exported for unit testing. Not part of the public
 * runtime API — callers outside `services/ai/quant-edge.service.ts` should
 * not depend on this shape. The grouping is just to keep the production
 * surface terse while still letting tests probe the math.
 */
export const __test__ = {
  backtest,
  emaSeries,
  atrSeries,
  WARMUP,
  STOP_ATR,
  TARGET_ATR,
  MAX_HOLD_BARS
};
