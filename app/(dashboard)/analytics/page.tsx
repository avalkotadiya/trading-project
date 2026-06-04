import { Activity, BrainCircuit, PieChart, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAuthenticatedUser, isDatabaseConfigured } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSignalLeaderboard } from "@/services/ai/signal-leaderboard.service";
import { getAdvancedScannerResults } from "@/services/market-service";
import { getPortfolioAnalytics, mapHolding } from "@/services/portfolio-service";
import { formatCurrency, formatPercent } from "@/utils/format";

export default async function AnalyticsPage() {
  const user = await getAuthenticatedUser();
  const scannerResults = await getAdvancedScannerResults();
  const signals = buildSignalLeaderboard(scannerResults, 4);
  const holdings = isDatabaseConfigured()
    ? await prisma.portfolioHolding.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } })
    : [];
  const analytics = getPortfolioAnalytics(holdings.map(mapHolding));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Advanced analytics</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Analytics cockpit</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <PieChart className="h-5 w-5 text-cyan-soft" />
          <p className="mt-3 text-sm text-slate-400">Portfolio value</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(Math.round(analytics.totalMarketValue))}</p>
        </Card>
        <Card className="p-5">
          <Activity className="h-5 w-5 text-cyan-soft" />
          <p className="mt-3 text-sm text-slate-400">Unrealized P&L</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatCurrency(Math.round(analytics.unrealizedPnl))}</p>
          <p className="mt-1 text-xs text-slate-500">{formatPercent(analytics.unrealizedPnlPercent)}</p>
        </Card>
        <Card className="p-5">
          <BrainCircuit className="h-5 w-5 text-cyan-soft" />
          <p className="mt-3 text-sm text-slate-400">AI signals</p>
          <p className="mt-2 text-2xl font-semibold text-white">{signals.length}</p>
        </Card>
        <Card className="p-5">
          <ShieldCheck className="h-5 w-5 text-cyan-soft" />
          <p className="mt-3 text-sm text-slate-400">Risk posture</p>
          <p className="mt-2 text-2xl font-semibold text-white">{analytics.losers > analytics.winners ? "Defensive" : "Balanced"}</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI signal leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {signals.map((signal) => (
            <div key={signal.symbol} className="rounded-md border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">{signal.symbol}</p>
                <Badge tone={signal.direction === "BULLISH" ? "green" : "red"}>{signal.direction.toLowerCase()}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">{signal.summary}</p>
              <p className="mt-3 text-sm font-medium text-cyan-soft">{signal.confidence}% confidence</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
