import { z } from "zod";
import { NextResponse } from "next/server";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { fail } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const automationPatchSchema = z.object({
  autoTradeEnabled: z.boolean().optional(),
  maxAutoTradeAmount: z.number().positive().max(10_000_000).optional(),
  autoTradeStrategy: z.string().max(80).optional()
});

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!hasRole(user, "TRADER")) return forbiddenResponse();

    const settings = await prisma.user.findUnique({
      where: { id: user.id },
      select: { autoTradeEnabled: true, maxAutoTradeAmount: true, autoTradeStrategy: true }
    });

    return NextResponse.json({ ok: true, data: settings });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    logger.error("Automation GET failed", { error: error instanceof Error ? error.message : String(error) });
    return fail("AUTOMATION_FETCH_FAILED", "Failed to fetch automation settings.", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!hasRole(user, "TRADER")) return forbiddenResponse();

    const parsed = automationPatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid automation settings.", 422, parsed.error.flatten());
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: parsed.data,
      select: { autoTradeEnabled: true, maxAutoTradeAmount: true, autoTradeStrategy: true }
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    logger.error("Automation PATCH failed", { error: error instanceof Error ? error.message : String(error) });
    return fail("AUTOMATION_UPDATE_FAILED", "Failed to update automation settings.", 500);
  }
}
