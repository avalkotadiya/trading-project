/**
 * GET /api/options
 *
 * Option chain analytics for any supported underlying.
 *
 * Query params:
 *   symbol      Underlying symbol (NIFTY, BANKNIFTY, SENSEX, FINNIFTY,
 *               MIDCPNIFTY, or any NSE FNO stock e.g. RELIANCE)  [default: NIFTY]
 *   expiry      Specific expiry date string from the expiry list   [optional]
 *   securityId  NSE SecurityId — required for FNO equity underlyings [optional]
 *   expiries    "true" to return only the expiry list (no chain data)
 *   expired     "true" to include only expired expiry dates (historical data)
 *
 * Full Dhan subscription features used:
 *   ✅  Option Chain on APIs
 *   ✅  Expired Options Data
 */

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { cacheGetOrSet } from "@/lib/cache";
import { rateLimit } from "@/lib/rate-limit";
import { dhanOptionChainService } from "@/services/dhan/dhanOptionChain";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "options", { limit: 80 });
  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many options analytics requests.", 429);
  }

  const params = request.nextUrl.searchParams;
  const symbol = params.get("symbol") || "NIFTY";
  const expiry = params.get("expiry") ?? null;
  const securityId = params.get("securityId") ?? null;
  const expiriesOnly = params.get("expiries") === "true";
  const expiredOnly = params.get("expired") === "true";

  try {
    // --- Return only the expiry list ---
    if (expiriesOnly) {
      const expiries = await cacheGetOrSet(
        `options:expiries:${symbol}`,
        60,
        () => dhanOptionChainService.getExpiryList(symbol, securityId)
      );
      return ok({ symbol, expiries });
    }

    // --- Return only expired expiry dates (historical / expired options) ---
    if (expiredOnly) {
      const expiries = await cacheGetOrSet(
        `options:expired-expiries:${symbol}`,
        300,
        () => dhanOptionChainService.getExpiredExpiries(symbol, securityId)
      );
      return ok({ symbol, expiredExpiries: expiries });
    }

    // --- Full option chain analytics ---
    const analytics = await cacheGetOrSet(
      `options:chain:${symbol}:${expiry ?? "nearest"}`,
      3,
      () => dhanOptionChainService.getOptionChainAnalytics(symbol, expiry, securityId)
    );
    return ok(analytics);
  } catch (error) {
    return fail(
      "OPTIONS_FETCH_FAILED",
      error instanceof Error ? error.message : "Failed to fetch option chain data.",
      500
    );
  }
}
