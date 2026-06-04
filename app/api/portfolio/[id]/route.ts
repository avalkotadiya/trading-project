import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "portfolio:delete", { limit: 40 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many portfolio deletes.", 429);
  }

  try {
    const { id } = await context.params;
    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to delete portfolio holdings.", 503);
    }

    const result = await prisma.portfolioHolding.deleteMany({
      where: { id, userId: user.id }
    });

    if (result.count === 0) {
      return fail("NOT_FOUND", "Holding was not found.", 404);
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "portfolio.delete",
      entity: "PortfolioHolding",
      entityId: id,
      request
    });

    return ok({ deleted: true, id, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("PORTFOLIO_DELETE_FAILED", "Unable to delete holding.", 500);
  }
}
