import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const actor = await getAuthenticatedUser();

    if (!hasRole(actor, "ADMIN")) {
      return forbiddenResponse();
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim().slice(0, 100) ?? "";
    const roleParam = searchParams.get("role")?.trim().toUpperCase() ?? "";

    const VALID_ROLES = new Set(["OWNER", "ADMIN", "ANALYST", "TRADER", "VIEWER"]);
    const roleFilter = VALID_ROLES.has(roleParam) ? roleParam : "";

    const users = await prisma.user.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { name: { contains: q, mode: "insensitive" } }
              ]
            }
          : {}),
        ...(roleFilter
          ? { role: roleFilter as "OWNER" | "ADMIN" | "ANALYST" | "TRADER" | "VIEWER" }
          : {})
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        autoTradeEnabled: true,
        subscriptions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            currentPeriodEnd: true,
            plan: { select: { key: true, name: true } }
          }
        },
        _count: {
          select: { watchlists: true, alerts: true, portfolio: true, orders: true }
        }
      }
    });

    return ok({ users });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }
    return fail("ADMIN_USERS_FAILED", "Failed to fetch users.", 500);
  }
}
