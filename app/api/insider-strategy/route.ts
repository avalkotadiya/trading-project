import { NextRequest, NextResponse } from "next/server";
import { requireMarketDataAccess } from "@/services/market-data/market-data.guard";
import { marketDataService } from "@/services/market-data/market-data.service";
import { SCANNER_PRO_SYMBOLS, buildScannerSignals } from "@/services/scanner-pro";
import { cacheGetOrSet, getCache, setCache } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import type { StockSignal } from "@/types/market-pulse";

type InsiderBias = "accumulation" | "distribution";

type InsiderSignal = {
  symbol: string;
  companyName: string;
  price: number;
  percentChange: number;
  moneyFlux: number;
  relativeVolume: number;
  relativeStrength: number;
  conviction: number;
  bias: InsiderBias;
  time: string;
};
type InsiderCachePayload = {
  signals: InsiderSignal[];
  source: "live" | "stale";
};

const INSIDER_CACHE_KEY = "signals:insider:v2";
const INSIDER_CACHE_SECONDS = Math.max(2, Number(process.env.INSIDER_CACHE_SECONDS || "8"));
const INSIDER_STALE_KEY = "signals:insider:stale:v2";
const INSIDER_STALE_SECONDS = Math.max(60, Number(process.env.INSIDER_STALE_CACHE_SECONDS || "1800"));
const MIN_CONVICTION = Math.max(1, Number(process.env.INSIDER_MIN_CONVICTION || "20"));
const MIN_RVOL = Math.max(0.1, Number(process.env.INSIDER_MIN_RVOL || "1.2"));
const MIN_ABS_FLUX = Math.max(1, Number(process.env.INSIDER_MIN_ABS_FLUX || "8"));
const MAX_ROWS = Math.max(1, Number(process.env.INSIDER_MAX_ROWS || "60"));

function toInsiderSignal(signal: StockSignal): InsiderSignal | null {
  const flux = Number(signal.moneyFlux ?? 0);
  const rvol = Number(signal.relativeVolume ?? 1);
  const relativeStrength = Number(signal.relativeStrength ?? 50);
  const price = Number(signal.price ?? 0);
  const percentChange = Number(signal.percentChange ?? 0);

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(percentChange)) return null;
  if (!Number.isFinite(flux) || !Number.isFinite(rvol) || !Number.isFinite(relativeStrength)) return null;

  const conviction = Math.round(Math.abs(flux) * Math.min(3, Math.max(0.5, rvol)));
  if (conviction < MIN_CONVICTION) return null;
  if (rvol < MIN_RVOL) return null;
  if (Math.abs(flux) < MIN_ABS_FLUX) return null;

  return {
    symbol: signal.symbol,
    companyName: signal.companyName,
    price,
    percentChange,
    moneyFlux: flux,
    relativeVolume: rvol,
    relativeStrength,
    conviction,
    bias: flux > 0 ? "accumulation" : "distribution",
    time: signal.time
  };
}

function rankInsiderSignals(signals: StockSignal[]): InsiderSignal[] {
  const ranked = signals
    .map(toInsiderSignal)
    .filter((s): s is InsiderSignal => s !== null)
    .sort((a, b) => {
      return (
        b.conviction - a.conviction ||
        Math.abs(b.moneyFlux) - Math.abs(a.moneyFlux) ||
        b.relativeVolume - a.relativeVolume ||
        Math.abs(b.percentChange) - Math.abs(a.percentChange) ||
        a.symbol.localeCompare(b.symbol)
      );
    });

  // Keep the strongest row per symbol to avoid duplicates from mixed feeds.
  const uniqueBySymbol = new Map<string, InsiderSignal>();
  for (const row of ranked) {
    if (!uniqueBySymbol.has(row.symbol)) uniqueBySymbol.set(row.symbol, row);
    if (uniqueBySymbol.size >= MAX_ROWS) break;
  }

  return Array.from(uniqueBySymbol.values());
}

async function buildLiveInsiderSignals(): Promise<InsiderSignal[]> {
  const ticks = await marketDataService.getTicks(SCANNER_PRO_SYMBOLS);
  const { data } = buildScannerSignals(ticks, "intraday-boost", { page: 1, limit: 1000 });
  return rankInsiderSignals(data);
}

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "insider-strategy", { limit: 80, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: "RATE_LIMITED", message: "Too many insider strategy requests." } },
      { status: 429 }
    );
  }

  const accessError = await requireMarketDataAccess();
  if (accessError) return accessError;

  try {
    const cached = await cacheGetOrSet<InsiderCachePayload>(INSIDER_CACHE_KEY, INSIDER_CACHE_SECONDS, async () => {
      const live = await buildLiveInsiderSignals();
      if (live.length > 0) {
        await setCache(INSIDER_STALE_KEY, live, INSIDER_STALE_SECONDS);
        return { signals: live, source: "live" };
      }

      const stale = await getCache<InsiderSignal[]>(INSIDER_STALE_KEY);
      return { signals: stale && stale.length > 0 ? stale : [], source: stale && stale.length > 0 ? "stale" : "live" };
    });

    return NextResponse.json({
      ok: true,
      data: {
        signals: cached.signals,
        source: cached.source,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.warn("Insider strategy degraded", { error: error instanceof Error ? error.message : String(error) });
    const stale = (await getCache<InsiderSignal[]>(INSIDER_STALE_KEY)) ?? [];
    return NextResponse.json({
      ok: true,
      data: {
        signals: stale,
        source: stale.length > 0 ? "stale" : "unavailable",
        updatedAt: new Date().toISOString()
      }
    });
  }
}

export const __test__ = {
  toInsiderSignal,
  rankInsiderSignals
};
