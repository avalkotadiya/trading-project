import { z } from "zod";
import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { sanitizeText, sanitizeSymbol } from "@/lib/sanitize";
import { logger } from "@/lib/logger";

const alertPersistSchema = z.object({
  type: z.enum(["INFO", "WARNING", "CRITICAL", "SIGNAL"]).default("INFO"),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  symbol: z.string().min(1).max(20).optional().transform((v) => (v ? sanitizeSymbol(v) : v)),
  message: z.string().min(1).max(500).transform((v) => sanitizeText(v, 500)),
  action: z.string().max(200).optional().transform((v) => (v ? sanitizeText(v, 200) : v)),
  metadata: z.record(z.unknown()).optional().default({})
});

export async function POST(req: Request) {
  try {
    await getAuthenticatedUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("UNAUTHORIZED", "Authentication required.", 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = alertPersistSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid alert payload.", 422, parsed.error.flatten());
    }

    const { metadata, ...rest } = parsed.data;
    const alert = await prisma.aIAlert.create({
      data: { ...rest, metadata: metadata as Prisma.InputJsonValue }
    });
    return NextResponse.json({ ok: true, id: alert.id });
  } catch (error) {
    logger.error("AI alert persist failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to persist AI alert" }, { status: 500 });
  }
}

export async function GET() {
  try {
    await getAuthenticatedUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("UNAUTHORIZED", "Authentication required.", 401);
  }

  try {
    const alerts = await prisma.aIAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return NextResponse.json({ ok: true, alerts });
  } catch {
    return NextResponse.json({ error: "Failed to fetch AI alerts" }, { status: 500 });
  }
}
