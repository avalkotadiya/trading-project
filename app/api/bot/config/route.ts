import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { isLiveModeLocked, requestBotStop } from "@/services/ai/auto-trader.service";
import { computeAutoTunedGates } from "@/services/ai/bot-auto-config";

/**
 * Bot config v4 — knobs the user controls:
 *   - autoTradeEnabled (on/off)
 *   - botTradeMode (PAPER/LIVE, locked to PAPER while BOT_FORCE_PAPER_MODE)
 *   - maxDeployedCapital (₹ ceiling on total open exposure across positions)
 *   - botTrailStartPct / botTrailDistancePct (trailing stop-loss)
 *   - botMaxSectorExposurePct (sector concentration cap, 0-1)
 *   - botEntryWindowStart / botEntryWindowEnd ("HH:MM" IST, null = no window)
 *
 * Everything else (min edge%, min score, Kelly cap, risk %, max positions,
 * daily loss) is auto-tuned by services/ai/bot-auto-config from the user's
 * equity. GET returns the auto-tuned values too so the UI can display them
 * read-only; PATCH ignores writes to them.
 */
const hhmmRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const configSchema = z
  .object({
    autoTradeEnabled: z.boolean().optional(),
    botTradeMode: z.enum(["PAPER", "LIVE"]).optional(),
    maxDeployedCapital: z.number().positive().max(10_000_000).optional(),
    botTrailStartPct: z.number().min(0).max(50).optional(),
    botTrailDistancePct: z.number().min(0).max(50).optional(),
    botMaxSectorExposurePct: z.number().min(0).max(1).optional(),
    botEntryWindowStart: z
      .string()
      .regex(hhmmRegex, "Use HH:MM (24-hour)")
      .nullable()
      .optional(),
    botEntryWindowEnd: z
      .string()
      .regex(hhmmRegex, "Use HH:MM (24-hour)")
      .nullable()
      .optional()
  })
  .refine(
    (body) => {
      // If both window bounds are supplied (non-null), end must be after start.
      if (body.botEntryWindowStart && body.botEntryWindowEnd) {
        const [sh, sm] = body.botEntryWindowStart.split(":").map(Number);
        const [eh, em] = body.botEntryWindowEnd.split(":").map(Number);
        return eh * 60 + em > sh * 60 + sm;
      }
      return true;
    },
    { message: "Entry window end must be after start", path: ["botEntryWindowEnd"] }
  );

const USER_FIELDS = {
  autoTradeEnabled: true,
  botTradeMode: true,
  maxAutoTradeAmount: true,
  balance: true,
  botTrailStartPct: true,
  botTrailDistancePct: true,
  botMaxSectorExposurePct: true,
  botEntryWindowStart: true,
  botEntryWindowEnd: true
} as const;

function shape(config: Prisma.UserGetPayload<{ select: typeof USER_FIELDS }> | null) {
  if (!config) return null;
  const maxDeployedCapital = Number(config.maxAutoTradeAmount);
  const equity = Number(config.balance);
  const gates = computeAutoTunedGates({ equity, maxDeployedCapital });
  return {
    autoTradeEnabled: config.autoTradeEnabled,
    botTradeMode: config.botTradeMode,
    maxDeployedCapital,
    botTrailStartPct: config.botTrailStartPct,
    botTrailDistancePct: config.botTrailDistancePct,
    botMaxSectorExposurePct: config.botMaxSectorExposurePct,
    botEntryWindowStart: config.botEntryWindowStart,
    botEntryWindowEnd: config.botEntryWindowEnd,
    ...gates,
    liveModeLocked: isLiveModeLocked()
  };
}

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "bot:config:get", { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many requests.", 429);

  try {
    const user = await getAuthenticatedUser();
    const config = await prisma.user.findUnique({ where: { id: user.id }, select: USER_FIELDS });
    return ok(shape(config));
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("BOT_CONFIG_FAILED", "Unable to load bot config.", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const limit = await rateLimit(request, "bot:config:patch", { limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many config updates.", 429);

  try {
    const user = await getAuthenticatedUser();
    if (!hasRole(user, "TRADER")) return forbiddenResponse();
    const parsed = configSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid bot configuration.", 422, parsed.error.flatten());
    }

    const body = parsed.data;

    // Paper-only lock: coerce silently so a stale client doesn't get an error.
    if (body.botTradeMode === "LIVE" && isLiveModeLocked()) {
      body.botTradeMode = "PAPER";
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.autoTradeEnabled !== undefined) data.autoTradeEnabled = body.autoTradeEnabled;
    if (body.botTradeMode !== undefined) data.botTradeMode = body.botTradeMode;
    if (body.maxDeployedCapital !== undefined) {
      data.maxAutoTradeAmount = new Prisma.Decimal(body.maxDeployedCapital);
    }
    if (body.botTrailStartPct !== undefined) data.botTrailStartPct = body.botTrailStartPct;
    if (body.botTrailDistancePct !== undefined) data.botTrailDistancePct = body.botTrailDistancePct;
    if (body.botMaxSectorExposurePct !== undefined) data.botMaxSectorExposurePct = body.botMaxSectorExposurePct;
    if (body.botEntryWindowStart !== undefined) data.botEntryWindowStart = body.botEntryWindowStart;
    if (body.botEntryWindowEnd !== undefined) data.botEntryWindowEnd = body.botEntryWindowEnd;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: USER_FIELDS
    });

    if (body.autoTradeEnabled === false) {
      requestBotStop(user.id);
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "bot.config_update",
      entity: "User",
      entityId: user.id,
      metadata: { changes: body },
      request
    });

    return ok(shape(updated));
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("BOT_CONFIG_FAILED", error instanceof Error ? error.message : "Unable to update bot config.", 500);
  }
}
