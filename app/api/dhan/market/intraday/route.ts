/**
 * GET /api/dhan/market/intraday
 *
 * Intraday OHLCV candles for any Indian instrument.
 *
 * Query params:
 *   securityId      Dhan SecurityId (required)
 *   segment         Exchange segment e.g. NSE_EQ, BSE_EQ, IDX_I, NSE_FNO,
 *                   MCX_COMM, NSE_CURRENCY  [default: NSE_EQ]
 *   instrument      Dhan instrument type: EQUITY, INDEX, FUTIDX, FUTSTK,
 *                   OPTIDX, OPTSTK, FUTCOM, FUTCUR  [default: EQUITY]
 *   interval        Candle interval in minutes: 1, 5, 15, 25, 60  [default: 5]
 *   from            From date YYYY-MM-DD  [default: today]
 *   to              To date  YYYY-MM-DD   [default: today]
 *
 * Full Dhan subscription features used:
 *   ✅  Historical Data for 5 Years  (daily candles via /charts/historical)
 *   ✅  Real-time Price              (intraday candles via /charts/intraday)
 *
 * NOTE: For daily/weekly candles use /api/dhan/historical which already exists
 * and covers up to 5 years of data.
 */

import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { dhanHistoricalDataService } from "@/services/dhan/dhanHistoricalData";
import {
  DHAN_CHART_EXCHANGE_SEGMENTS,
  DHAN_CHART_INSTRUMENTS,
  DHAN_CHART_INTERVALS
} from "@/services/dhan/dhanChartValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTERVALS = new Set<string>(DHAN_CHART_INTERVALS);
const VALID_SEGMENTS = new Set<string>(DHAN_CHART_EXCHANGE_SEGMENTS);
const VALID_INSTRUMENTS = new Set<string>(DHAN_CHART_INSTRUMENTS);

function toIsoDate(input: string | null, fallback: Date): string {
  if (!input) return fallback.toISOString().slice(0, 10);
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) return fallback.toISOString().slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:market:intraday", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many intraday requests.", 429);

  const params = request.nextUrl.searchParams;
  const securityId = params.get("securityId")?.trim() ?? "";
  const segment = params.get("segment")?.trim().toUpperCase() ?? "NSE_EQ";
  const instrument = params.get("instrument")?.trim().toUpperCase() ?? "EQUITY";
  const interval = params.get("interval")?.trim() ?? "5";

  const today = new Date();
  const fromDate = toIsoDate(params.get("from"), today);
  const toDate = toIsoDate(params.get("to"), today);

  if (!securityId) {
    return fail("MISSING_PARAMS", "'securityId' is required.", 400);
  }

  if (!VALID_INTERVALS.has(interval)) {
    return fail(
      "INVALID_INTERVAL",
      `'interval' must be one of: ${[...VALID_INTERVALS].join(", ")}.`,
      400
    );
  }

  if (!VALID_SEGMENTS.has(segment)) {
    return fail(
      "INVALID_SEGMENT",
      `'segment' must be one of: ${[...VALID_SEGMENTS].join(", ")}.`,
      400
    );
  }

  if (!VALID_INSTRUMENTS.has(instrument)) {
    return fail(
      "INVALID_INSTRUMENT",
      `'instrument' must be one of: ${[...VALID_INSTRUMENTS].join(", ")}.`,
      400
    );
  }

  try {
    const raw = await dhanHistoricalDataService.intraday({
      securityId,
      exchangeSegment: segment,
      instrument,
      interval,
      fromDate,
      toDate
    });

    const candles = dhanHistoricalDataService.normalizeCandles(raw);

    return ok({
      securityId,
      segment,
      instrument,
      interval,
      fromDate,
      toDate,
      candles,
      count: candles.length
    });
  } catch (error) {
    return fail(
      "INTRADAY_FETCH_FAILED",
      error instanceof Error ? error.message : "Failed to fetch intraday data.",
      500
    );
  }
}
