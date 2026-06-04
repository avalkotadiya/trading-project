import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";
import { getIpFromRequest, isIpAllowed } from "@/services/dhan/dhanSecurity";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "dhan:orders:get", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order detail requests.", 429);
  try {
    await getAuthenticatedUser();
    const { orderId } = await context.params;
    const order = await dhanOrdersService.getOrder(orderId);
    return ok({ order });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_GET_FAILED");
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "dhan:orders:modify", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order modify requests.", 429);
  try {
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Order modify IP is not allowlisted.", 403);
    }
    await getAuthenticatedUser();
    const { orderId } = await context.params;
    const parsed = dhanOrdersService.validateModifyOrder(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Order modify payload is invalid.", 422, parsed.error.flatten());
    }
    const order = await dhanOrdersService.modifyOrder(orderId, parsed.data);
    return ok({ order });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_MODIFY_FAILED");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "dhan:orders:cancel", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many order cancel requests.", 429);
  try {
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Order cancel IP is not allowlisted.", 403);
    }
    await getAuthenticatedUser();
    const { orderId } = await context.params;
    const result = await dhanOrdersService.cancelOrder(orderId);
    return ok({ result });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_ORDER_CANCEL_FAILED");
  }
}
