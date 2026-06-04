import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Grant (or extend) a Pro subscription for a user.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: userId } = await context.params;
    const actor = await getAuthenticatedUser();
    if (!hasRole(actor, "ADMIN")) {
      return fail("FORBIDDEN", "You do not have permission to manage subscriptions.", 403);
    }

    const proPlan = await prisma.subscriptionPlan.findUnique({ where: { key: "pro" } });
    if (!proPlan) {
      return fail("PLAN_NOT_FOUND", "Pro plan not found. Seed subscription plans first.", 404);
    }

    const existing = await prisma.userSubscription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    const subscription = existing
      ? await prisma.userSubscription.update({
          where: { id: existing.id },
          data: {
            planId: proPlan.id,
            status: "ACTIVE",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + ONE_YEAR_MS)
          },
          select: { id: true, status: true, currentPeriodEnd: true }
        })
      : await prisma.userSubscription.create({
          data: {
            userId,
            planId: proPlan.id,
            status: "ACTIVE",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + ONE_YEAR_MS)
          },
          select: { id: true, status: true, currentPeriodEnd: true }
        });

    await writeAuditLog({
      userId: actor.id,
      actorEmail: actor.email,
      action: "ADMIN_SUBSCRIPTION_GRANT",
      entity: "UserSubscription",
      entityId: subscription.id,
      metadata: { targetUserId: userId, plan: proPlan.key },
      request
    });

    return ok({
      subscription: {
        ...subscription,
        plan: { key: proPlan.key, name: proPlan.name }
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    logger.error("Admin subscription grant failed", { error: error instanceof Error ? error.message : String(error) });
    return fail("ADMIN_SUBSCRIBE_FAILED", "Failed to grant subscription.", 500);
  }
}

// Revoke / cancel a user's active subscription.
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: userId } = await context.params;
    const actor = await getAuthenticatedUser();
    if (!hasRole(actor, "ADMIN")) {
      return fail("FORBIDDEN", "You do not have permission to manage subscriptions.", 403);
    }

    const existing = await prisma.userSubscription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    if (!existing) {
      return fail("NOT_FOUND", "User has no subscription to revoke.", 404);
    }

    await prisma.userSubscription.update({
      where: { id: existing.id },
      data: { status: "CANCELED", currentPeriodEnd: new Date() }
    });

    await writeAuditLog({
      userId: actor.id,
      actorEmail: actor.email,
      action: "ADMIN_SUBSCRIPTION_REVOKE",
      entity: "UserSubscription",
      entityId: existing.id,
      metadata: { targetUserId: userId },
      request
    });

    return ok({ revoked: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("ADMIN_REVOKE_FAILED", "Failed to revoke subscription.", 500);
  }
}
