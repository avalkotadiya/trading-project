import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { dhanAuthService } from "@/services/dhan/dhanAuth";
import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";
import { dhanOrderUpdatesService } from "@/services/dhan/dhanOrderUpdates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:market:status", { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many market status requests.", 429);

  try {
    await dhanMarketFeedService.ensureConnected().catch(() => null);
    await dhanOrderUpdatesService.ensureConnected().catch(() => null);
    return ok({
      auth: await dhanAuthService.getTokenHealth(),
      marketFeed: dhanMarketFeedService.getStatus(),
      orderUpdates: dhanOrderUpdatesService.getStatus()
    });
  } catch (error) {
    return fail("DHAN_MARKET_STATUS_FAILED", error instanceof Error ? error.message : "Status unavailable", 500);
  }
}
