import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { marketDataService } from "@/services/market-data/market-data.service";
import { marketDataErrorResponse, requireMarketDataAccess } from "@/services/market-data/market-data.guard";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "market:snapshot", { limit: 120 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many market snapshot requests.", 429);
  }

  const accessError = await requireMarketDataAccess();

  if (accessError) {
    return accessError;
  }

  const symbol = request.nextUrl.searchParams.get("symbol");
  const exchange = request.nextUrl.searchParams.get("exchange") as "NSE" | "BSE" | null;

  if (!symbol) {
    return fail("VALIDATION_ERROR", "symbol is required.", 422);
  }

  if (exchange && exchange !== "NSE" && exchange !== "BSE") {
    return fail("VALIDATION_ERROR", "exchange must be NSE or BSE.", 422);
  }

  try {
    return ok({
      snapshot: await marketDataService.getSnapshot(symbol, exchange ?? undefined)
    });
  } catch (error) {
    return marketDataErrorResponse(error);
  }
}
