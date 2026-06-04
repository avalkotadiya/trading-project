import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:trades:list", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many trade book requests.", 429);

  try {
    await getAuthenticatedUser();
    const trades = await dhanOrdersService.getTrades();
    return ok({ trades });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_TRADES_FAILED");
  }
}

