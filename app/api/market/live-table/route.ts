import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { SYMBOL_RATE_LIMITS } from "@/lib/symbol-rate-policy";
import { DHAN_LIVE_FEED_LIMITS, DHAN_MAX_LIVE_FEED_INSTRUMENTS, UI_SYMBOL_LIMITS } from "@/lib/dhan-api-limits";
import { queryLiveMarketCategory } from "@/services/market-data/live-market-universe.service";
import type { CategoryId } from "@/lib/market-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  category: z
    .enum([
      "all",
      "indices",
      "nse-eq",
      "bse-eq",
      "futures",
      "options",
      "commodity",
      "currency",
      "etf"
    ])
    .default("all"),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().positive().max(UI_SYMBOL_LIMITS.registryPageSize).default(UI_SYMBOL_LIMITS.liveTablePageSize),
  offset: z.coerce.number().int().nonnegative().default(0)
});

const LIVE_TABLE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=60"
};

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market:live-table", SYMBOL_RATE_LIMITS.liveTable);
  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many live market table requests.", 429);
  }

  const parsed = querySchema.safeParse({
    category: request.nextUrl.searchParams.get("category") ?? undefined,
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    offset: request.nextUrl.searchParams.get("offset") ?? undefined
  });

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid live market table query.", 422, parsed.error.flatten());
  }

  const { category, q, limit: pageSize, offset } = parsed.data;

  try {
    const result = await queryLiveMarketCategory({
      category: category as CategoryId,
      query: q,
      limit: pageSize,
      offset
    });

    return ok({
      ...result,
      limits: {
        maxConnections: DHAN_LIVE_FEED_LIMITS.maxConnections,
        instrumentsPerConnection: DHAN_LIVE_FEED_LIMITS.instrumentsPerConnection,
        instrumentsPerSubscribeMessage: DHAN_LIVE_FEED_LIMITS.instrumentsPerSubscribeMessage,
        maxLiveFeedInstruments: DHAN_MAX_LIVE_FEED_INSTRUMENTS
      }
    }, {
      headers: LIVE_TABLE_CACHE_HEADERS
    });
  } catch (error) {
    return fail(
      "LIVE_MARKET_TABLE_FAILED",
      error instanceof Error ? error.message : "Unable to fetch live market table.",
      500
    );
  }
}
