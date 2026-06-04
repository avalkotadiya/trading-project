import type { NextRequest } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getConfiguredRoleForEmail, isDatabaseConfigured } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { authRateLimit } from "@/lib/auth-rate-limit";
import { createSession, clearSession } from "@/lib/session";
import { signUpSchema } from "@/lib/validators";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const limit = await authRateLimit(request, "sign-up", 8, 60);

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many sign-up attempts. Please wait a minute and try again.", 429);
  }

  if (!isDatabaseConfigured()) {
    return fail("DATABASE_NOT_CONFIGURED", "Database authentication is not configured.", 503);
  }

  try {
    const payload = await request.json();
    const parsed = signUpSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Enter a valid name, email, and password.", 422, parsed.error.flatten());
    }

    const freePlan = await prisma.subscriptionPlan.findUnique({
      where: { key: "free" },
      select: { id: true }
    });
    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.user.create({
      data: {
        clerkId: `email:${parsed.data.email}`,
        email: parsed.data.email,
        name: parsed.data.name,
        role: getConfiguredRoleForEmail(parsed.data.email),
        passwordHash,
        subscriptions: freePlan
          ? {
              create: {
                planId: freePlan.id,
                status: "ACTIVE",
                currentPeriodStart: new Date()
              }
            }
          : undefined
      }
    });

    await clearSession();
    await createSession(user.id);
    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "auth.sign_up",
      entity: "User",
      entityId: user.id,
      request
    });

    return ok(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = error as Prisma.PrismaClientKnownRequestError;
      if (prismaError.code === "P2002") {
        return fail("EMAIL_ALREADY_EXISTS", "An account with this email already exists.", 409);
      }
    }

    logger.error("SIGN_UP_FAILED", { error: error instanceof Error ? error.message : String(error) });
    return fail("SIGN_UP_FAILED", "Unable to create account right now.", 500);
  }
}
