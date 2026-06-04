import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanHistoricalDataService } from "@/services/dhan/dhanHistoricalData";
import { dhanHistoricalPayloadSchema } from "@/services/dhan/dhanSchemas";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:historical", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many historical data requests.", 429);

  try {
    await getAuthenticatedUser();
    const parsed = dhanHistoricalPayloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Historical data payload is invalid.", 422, parsed.error.flatten());
    }

    const raw = parsed.data.interval
      ? await dhanHistoricalDataService.intraday(parsed.data)
      : await dhanHistoricalDataService.daily(parsed.data);

    return ok({
      raw,
      candles: dhanHistoricalDataService.normalizeCandles(raw)
    });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_HISTORICAL_FAILED");
  }
}
