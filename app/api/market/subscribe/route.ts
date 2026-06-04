import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { marketDataService } from "@/services/market-data/market-data.service";
import { marketDataErrorResponse, requireMarketDataAccess } from "@/services/market-data/market-data.guard";

const subscriptionSchema = z.object({
  symbols: z.array(z.string().min(1).max(80)).min(1).max(200)
});

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "market:subscribe", { limit: 60 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many market subscription requests.", 429);
  }

  const accessError = await requireMarketDataAccess();

  if (accessError) {
    return accessError;
  }

  try {
    const parsed = subscriptionSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Subscription payload is invalid.", 422, parsed.error.flatten());
    }

    const subscriptions = await marketDataService.subscribe(parsed.data.symbols);
    return ok({ subscriptions });
  } catch (error) {
    return marketDataErrorResponse(error);
  }
}
