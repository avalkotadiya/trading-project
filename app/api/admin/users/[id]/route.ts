import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { writeAuditLog } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

const ROLES = ["OWNER", "ADMIN", "ANALYST", "TRADER", "VIEWER"] as const;
const patchSchema = z.object({ role: z.enum(ROLES) });

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const actor = await getAuthenticatedUser();
    if (!hasRole(actor, "ADMIN")) return forbiddenResponse();

    const { id } = await context.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        autoTradeEnabled: true,
        maxAutoTradeAmount: true,
        balance: true,
        subscriptions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            plan: { select: { key: true, name: true, priceInr: true } }
          }
        },
        _count: {
          select: { watchlists: true, alerts: true, portfolio: true, orders: true, invoices: true }
        }
      }
    });

    if (!user) return fail("NOT_FOUND", "User not found.", 404);

    return ok({
      user: {
        ...user,
        maxAutoTradeAmount: Number(user.maxAutoTradeAmount),
        balance: Number(user.balance)
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("ADMIN_USER_DETAIL_FAILED", "Failed to load user.", 500);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await getAuthenticatedUser();

    if (actor.role !== "OWNER" && actor.role !== "ADMIN") {
      return fail("FORBIDDEN", "You do not have permission to change roles.", 403);
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "A valid role is required.", 422, parsed.error.flatten());
    }
    const { role } = parsed.data;

    if (id === actor.id) {
      return fail("FORBIDDEN", "You cannot change your own role.", 403);
    }
    if (role === "OWNER" && actor.role !== "OWNER") {
      return fail("FORBIDDEN", "Only an OWNER can promote someone to OWNER.", 403);
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { role: true, email: true } });
    if (!target) return fail("NOT_FOUND", "User not found.", 404);
    if (target.role === "OWNER" && actor.role !== "OWNER") {
      return fail("FORBIDDEN", "Only an OWNER can modify another OWNER.", 403);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, name: true, role: true }
    });

    await writeAuditLog({
      userId: actor.id,
      actorEmail: actor.email,
      action: "ADMIN_ROLE_CHANGE",
      entity: "User",
      entityId: id,
      metadata: { from: target.role, to: role, targetEmail: target.email },
      request
    });

    return ok({ user: updatedUser });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("ADMIN_ROLE_UPDATE_FAILED", "Failed to update user role.", 500);
  }
}
