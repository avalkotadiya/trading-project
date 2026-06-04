import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser } from "@/lib/auth";
import { dhanAuthService } from "@/services/dhan/dhanAuth";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "dhan:auth:consent", { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many consent requests.", 429);

  try {
    await getAuthenticatedUser();
    const consent = await dhanAuthService.generateConsent();
    return ok(consent);
  } catch (error) {
    return fail("DHAN_CONSENT_ERROR", error instanceof Error ? error.message : "Unable to generate Dhan consent.", 500);
  }
}

