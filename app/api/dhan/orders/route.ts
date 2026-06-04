import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";
import { getIpFromRequest, isIpAllowed } from "@/services/dhan/dhanSecurity";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:orders:list", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order requests.", 429);

  try {
    await getAuthenticatedUser();
    const orders = await dhanOrdersService.listOrders();
    return ok({ orders });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:orders:place", { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order placement requests.", 429);

  try {
    // Live Dhan order APIs may require static IP whitelisting at broker side.
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Order placement IP is not allowlisted.", 403);
    }

    await getAuthenticatedUser();
    const body = await request.json();
    const parsed = dhanOrdersService.validatePlaceOrder(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Order payload is invalid.", 422, parsed.error.flatten());
    }

    const order = await dhanOrdersService.placeOrder(parsed.data);
    return ok({ order }, { status: 201 });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_PLACE_FAILED");
  }
}
