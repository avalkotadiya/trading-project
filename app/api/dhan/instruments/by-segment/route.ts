import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { querySymbols } from "@/services/symbols/symbol-registry";
import { toDhanDisplaySegment } from "@/services/dhan/dhanChartValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dhan/instruments/by-segment
// Query params:
//   segments      comma-separated exchange segments (e.g. NSE_EQ,BSE_EQ). Omit for all.
//   q             optional text search across symbol, name, ISIN, securityId
//   instrument    optional instrument type filter substring (e.g. ETF, FUTSTK, OPTSTK)
//   limit         max results to return (default 60, max 200)
//   offset        pagination offset (default 0)
export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:instruments:by-segment", { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many requests.", 429);

  const params = request.nextUrl.searchParams;
  const segmentsParam = params.get("segments") ?? "";
  const q = params.get("q")?.trim().toUpperCase() ?? "";
  const instrumentType = params.get("instrument")?.trim().toUpperCase() ?? "";
  const take = Math.min(200, Math.max(1, Number(params.get("limit") ?? 60)));
  const skip = Math.max(0, Number(params.get("offset") ?? 0));

  const segments = segmentsParam
    ? segmentsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    const page = await querySymbols({
      section: "all",
      query: q || undefined,
      limit: 500,
      offset: 0
    });

    let filtered = page.symbols;
    if (segments.length > 0) {
      filtered = filtered.filter((inst) => segments.includes(inst.exchangeSegment));
    }
    if (instrumentType) {
      filtered = filtered.filter((inst) => inst.instrument.toUpperCase().includes(instrumentType));
    }

    const total = filtered.length;
    const instruments = filtered.slice(skip, skip + take).map((row) => ({
      symbol: row.symbol,
      tradingSymbol: row.tradingSymbol,
      name: row.name,
      exchange: row.exchange,
      segment: toDhanDisplaySegment(row.exchangeSegment, row.instrument),
      exchangeSegment: row.exchangeSegment,
      securityId: row.securityId,
      instrument: row.instrument,
      chartInstrument: row.chartInstrument,
      isin: row.isin,
      lotSize: row.lotSize,
      expiry: row.expiry,
      strikePrice: row.strikePrice,
      optionType: row.optionType
    }));

    return ok({ instruments, total, offset: skip, limit: take });
  } catch (error) {
    return fail(
      "INSTRUMENTS_FETCH_FAILED",
      error instanceof Error ? error.message : "Failed to fetch instruments.",
      500
    );
  }
}
