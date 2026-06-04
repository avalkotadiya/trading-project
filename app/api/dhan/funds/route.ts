import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanMarginService } from "@/services/dhan/dhanMargin";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:funds", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many fund limit requests.", 429);

  try {
    await getAuthenticatedUser();
    const funds = await dhanMarginService.fundLimit();
    return ok({ funds });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_FUNDS_FAILED");
  }
}
