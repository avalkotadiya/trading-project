import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { dhanMarketFeedService, isFeedBackoffError } from "@/services/dhan/dhanMarketFeed";
import { dhanOrderUpdatesService } from "@/services/dhan/dhanOrderUpdates";

export const runtime = "nodejs";

const connectSchema = z
  .object({
    requestCode: z.union([z.literal(15), z.literal(17), z.literal(19), z.literal(21)]).default(15),
    lane: z.enum(["critical", "dashboard", "interactive", "bulk", "depth", "overflow"]).optional(),
    instruments: z.array(z.unknown()).optional()
  })
  .optional();

export async function POST(request: NextRequest) {
  try {
    const body = connectSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) {
      return fail("VALIDATION_ERROR", "Invalid connect request body.", 422, body.error.flatten());
    }

    try {
      await dhanMarketFeedService.ensureConnected();
    } catch (error) {
      if (!isFeedBackoffError(error)) {
        throw error;
      }
    }
    const orderError = await dhanOrderUpdatesService.ensureConnected().then(
      () => null,
      (error) => (error instanceof Error ? error.message : "Order updates connection failed")
    );

    if (body.data?.instruments?.length) {
      await dhanMarketFeedService.subscribe(body.data.instruments, body.data.requestCode, {
        lane: body.data.lane
      });
    }

    const marketFeedStatus = dhanMarketFeedService.getStatus();
    const orderStatus = dhanOrderUpdatesService.getStatus();

    return ok({
      connected: Boolean(marketFeedStatus.connected || orderStatus.connected),
      marketFeed: marketFeedStatus,
      orderUpdates: {
        ...orderStatus,
        lastError: orderStatus.lastError ?? orderError
      }
    });
  } catch (error) {
    return fail("DHAN_CONNECT_FAILED", error instanceof Error ? error.message : "Failed to connect Dhan services.", 500);
  }
}
