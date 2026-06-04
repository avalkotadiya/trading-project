import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { runBotCycle } from "@/services/ai/auto-trader.service";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "bot:run", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Bot cycle requested too frequently.", 429);

  try {
    const user = await getAuthenticatedUser();
    if (!hasRole(user, "TRADER")) return forbiddenResponse();
    const result = await runBotCycle(user.id, request);
    return ok(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("BOT_RUN_FAILED", error instanceof Error ? error.message : "Bot cycle failed.", 500);
  }
}
