import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { SCANNER_PRO_SYMBOLS, buildScannerSignals } from "@/services/scanner-pro";
import { marketDataService } from "@/services/market-data/market-data.service";
import { requireMarketDataAccess } from "@/services/market-data/market-data.guard";
import { logger } from "@/lib/logger";
import type { MarketPulseCategory } from "@/types/market-pulse";
import type { ScannerBeta, ScannerSector } from "@/services/scanner-pro";

const CATEGORIES: MarketPulseCategory[] = ["breakout-beacon", "intraday-boost", "top-level", "low-level"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const limit = await rateLimit(request, "scanner:pro", { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many scanner requests.", 429);

  const category = (await params).category as MarketPulseCategory;
  if (!CATEGORIES.includes(category)) return fail("VALIDATION_ERROR", "Invalid scanner category.", 422);

  const accessError = await requireMarketDataAccess();
  if (accessError) return accessError;

  const { searchParams } = new URL(request.url);
  const sector = (searchParams.get("sector") || "All") as ScannerSector;
  const beta = (searchParams.get("beta") || "All") as ScannerBeta;
  const direction = searchParams.get("direction") || "all";
  const sortBy = searchParams.get("sortBy") || "Strongest Signal %";
  const search = searchParams.get("search") || "";
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const pageLimit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "40")));

  try {
    const ticks = await marketDataService.getTicks(SCANNER_PRO_SYMBOLS);
    const { data, total } = buildScannerSignals(ticks, category, {
      sector,
      beta,
      direction,
      sortBy,
      search,
      page,
      limit: pageLimit,
    });

    return NextResponse.json({
      ok: true,
      data,
      meta: { source: "live" as const, updatedAt: new Date().toISOString() },
      pagination: {
        total,
        page,
        limit: pageLimit,
        totalPages: Math.max(1, Math.ceil(total / pageLimit)),
      },
    });
  } catch (error) {
    // Degrade gracefully instead of 500 so the scanner UI keeps its last
    // data and the next live poll silently recovers.
    logger.warn("Scanner Pro degraded", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({
      ok: true,
      data: [],
      meta: { source: "degraded" as const, updatedAt: new Date().toISOString() },
      pagination: { total: 0, page, limit: pageLimit, totalPages: 1 },
    });
  }
}
