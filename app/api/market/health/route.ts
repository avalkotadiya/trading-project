import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { marketCacheService } from "@/services/market-data/market-cache.service";
import { marketDataService } from "@/services/market-data/market-data.service";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market:health", { limit: 120 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many market health requests.", 429);
  }

  return ok({
    health: await marketDataService.healthCheck(),
    activeSubscriptions: marketDataService.getActiveSubscriptions(),
    cachedSubscriptions: await marketCacheService.getActiveSubscriptions(),
    cacheProvider: marketCacheService.getProviderName()
  });
}
