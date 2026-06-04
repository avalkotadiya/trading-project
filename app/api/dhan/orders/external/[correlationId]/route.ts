import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";

type RouteContext = {
  params: Promise<{ correlationId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "dhan:orders:external", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many external order requests.", 429);

  try {
    await getAuthenticatedUser();
    const { correlationId } = await context.params;
    const order = await dhanOrdersService.getOrderByCorrelationId(correlationId);
    return ok({ order });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_EXTERNAL_FAILED");
  }
}
