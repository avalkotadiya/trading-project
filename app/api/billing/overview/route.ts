import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { UnauthorizedError } from "@/lib/auth";
import { getBillingOverview } from "@/lib/platform-data";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "billing:overview", { limit: 40 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many billing overview requests.", 429);
  }

  try {
    const overview = await getBillingOverview();
    return ok(overview);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("BILLING_OVERVIEW_FAILED", "Unable to load billing overview.", 500);
  }
}
