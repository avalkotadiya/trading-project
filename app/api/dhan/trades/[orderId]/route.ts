import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "dhan:trades:order", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order trade requests.", 429);

  try {
    await getAuthenticatedUser();
    const { orderId } = await context.params;
    const trades = await dhanOrdersService.getTradesByOrder(orderId);
    return ok({ trades });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_TRADES_FAILED");
  }
}
