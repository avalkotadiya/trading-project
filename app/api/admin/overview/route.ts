import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "admin:overview", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many admin requests.", 429);
  }

  try {
    const user = await getAuthenticatedUser();

    if (!hasRole(user, "ADMIN")) {
      return forbiddenResponse();
    }

    if (!isDatabaseConfigured()) {
      return ok({ users: 1, alerts: 0, watchlists: 0, subscriptions: 0, invoices: 0, auditLogs: [] });
    }

    const [users, alerts, watchlists, subscriptions, invoices, auditLogs] = await Promise.all([
      prisma.user.count(),
      prisma.alert.count(),
      prisma.watchlist.count(),
      prisma.userSubscription.count(),
      prisma.invoice.count(),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 })
    ]);

    return ok({ users, alerts, watchlists, subscriptions, invoices, auditLogs });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("ADMIN_OVERVIEW_FAILED", "Unable to load admin overview.", 500);
  }
}
