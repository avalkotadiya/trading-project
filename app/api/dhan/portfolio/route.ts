import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanPortfolioService } from "@/services/dhan/dhanPortfolio";
import { dhanMarginService } from "@/services/dhan/dhanMargin";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:portfolio:summary", { limit: 40, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many portfolio sync requests.", 429);

  try {
    await getAuthenticatedUser();
    const [holdings, positions, funds] = await Promise.all([
      dhanPortfolioService.holdings(),
      dhanPortfolioService.positions(),
      dhanMarginService.fundLimit()
    ]);
    return ok({ holdings, positions, funds });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_PORTFOLIO_FAILED");
  }
}
