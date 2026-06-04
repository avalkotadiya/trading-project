import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { querySymbols } from "@/services/symbols/symbol-registry";
import { toDhanDisplaySegment } from "@/services/dhan/dhanChartValidation";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:instruments:search", { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many Dhan instrument search requests.", 429);

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const take = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 30)));

  try {
    const page = await querySymbols({
      section: "all",
      query,
      limit: take,
      offset: 0
    });
    const instruments = page.symbols.map((row) => ({
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
    return ok({ instruments });
  } catch (error) {
    return fail(
      "DHAN_INSTRUMENT_SEARCH_FAILED",
      error instanceof Error ? error.message : "Unable to search Dhan instruments.",
      500
    );
  }
}
