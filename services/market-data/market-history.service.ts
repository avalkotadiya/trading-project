import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isMainExactSymbol } from "@/lib/live-market-priority";
import { dhanHistoricalDataService } from "@/services/dhan/dhanHistoricalData";
import { resolveDhanInstrumentForMarketSymbol } from "@/lib/dhan-symbols";
import type { MarketSymbol, NormalizedTick } from "@/services/market-data/market-data.types";
import { getSubscriptionKey } from "@/services/market-data/symbol-mapper.service";

const HISTORY_RETENTION_DAYS = Math.max(
  365,
  Number(process.env.MARKET_HISTORY_RETENTION_DAYS || "365")
);
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LIVE_FLUSH_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.MARKET_HISTORY_FLUSH_MS || "15000")
);
const BACKFILL_DAYS = Math.max(365, Number(process.env.MARKET_HISTORY_BACKFILL_DAYS || "365"));
const BACKFILL_CONCURRENCY = Math.max(1, Number(process.env.MARKET_HISTORY_BACKFILL_CONCURRENCY || "2"));
const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;
const ENABLE_DERIVATIVES_BACKFILL = String(
  process.env.MARKET_HISTORY_ENABLE_DERIVATIVES_BACKFILL || "false"
).toLowerCase() === "true";
const BACKFILL_RETRY_BLOCK_MS = Math.max(
  60_000,
  Number(process.env.MARKET_HISTORY_BACKFILL_RETRY_BLOCK_MS || String(10 * 60_000))
);
const BACKFILL_NO_DATA_BLOCK_MS = Math.max(
  5 * 60_000,
  Number(process.env.MARKET_HISTORY_BACKFILL_NO_DATA_BLOCK_MS || String(12 * 60 * 60_000))
);

type HistoryRow = {
  symbol: string;
  time: Date;
  lastPrice: number;
  volume: number;
  bidPrice: number | null;
  askPrice: number | null;
  openInterest: number | null;
};

function toMinuteBucket(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return new Date();
  d.setSeconds(0, 0);
  return d;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function historyInstrumentForSegment(symbol: Pick<MarketSymbol, "segment" | "instrument" | "instrumentType" | "chartInstrument" | "optionType">) {
  const chartInstrument = symbol.chartInstrument?.trim().toUpperCase();
  if (chartInstrument) return chartInstrument;

  const explicit = [symbol.instrumentType, symbol.instrument]
    .map((value) => (value ?? "").trim().toUpperCase())
    .find(Boolean);

  if (explicit) {
    if (explicit === "IDX" || explicit === "INDEX") return "INDEX";
    if (explicit === "ETF" || explicit === "EQ" || explicit === "ES" || explicit === "EQUITY") return "EQUITY";
    if (explicit.startsWith("FUT") || explicit.startsWith("OPT")) return explicit;
  }

  if (symbol.segment === "INDEX") return "INDEX";
  if (symbol.segment === "FNO") {
    if (symbol.optionType === "CE" || symbol.optionType === "PE") return "OPTSTK";
    return "FUTSTK";
  }
  return "EQUITY";
}

function resolveDirectHistoryTarget(symbol: Pick<MarketSymbol, "instrumentToken" | "exchangeSegment">) {
  const exchangeSegment = symbol.exchangeSegment?.trim().toUpperCase();
  const securityId = String(symbol.instrumentToken ?? "").match(/\d+/)?.[0] ?? null;
  if (!exchangeSegment || !securityId) return null;
  return {
    ExchangeSegment: exchangeSegment,
    SecurityId: securityId
  };
}

function parseSymbolFromKey(key: string) {
  const index = key.indexOf(":");
  if (index < 0) return key.trim().toUpperCase();
  return key.slice(index + 1).trim().toUpperCase();
}

function isMainTrackedSymbol(symbol: string) {
  return isMainExactSymbol("all", symbol);
}

function looksDerivativeOrNonCash(symbol: MarketSymbol) {
  const exchangeSegment = (symbol.exchangeSegment ?? "").trim().toUpperCase();
  const instrumentType = (symbol.instrumentType ?? symbol.instrument ?? "").trim().toUpperCase();

  if (symbol.segment === "FNO") return true;
  if (exchangeSegment.endsWith("_FNO") || exchangeSegment.endsWith("_CURRENCY") || exchangeSegment === "MCX_COMM") {
    return true;
  }
  return (
    instrumentType.startsWith("FUT") ||
    instrumentType.startsWith("OPT") ||
    instrumentType === "FUTCUR" ||
    instrumentType === "OPTCUR" ||
    instrumentType === "FUTCOM" ||
    instrumentType === "OPTCOM" ||
    instrumentType === "OPTFUT"
  );
}

function isBackfillEligible(symbol: MarketSymbol) {
  if (!isMainTrackedSymbol(symbol.symbol)) return false;
  if (ENABLE_DERIVATIVES_BACKFILL) return true;
  return !looksDerivativeOrNonCash(symbol);
}

function isNoDataOrInvalidHistoryError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const raw = error as { status?: unknown; details?: unknown; message?: unknown };
  const status = typeof raw.status === "number" ? raw.status : null;
  if (status !== 400) return false;

  const message = typeof raw.message === "string" ? raw.message.toLowerCase() : "";
  const details = raw.details && typeof raw.details === "object"
    ? (raw.details as Record<string, unknown>)
    : null;
  const errorCode = typeof details?.errorCode === "string" ? details.errorCode.toUpperCase() : "";
  const errorType = typeof details?.errorType === "string" ? details.errorType.toUpperCase() : "";
  const errorMessage = typeof details?.errorMessage === "string" ? details.errorMessage.toLowerCase() : "";

  return (
    errorCode === "DH-905" ||
    errorType === "INPUT_EXCEPTION" ||
    errorMessage.includes("no data") ||
    errorMessage.includes("incorrect parameters") ||
    errorMessage.includes("bad values for parameters") ||
    message.includes("no data present")
  );
}

class MarketHistoryService {
  private readonly liveBuffer = new Map<string, HistoryRow>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight = false;
  private backfilled = new Set<string>();
  private backfillPromises = new Map<string, Promise<void>>();
  private backfillBlockedUntil = new Map<string, number>();
  private lastCleanupAt = 0;

  trackLiveTick(tick: NormalizedTick) {
    if (!isMainTrackedSymbol(tick.symbol)) return;
    const key = getSubscriptionKey(tick);
    const minute = toMinuteBucket(tick.timestamp);
    const bucketKey = `${key}:${minute.toISOString()}`;
    this.liveBuffer.set(bucketKey, {
      symbol: key,
      time: minute,
      lastPrice: tick.lastPrice,
      volume: Math.max(0, Math.round(tick.volume || 0)),
      bidPrice: typeof tick.bidPrice === "number" ? tick.bidPrice : null,
      askPrice: typeof tick.askPrice === "number" ? tick.askPrice : null,
      openInterest: typeof tick.openInterest === "number" ? Math.round(tick.openInterest) : null
    });
    this.ensureFlushLoop();
    this.scheduleCleanup();
  }

  trackDhanPacket(packet: unknown) {
    if (!packet || typeof packet !== "object") return;
    const raw = packet as Record<string, unknown>;
    const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
    const exchange = typeof raw.exchange === "string" ? raw.exchange.trim().toUpperCase() : "";
    if (!symbol || (exchange !== "NSE" && exchange !== "BSE" && exchange !== "MCX")) return;
    if (!isMainTrackedSymbol(symbol)) return;

    const ltp = typeof raw.ltp === "number"
      ? raw.ltp
      : typeof raw.price === "number"
        ? raw.price
        : null;
    if (ltp === null || !Number.isFinite(ltp) || ltp <= 0) return;

    const timestamp = typeof raw.receivedAt === "string"
      ? raw.receivedAt
      : typeof raw.timestamp === "string"
        ? raw.timestamp
        : new Date().toISOString();
    const minute = toMinuteBucket(timestamp);
    const key = `${exchange}:${symbol}`;
    const bucketKey = `${key}:${minute.toISOString()}`;

    this.liveBuffer.set(bucketKey, {
      symbol: key,
      time: minute,
      lastPrice: ltp,
      volume:
        typeof raw.volume === "number" && Number.isFinite(raw.volume)
          ? Math.max(0, Math.round(raw.volume))
          : 0,
      bidPrice: typeof raw.bidPrice === "number" ? raw.bidPrice : null,
      askPrice: typeof raw.askPrice === "number" ? raw.askPrice : null,
      openInterest:
        typeof raw.openInterest === "number" && Number.isFinite(raw.openInterest)
          ? Math.max(0, Math.round(raw.openInterest))
          : null
    });

    this.ensureFlushLoop();
    this.scheduleCleanup();
  }

  async getLastKnownTick(symbol: MarketSymbol): Promise<NormalizedTick | null> {
    const key = getSubscriptionKey(symbol);
    const row = await prisma.marketTick.findFirst({
      where: { symbol: key },
      orderBy: { time: "desc" }
    });
    if (!row) return null;
    return this.rowToTick(symbol, row);
  }

  async getLastKnownTicks(symbols: MarketSymbol[]) {
    const symbolsByKey = new Map<string, MarketSymbol>();
    for (const symbol of symbols) {
      symbolsByKey.set(getSubscriptionKey(symbol), symbol);
    }

    const keys = Array.from(symbolsByKey.keys());
    const out = new Map<string, NormalizedTick>();
    if (keys.length === 0) return out;

    const rows = await prisma.marketTick.findMany({
      where: { symbol: { in: keys } },
      orderBy: [{ symbol: "asc" }, { time: "desc" }],
      distinct: ["symbol"]
    });

    for (const row of rows) {
      const symbol = symbolsByKey.get(row.symbol);
      if (!symbol) continue;
      const tick = this.rowToTick(symbol, row);
      if (!tick) continue;
      out.set(row.symbol, tick);
    }

    return out;
  }

  async getLastKnownTicksWithBackfill(symbols: MarketSymbol[]) {
    const initial = await this.getLastKnownTicks(symbols);
    const missing = symbols.filter((symbol) => !initial.has(getSubscriptionKey(symbol)));
    if (missing.length === 0) return initial;

    await this.runBackfill(missing);
    const afterBackfill = await this.getLastKnownTicks(missing);
    for (const [key, tick] of afterBackfill.entries()) {
      initial.set(key, tick);
    }
    return initial;
  }

  ensureHistoryForSymbols(symbols: MarketSymbol[]) {
    if (symbols.length === 0) return;
    const unique = Array.from(new Map(symbols.map((s) => [getSubscriptionKey(s), s])).values())
      .filter((symbol) => isBackfillEligible(symbol));
    if (unique.length === 0) return;
    void this.runBackfill(unique).catch((error) => {
      logger.warn("[MarketHistory] symbol backfill batch failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async runBackfill(symbols: MarketSymbol[]) {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(BACKFILL_CONCURRENCY, symbols.length) }, async () => {
        for (;;) {
          const index = cursor++;
          if (index >= symbols.length) return;
          await this.backfillSymbol(symbols[index]);
        }
      })
    );
  }

  private async backfillSymbol(symbol: MarketSymbol) {
    const key = getSubscriptionKey(symbol);
    if (!isBackfillEligible(symbol)) {
      this.backfilled.add(key);
      return;
    }
    if (this.backfilled.has(key)) return;
    const blockedUntil = this.backfillBlockedUntil.get(key);
    if (blockedUntil && blockedUntil > Date.now()) return;
    if (blockedUntil) this.backfillBlockedUntil.delete(key);
    const running = this.backfillPromises.get(key);
    if (running) return running;

    const promise = (async () => {
      try {
        const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
        const existingCount = await prisma.marketTick.count({
          where: {
            symbol: key,
            time: { gte: since }
          }
        });
        if (existingCount >= BACKFILL_DAYS - 7) {
          this.backfilled.add(key);
          return;
        }

        const direct = resolveDirectHistoryTarget(symbol);
        const resolved = direct ?? resolveDhanInstrumentForMarketSymbol(symbol);
        if (!resolved) return;

        const fromDate = toIsoDate(since);
        const toDate = toIsoDate(new Date());
        const raw = await dhanHistoricalDataService.daily({
          securityId: resolved.SecurityId,
          exchangeSegment: resolved.ExchangeSegment,
          instrument: historyInstrumentForSegment(symbol),
          fromDate,
          toDate
        });
        const candles = dhanHistoricalDataService.normalizeCandles(raw);
        if (candles.length === 0) return;

        const existingRows = await prisma.marketTick.findMany({
          where: {
            symbol: key,
            time: { gte: since }
          },
          select: { time: true }
        });
        const existingTimes = new Set(existingRows.map((row) => row.time.toISOString()));

        const rows: HistoryRow[] = [];
        for (const candle of candles) {
          const at = new Date(candle.timestamp);
          if (!Number.isFinite(at.getTime())) continue;
          if (existingTimes.has(at.toISOString())) continue;
          if (!Number.isFinite(candle.close) || candle.close <= 0) continue;
          rows.push({
            symbol: key,
            time: at,
            lastPrice: candle.close,
            volume: Math.max(0, Math.round(candle.volume || 0)),
            bidPrice: null,
            askPrice: null,
            openInterest: null
          });
        }

        if (rows.length > 0) {
          await prisma.marketTick.createMany({ data: rows });
        }
        this.backfilled.add(key);
        this.backfillBlockedUntil.delete(key);
        this.scheduleCleanup();
      } catch (error) {
        if (isNoDataOrInvalidHistoryError(error)) {
          this.backfilled.add(key);
          this.backfillBlockedUntil.set(key, Date.now() + BACKFILL_NO_DATA_BLOCK_MS);
          logger.info("[MarketHistory] backfill skipped (provider no-data/invalid params)", { symbol: key });
          return;
        }

        this.backfillBlockedUntil.set(key, Date.now() + BACKFILL_RETRY_BLOCK_MS);
        logger.warn("[MarketHistory] backfill failed", {
          symbol: key,
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        this.backfillPromises.delete(key);
      }
    })();

    this.backfillPromises.set(key, promise);
    return promise;
  }

  private ensureFlushLoop() {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flushLiveBuffer();
    }, LIVE_FLUSH_INTERVAL_MS);
  }

  private async flushLiveBuffer() {
    if (this.flushInFlight) return;
    if (this.liveBuffer.size === 0) return;
    this.flushInFlight = true;
    try {
      const rows = Array.from(this.liveBuffer.values());
      this.liveBuffer.clear();
      await prisma.marketTick.createMany({ data: rows });
    } catch (error) {
      logger.warn("[MarketHistory] live flush failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.flushInFlight = false;
    }
  }

  private scheduleCleanup() {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_EVERY_MS) return;
    this.lastCleanupAt = now;
    void (async () => {
      await prisma.marketTick.deleteMany({
        where: {
          time: {
            lt: new Date(now - HISTORY_RETENTION_MS)
          }
        }
      });
      await this.cleanupNonMainSymbolRows();
    })().catch((error) => {
      logger.warn("[MarketHistory] cleanup failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private async cleanupNonMainSymbolRows() {
    const keys = await prisma.marketTick.findMany({
      select: { symbol: true },
      distinct: ["symbol"]
    });
    const drop = keys
      .map((row) => row.symbol)
      .filter((key) => !isMainTrackedSymbol(parseSymbolFromKey(key)));
    if (drop.length === 0) return;

    const CHUNK = 200;
    let removed = 0;
    for (let index = 0; index < drop.length; index += CHUNK) {
      const batch = drop.slice(index, index + CHUNK);
      const result = await prisma.marketTick.deleteMany({
        where: { symbol: { in: batch } }
      });
      removed += result.count;
    }
    logger.info("[MarketHistory] pruned non-main symbol rows", {
      symbolsDropped: drop.length,
      rowsRemoved: removed
    });
  }

  private rowToTick(
    symbol: MarketSymbol,
    row: {
      time: Date;
      lastPrice: number;
      volume: number;
      bidPrice: number | null;
      askPrice: number | null;
      openInterest: number | null;
    }
  ): NormalizedTick | null {
    const price = Number(row.lastPrice || 0);
    if (!Number.isFinite(price) || price <= 0) return null;

    return {
      exchange: symbol.exchange,
      segment: symbol.segment,
      symbol: symbol.symbol,
      instrumentToken: symbol.instrumentToken,
      lastPrice: price,
      change: 0,
      changePercent: 0,
      volume: Number(row.volume || 0),
      averageTradedPrice: price,
      open: price,
      high: price,
      low: price,
      close: price,
      bidPrice: row.bidPrice ?? undefined,
      askPrice: row.askPrice ?? undefined,
      openInterest: row.openInterest ?? undefined,
      timestamp: row.time.toISOString(),
      source: "db:last-known"
    };
  }
}

const globalForHistory = globalThis as unknown as { marketHistoryService?: MarketHistoryService };
export const marketHistoryService = globalForHistory.marketHistoryService ?? new MarketHistoryService();
if (process.env.NODE_ENV !== "production") {
  globalForHistory.marketHistoryService = marketHistoryService;
}
