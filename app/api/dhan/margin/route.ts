import { NextRequest } from "next/server";
import { fail, failFromDhanRouteError, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanMarginService } from "@/services/dhan/dhanMargin";
import { dhanMarginPayloadSchema } from "@/services/dhan/dhanSchemas";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:margin:single", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many margin requests.", 429);

  try {
    await getAuthenticatedUser();
    const parsed = dhanMarginPayloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Margin payload is invalid.", 422, parsed.error.flatten());
    }
    const margin = await dhanMarginService.calculate(parsed.data);
    return ok({ margin });
  } catch (error) {
    return failFromDhanRouteError(error, "DHAN_MARGIN_FAILED");
  }
}
