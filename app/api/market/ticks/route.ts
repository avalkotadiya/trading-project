import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { marketDataService } from "@/services/market-data/market-data.service";
import { requireMarketDataAccess } from "@/services/market-data/market-data.guard";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market:ticks", { limit: 180 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many market tick requests.", 429);
  }

  const accessError = await requireMarketDataAccess();

  if (accessError) {
    return accessError;
  }

  const symbols = request.nextUrl.searchParams
    .get("symbols")
    ?.split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (!symbols?.length) {
    return fail("VALIDATION_ERROR", "symbols query parameter is required.", 422);
  }

  try {
    return ok({
      ticks: await marketDataService.getTicks(symbols),
      providerHealth: await marketDataService.healthCheck()
    });
  } catch (error) {
    // Never hard-fail a live tick poll: a 500 here makes the whole live
    // UI flip to a disconnected/error state. Degrade to an empty,
    // successful payload so the client keeps polling and auto-recovers
    // the moment the provider is healthy again.
    logger.warn("Market ticks degraded", { error: error instanceof Error ? error.message : String(error) });
    return ok({
      ticks: [],
      providerHealth: {
        provider: "dhan" as const,
        status: "degraded" as const,
        checkedAt: new Date().toISOString(),
        message: "Market data temporarily unavailable.",
        circuitBreakerOpen: true
      }
    });
  }
}
