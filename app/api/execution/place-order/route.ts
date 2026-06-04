import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { OrderManager } from "@/lib/execution/order-manager";
import { fail, ok } from "@/lib/api-response";
import { placeOrderSchema } from "@/lib/validators";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser();

    const parsed = placeOrderSchema.safeParse(await req.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid order payload.", 422, parsed.error.flatten());
    }

    const result = await OrderManager.executeOrder(user.id, parsed.data, req);
    return ok({ order: result.order, newBalance: result.newBalance }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    const msg = error instanceof Error ? error.message : "";
    logger.error("Execution API error", { code: msg.split(":")[0] });

    if (msg.startsWith("RATE_LIMIT_EXCEEDED")) return fail("RATE_LIMITED", "Order rate limit exceeded. Please wait.", 429);
    if (msg.startsWith("BROKER_NOT_CONNECTED")) return fail("BROKER_ERROR", "Broker is not connected. Link your broker in Settings.", 400);
    if (msg.startsWith("INSUFFICIENT_FUNDS")) return fail("WALLET_ERROR", "Insufficient funds to place this order.", 400);

    return fail("EXECUTION_FAILED", "Unable to place order at this time.", 500);
  }
}
