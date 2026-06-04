import { Activity, RadioTower, Sparkles } from "lucide-react";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { Badge } from "@/components/ui/badge";
import { DASHBOARD_SYMBOLS } from "@/lib/constants";
import { getDashboardData } from "@/lib/platform-data";
import { getMarketSnapshot } from "@/services/market-service";
import { getSectionSymbols } from "@/services/symbols/symbol-registry";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";

const emptyMarket = {
  overview: [],
  ticks: [],
  providerHealth: {
    provider: "dhan" as const,
    status: "error" as const,
    checkedAt: new Date().toISOString(),
    message: "Market data temporarily unavailable.",
    circuitBreakerOpen: true
  }
};

export default async function DashboardPage() {
  const { watchlists, alerts, billingOverview } = await getDashboardData();

  // Pull the dashboard's symbol list from the central registry (India-only).
  // Fall back to the legacy hardcoded list if the registry can't deliver
  // (cold-start cache miss or scrip-master fetch failure) so the page still
  // renders something — same surface as before.
  let dashboardSymbols: string[] = DASHBOARD_SYMBOLS;
  try {
    const view = await getSectionSymbols("dashboard");
    if (view.symbols.length > 0) {
      dashboardSymbols = view.symbols.map((s) => `${s.exchange}:${s.symbol}`);
    }
  } catch (error) {
    console.warn("[Dashboard] Registry unavailable, using hardcoded fallback:", error instanceof Error ? error.message : error);
  }

  let market: Awaited<ReturnType<typeof getMarketSnapshot>>;
  try {
    market = await getMarketSnapshot(dashboardSymbols);
  } catch (error) {
    console.error("[Dashboard] Market data fetch failed:", error instanceof Error ? error.message : error);
    market = emptyMarket;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value || "";

  return (
    <div className="space-y-6">
      <div className="glass-panel depth-card relative rounded-lg p-5 md:p-6">
        <div className="absolute inset-0 bg-market-grid bg-[size:34px_34px] opacity-25" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge tone="cyan" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Live Trading Terminal
            </Badge>
            <h1 className="cinematic-title mt-3 text-3xl font-bold tracking-tight md:text-4xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Real-time market telemetry, AI risk state, broker-ready execution controls, and portfolio context in one command surface.
            </p>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[25rem]">
            <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
              <div className="flex items-center gap-2 text-slate-300">
                <RadioTower className="h-4 w-4 text-trade-green" />
                Market feed
              </div>
              <p className="mt-1 text-lg font-semibold text-white">{market.providerHealth.status}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
              <div className="flex items-center gap-2 text-slate-300">
                <Activity className="h-4 w-4 text-cyan-soft" />
                Last refresh
              </div>
              <p className="mt-1 font-mono text-lg font-semibold text-white">
                {new Date().toLocaleTimeString("en-IN")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <DashboardClient
        watchlists={watchlists}
        alerts={alerts}
        billingOverview={billingOverview}
        market={market}
        token={token}
      />
    </div>
  );
}
