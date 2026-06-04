import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanPortfolioService } from "@/services/dhan/dhanPortfolio";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:positions", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many positions requests.", 429);

  try {
    await getAuthenticatedUser();
    const positions = await dhanPortfolioService.positions();
    return ok({ positions });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_POSITIONS_FAILED");
  }
}
