import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getMarketSnapshot } from "@/services/market-service";
import { marketDataErrorResponse, requireMarketDataAccess } from "@/services/market-data/market-data.guard";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market-overview", { limit: 120 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many market data requests.", 429);
  }

  const accessError = await requireMarketDataAccess();

  if (accessError) {
    return accessError;
  }

  const symbols = request.nextUrl.searchParams.get("symbols")?.split(",").filter(Boolean);

  try {
    return ok(await getMarketSnapshot(symbols));
  } catch (error) {
    return marketDataErrorResponse(error);
  }
}
