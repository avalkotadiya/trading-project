import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanPortfolioService } from "@/services/dhan/dhanPortfolio";
import { dhanConvertPositionPayloadSchema } from "@/services/dhan/dhanSchemas";
import { getIpFromRequest, isIpAllowed } from "@/services/dhan/dhanSecurity";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:positions:convert", { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many position conversion requests.", 429);

  try {
    const ip = getIpFromRequest(request);
    if (!isIpAllowed(ip, process.env.DHAN_ORDER_IP_ALLOWLIST)) {
      return fail("IP_NOT_ALLOWED", "Position conversion IP is not allowlisted.", 403);
    }
    await getAuthenticatedUser();
    const parsed = dhanConvertPositionPayloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Position conversion payload is invalid.", 422, parsed.error.flatten());
    }
    const result = await dhanPortfolioService.convertPosition(parsed.data);
    return ok({ result });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_POSITION_CONVERT_FAILED");
  }
}
