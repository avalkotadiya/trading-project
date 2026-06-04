import { PortfolioHub } from "@/components/portfolio/portfolio-hub";
import { getAuthenticatedUser, isDatabaseConfigured } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPortfolioAnalytics, mapHolding } from "@/services/portfolio-service";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await getAuthenticatedUser();

  const [holdings, rawOrders] = isDatabaseConfigured()
    ? await Promise.all([
        prisma.portfolioHolding.findMany({
          where: { userId: user.id },
          orderBy: { updatedAt: "desc" }
        }),
        prisma.order.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            symbol: true,
            direction: true,
            quantity: true,
            orderType: true,
            status: true,
            entryPrice: true,
            exitPrice: true,
            pnl: true,
            strategy: true,
            createdAt: true
          }
        })
      ])
    : [[], []];

  const mapped = holdings.map(mapHolding);
  const orders = rawOrders.map((o) => ({
    id: o.id,
    symbol: o.symbol,
    direction: o.direction,
    quantity: o.quantity,
    orderType: o.orderType,
    status: o.status,
    entryPrice: o.entryPrice != null ? Number(o.entryPrice) : null,
    exitPrice: o.exitPrice != null ? Number(o.exitPrice) : null,
    pnl: o.pnl != null ? Number(o.pnl) : null,
    strategy: o.strategy,
    createdAt: o.createdAt.toISOString()
  }));

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";

  return (
    <div className="space-y-6">
      <PortfolioHub
        initialHoldings={mapped}
        initialAnalytics={getPortfolioAnalytics(mapped)}
        orders={orders}
        token={token}
      />
    </div>
  );
}
