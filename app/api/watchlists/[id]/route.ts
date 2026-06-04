import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { watchlistSchema } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "watchlists:update", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many watchlist updates.", 429);
  }

  try {
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = watchlistSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Watchlist payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to update watchlists.", 503);
    }

    const result = await prisma.watchlist.updateMany({
      where: { id, userId: user.id },
      data: parsed.data
    });

    if (result.count === 0) {
      return fail("NOT_FOUND", "Watchlist was not found.", 404);
    }

    const watchlist = await prisma.watchlist.findFirst({
      where: { id, userId: user.id }
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "watchlist.update",
      entity: "Watchlist",
      entityId: id,
      request
    });

    return ok({ watchlist, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("WATCHLIST_UPDATE_FAILED", "Unable to update watchlist.", 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const limit = await rateLimit(request, "watchlists:delete", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many watchlist deletes.", 429);
  }

  try {
    const { id } = await context.params;
    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to delete watchlists.", 503);
    }

    const result = await prisma.watchlist.deleteMany({
      where: { id, userId: user.id }
    });

    if (result.count === 0) {
      return fail("NOT_FOUND", "Watchlist was not found.", 404);
    }

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "watchlist.delete",
      entity: "Watchlist",
      entityId: id,
      request
    });

    return ok({ deleted: true, id, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("WATCHLIST_DELETE_FAILED", "Unable to delete watchlist.", 500);
  }
}
