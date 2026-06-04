import type { PortfolioAnalytics, PortfolioHoldingSummary } from "@/types/platform";

export function mapHolding(input: {
  id: string;
  symbol: string;
  quantity: unknown;
  averagePrice: unknown;
  lastPrice: unknown | null;
  broker: string | null;
  notes: string | null;
  updatedAt: Date;
}): PortfolioHoldingSummary {
  const quantity = Number(input.quantity);
  const averagePrice = Number(input.averagePrice);
  const lastPrice = input.lastPrice === null ? averagePrice : Number(input.lastPrice);
  const invested = quantity * averagePrice;
  const marketValue = quantity * lastPrice;
  const unrealizedPnl = marketValue - invested;

  return {
    id: input.id,
    symbol: input.symbol,
    quantity,
    averagePrice,
    lastPrice,
    broker: input.broker,
    notes: input.notes,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent: invested > 0 ? (unrealizedPnl / invested) * 100 : 0,
    updatedAt: input.updatedAt.toISOString()
  };
}

export function getPortfolioAnalytics(holdings: PortfolioHoldingSummary[]): PortfolioAnalytics {
  const totalInvested = holdings.reduce((sum, item) => sum + item.quantity * item.averagePrice, 0);
  const totalMarketValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const unrealizedPnl = totalMarketValue - totalInvested;

  return {
    totalInvested,
    totalMarketValue,
    unrealizedPnl,
    unrealizedPnlPercent: totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0,
    holdingsCount: holdings.length,
    winners: holdings.filter((item) => item.unrealizedPnl >= 0).length,
    losers: holdings.filter((item) => item.unrealizedPnl < 0).length
  };
}
