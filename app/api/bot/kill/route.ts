import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { requestBotStop } from "@/services/ai/auto-trader.service";

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "bot:kill", { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many kill requests.", 429);

  try {
    const user = await getAuthenticatedUser();
    if (!hasRole(user, "TRADER")) return forbiddenResponse();
    await request.json().catch(() => ({}));
    requestBotStop(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { autoTradeEnabled: false } });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "bot.kill_switch",
      entity: "User",
      entityId: user.id,
      metadata: { stopped: true, flattened: false },
      request
    });

    return ok({ disabled: true, positionsClosed: 0 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("BOT_KILL_FAILED", error instanceof Error ? error.message : "Kill switch failed.", 500);
  }
}
