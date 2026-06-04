import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getBotState } from "@/services/ai/auto-trader.service";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "bot:state", { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many bot state requests.", 429);

  try {
    const user = await getAuthenticatedUser();
    const candidatesMode = request.nextUrl.searchParams.get("candidates");
    const includeCandidates =
      candidatesMode === "0" ? false : candidatesMode === "fresh" ? true : "cache";
    const state = await getBotState(user.id, { includeCandidates });
    return ok(state);
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("BOT_STATE_FAILED", error instanceof Error ? error.message : "Unable to load bot state.", 500);
  }
}
