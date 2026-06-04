import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { cacheGetOrSet } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import { buildSignalLeaderboard } from "@/services/ai/signal-leaderboard.service";
import { getAdvancedScannerResults } from "@/services/market-service";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "signals", { limit: 80 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many signal requests.", 429);
  }

  const signals = await cacheGetOrSet("signals:ai:v1", 45, async () => {
    const results = await getAdvancedScannerResults({ strategy: "all", minRelativeVolume: 1, signal: "all" });
    return buildSignalLeaderboard(results, 8);
  });

  return ok({ signals, provider: "live_market_signal_leaderboard" });
}
