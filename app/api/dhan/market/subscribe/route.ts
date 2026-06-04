/**
 * POST /api/dhan/market/subscribe
 *
 * Subscribe one or more instruments to the Dhan live feed.
 *
 * Body:
 *   requestCode  15 | 17 | 19 | 21   Feed mode (15=index/ticker, 17=quote+OHLCV, 19=5-depth, 21=full)
 *   instruments  array           [{ExchangeSegment, SecurityId}, ...]
 *   meta         array?          Optional symbol metadata to register in the server-side
 *                                symbol registry so SSE packets carry human-readable
 *                                symbol names without a browser-side lookup table.
 *                                Format: [{SecurityId, symbol, name?, exchange, segment, exchangeSegment}]
 *
 * When `meta` is provided each entry is registered in the server-side symbol
 * registry so that ticks for the subscribed instrument are automatically enriched
 * with {symbol, exchange, segment, name} before being forwarded over SSE.
 * This lets the browser accept the tick via the shared useLiveMarket hook with
 * no extra EventSource or client-side lookup needed.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { DHAN_MAX_LIVE_FEED_INSTRUMENTS } from "@/lib/dhan-api-limits";
import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";
import { marketHistoryService } from "@/services/market-data/market-history.service";
import type { MarketSymbol } from "@/services/market-data/market-data.types";
import {
  normalizeDhanChartInstrument,
  toDhanDisplaySegment
} from "@/services/dhan/dhanChartValidation";

export const runtime = "nodejs";

const symbolMetaSchema = z.object({
  SecurityId: z.string(),
  symbol: z.string(),
  name: z.string().optional(),
  exchange: z.string(),
  segment: z.string(),
  exchangeSegment: z.string(),
  instrument: z.string().optional(),
  chartInstrument: z.string().optional(),
  instrumentType: z.string().optional(),
  optionType: z.string().optional()
});

const subscribeSchema = z.object({
  requestCode: z.union([z.literal(15), z.literal(17), z.literal(19), z.literal(21)]).default(15),
  lane: z.enum(["critical", "dashboard", "interactive", "bulk", "depth", "overflow"]).optional(),
  instruments: z.array(z.unknown()).min(1).max(DHAN_MAX_LIVE_FEED_INSTRUMENTS),
  /** Optional per-instrument metadata to register in the server-side symbol registry. */
  meta: z.array(symbolMetaSchema).optional()
});

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:market:subscribe", { limit: 40, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many market subscribe requests.", 429);

  try {
    await getAuthenticatedUser();
    const parsed = subscribeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid market subscribe payload.", 422, parsed.error.flatten());
    }

    // Register any custom symbol metadata in the server-side symbol registry
    // BEFORE subscribing, so that the very first tick is already enriched.
    if (parsed.data.meta && parsed.data.meta.length > 0) {
      const symbolsForBackfill: MarketSymbol[] = [];
      for (const m of parsed.data.meta) {
        dhanMarketFeedService.registerSymbol(m.SecurityId, {
          symbol: m.symbol,
          exchange: m.exchange,
          segment: m.segment,
          exchangeSegment: m.exchangeSegment,
          name: m.name
        });

        const exchange = m.exchange === "BSE" ? "BSE" : m.exchange === "MCX" ? "MCX" : "NSE";
        const segment = toDhanDisplaySegment(m.exchangeSegment, m.instrument ?? m.instrumentType ?? m.segment);
        symbolsForBackfill.push({
          exchange,
          segment,
          symbol: m.symbol.toUpperCase(),
          instrumentToken: m.SecurityId,
          exchangeSegment: m.exchangeSegment,
          instrument: m.instrument ?? null,
          instrumentType: m.instrumentType ?? null,
          chartInstrument: m.chartInstrument ?? normalizeDhanChartInstrument(m.instrument ?? m.instrumentType, m.exchangeSegment),
          optionType: m.optionType === "CE" || m.optionType === "PE" ? m.optionType : null,
          tradingSymbol: m.symbol,
          companyName: m.name ?? m.symbol
        });
      }
      marketHistoryService.ensureHistoryForSymbols(symbolsForBackfill);
    }

    await dhanMarketFeedService.subscribe(parsed.data.instruments, parsed.data.requestCode, {
      lane: parsed.data.lane
    });

    return ok({
      subscribed: parsed.data.instruments.length,
      requestCode: parsed.data.requestCode,
      lane: parsed.data.lane ?? null,
      registered: parsed.data.meta?.length ?? 0
    });
  } catch (error) {
    return fail("DHAN_MARKET_SUBSCRIBE_FAILED", error instanceof Error ? error.message : "Subscribe failed", 500);
  }
}
