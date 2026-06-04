import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import { getAuthenticatedUser, isDatabaseConfigured, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { portfolioHoldingSchema } from "@/lib/validators";
import { getPortfolioAnalytics, mapHolding } from "@/services/portfolio-service";

export async function GET(request: NextRequest) {
  const limit = await rateLimit(request, "portfolio", { limit: 80 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many portfolio requests.", 429);
  }

  try {
    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return ok({ holdings: [], analytics: getPortfolioAnalytics([]), mode: "unconfigured" });
    }

    const holdings = await prisma.portfolioHolding.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" }
    });
    const mapped = holdings.map(mapHolding);

    return ok({ holdings: mapped, analytics: getPortfolioAnalytics(mapped), mode: "database" });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("PORTFOLIO_FETCH_FAILED", "Unable to load portfolio.", 500);
  }
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "portfolio:write", { limit: 40 });

  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many portfolio writes.", 429);
  }

  try {
    const payload = await request.json();
    const parsed = portfolioHoldingSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Portfolio payload is invalid.", 422, parsed.error.flatten());
    }

    const user = await getAuthenticatedUser();

    if (!isDatabaseConfigured()) {
      return fail("DATABASE_NOT_CONFIGURED", "Database is required to save portfolio holdings.", 503);
    }

    const holding = await prisma.portfolioHolding.upsert({
      where: {
        userId_symbol: {
          userId: user.id,
          symbol: parsed.data.symbol
        }
      },
      update: {
        quantity: parsed.data.quantity,
        averagePrice: parsed.data.averagePrice,
        lastPrice: parsed.data.lastPrice,
        broker: parsed.data.broker,
        notes: parsed.data.notes
      },
      create: {
        userId: user.id,
        symbol: parsed.data.symbol,
        quantity: parsed.data.quantity,
        averagePrice: parsed.data.averagePrice,
        lastPrice: parsed.data.lastPrice,
        broker: parsed.data.broker,
        notes: parsed.data.notes
      }
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "portfolio.upsert",
      entity: "PortfolioHolding",
      entityId: holding.id,
      metadata: { symbol: holding.symbol },
      request
    });

    return ok({ holding: mapHolding(holding), mode: "database" }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }

    return fail("PORTFOLIO_SAVE_FAILED", "Unable to save holding.", 500);
  }
}
