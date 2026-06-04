import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { clearSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "auth:sign-out", { limit: 30, windowMs: 60_000 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many sign-out requests.", 429);
  }

  await clearSession();

  return ok({ signedOut: true });
}
