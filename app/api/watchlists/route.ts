import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { isAdminGrantedPro } from "@/lib/platform-data";
import { rateLimit } from "@/lib/rate-limit";
import { watchlistSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "watchlists", { limit: 80 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many watchlist requests.", 429);
  }

  try {
    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return ok({
        watchlists: [],
        mode: "unconfigured"
      });
    }

    const watchlists = await prisma.watchlist.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" }
    });

    return ok({ watchlists, mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("WATCHLIST_FETCH_FAILED", "Unable to load watchlists.", 500);
  }
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "watchlists:create", { limit: 30 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many watchlist writes.", 429);
  }

  try {
    const payload = await request.json();
    const parsed = watchlistSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Watchlist payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to create watchlists.", 503);
    }

    // Admins/owners bypass the per-plan cap entirely (granted Pro by role).
    // Skip the subscription lookup too — saves a DB round-trip for them.
    const hasAdminGrant = isAdminGrantedPro(user);
    const currentPlanKey = hasAdminGrant
      ? "pro"
      : (await prisma.userSubscription.findFirst({
          where: {
            userId: user.id,
            status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] }
          },
          include: { plan: { select: { key: true } } },
          orderBy: { updatedAt: "desc" }
        }))?.plan.key ?? "free";

    if (currentPlanKey === "free") {
      const existingWatchlists = await prisma.watchlist.findMany({
        where: { userId: user.id },
        select: { symbols: true }
      });
      const existingSymbols = new Set(existingWatchlists.flatMap((watchlist) => watchlist.symbols));

      for (const symbol of parsed.data.symbols) {
        existingSymbols.add(symbol);
      }

      if (existingSymbols.size > 5) {
        return fail("PLAN_LIMIT_REACHED", "Free plan supports up to 5 unique watchlist symbols.", 403);
      }
    }

    const watchlist = await prisma.watchlist.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        symbols: parsed.data.symbols
      }
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "watchlist.create",
      entity: "Watchlist",
      entityId: watchlist.id,
      metadata: { symbols: watchlist.symbols },
      request
    });

    return ok({ watchlist, mode: "database" }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("WATCHLIST_CREATE_FAILED", "Unable to create watchlist.", 500);
  }
}
