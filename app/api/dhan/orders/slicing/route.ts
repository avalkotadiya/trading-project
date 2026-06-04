import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";
import { getIpFromRequest, isIpAllowed } from "@/services/dhan/dhanSecurity";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:orders:slicing", { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many sliced order requests.", 429);

  try {
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Order slicing IP is not allowlisted.", 403);
    }
    await getAuthenticatedUser();
    const parsed = dhanOrdersService.validatePlaceOrder(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Sliced order payload is invalid.", 422, parsed.error.flatten());
    }
    const order = await dhanOrdersService.sliceOrder(parsed.data);
    return ok({ order }, { status: 201 });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_SLICING_FAILED");
  }
}
