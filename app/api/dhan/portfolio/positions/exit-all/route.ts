import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanPortfolioService } from "@/services/dhan/dhanPortfolio";
import { getIpFromRequest, isIpAllowed } from "@/services/dhan/dhanSecurity";

export async function DELETE(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:positions:exit-all", { limit: 5, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many exit-all requests.", 429);

  try {
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Exit-all IP is not allowlisted.", 403);
    }
    await getAuthenticatedUser();
    const result = await dhanPortfolioService.exitAllPositions();
    return ok({ result });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_EXIT_ALL_POSITIONS_FAILED");
  }
}
