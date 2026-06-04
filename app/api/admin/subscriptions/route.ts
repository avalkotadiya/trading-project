import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { forbiddenResponse, hasRole } from "@/lib/permissions";

export async function GET() {
  try {
    const actor = await getAuthenticatedUser();
    if (!hasRole(actor, "ADMIN")) return forbiddenResponse();

    const [subscriptions, statusGroups, paidAgg] = await Promise.all([
      prisma.userSubscription.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
          plan: { select: { key: true, name: true, priceInr: true } }
        }
      }),
      prisma.userSubscription.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amountInr: true } })
    ]);

    const byStatus = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count._all])
    ) as Record<string, number>;

    return ok({
      subscriptions,
      summary: {
        total: subscriptions.length,
        active: byStatus.ACTIVE ?? 0,
        trialing: byStatus.TRIALING ?? 0,
        canceled: byStatus.CANCELED ?? 0,
        pastDue: byStatus.PAST_DUE ?? 0,
        lifetimeRevenueInr: paidAgg._sum.amountInr ?? 0
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("ADMIN_SUBSCRIPTIONS_FAILED", "Failed to load subscriptions.", 500);
  }
}
