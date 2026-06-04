import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { SYMBOL_RATE_LIMITS } from "@/lib/symbol-rate-policy";
import { marketDataService } from "@/services/market-data/market-data.service";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market:symbol-search", SYMBOL_RATE_LIMITS.search);

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many symbol search requests.", 429);
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";

  return ok({
    symbols: await marketDataService.searchSymbols(query)
  });
}
