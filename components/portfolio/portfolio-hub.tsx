"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Loader2, Plus, Trash2, ShieldCheck, AlertCircle, Sparkles,
  TrendingUp, TrendingDown, Wallet, PieChart, ListOrdered, LayoutGrid, Activity, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SymbolSearchDropdown } from "@/components/shared/symbol-search-dropdown";
import { useLiveMarket } from "@/hooks/use-live-market";
import type { PortfolioAnalytics, PortfolioHoldingSummary } from "@/types/platform";
import { cn } from "@/utils/cn";
import { formatCurrency, formatPercent } from "@/utils/format";

type OrderRow = {
  id: string;
  symbol: string;
  direction: string;
  quantity: number;
  orderType: string;
  status: string;
  entryPrice: number | null;
  exitPrice: number | null;
  pnl: number | null;
  strategy: string | null;
  createdAt: string;
};

type Props = {
  initialHoldings: PortfolioHoldingSummary[];
  initialAnalytics: PortfolioAnalytics;
  orders: OrderRow[];
  token?: string;
};

type Tab = "overview" | "holdings" | "orders" | "manage";

const TABS: { id: Tab; label: string; icon: typeof PieChart }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "holdings", label: "Holdings", icon: PieChart },
  { id: "orders", label: "Orders", icon: ListOrdered },
  { id: "manage", label: "Manage", icon: Plus }
];

const ORDER_FILTERS = ["ALL", "FILLED", "PENDING", "REJECTED", "CANCELLED"] as const;

const STATUS_STYLE: Record<string, string> = {
  FILLED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PENDING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  REJECTED: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  CANCELLED: "bg-rose-500/10 text-rose-400 border-rose-500/20"
};

const AVATAR_PALETTE = [
  "from-emerald-900 to-emerald-800 ring-emerald-700/40",
  "from-cyan-900 to-cyan-800 ring-cyan-700/40",
  "from-indigo-900 to-indigo-800 ring-indigo-700/40",
  "from-amber-900 to-amber-800 ring-amber-700/40",
  "from-rose-900 to-rose-800 ring-rose-700/40"
];

function SymbolAvatar({ symbol }: { symbol: string }) {
  const idx = symbol.charCodeAt(0) % AVATAR_PALETTE.length;
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ring-1 text-[10px] font-extrabold text-white",
        AVATAR_PALETTE[idx]
      )}
    >
      {symbol.replace(/[-&]/g, "").slice(0, 3)}
    </div>
  );
}

export function PortfolioHub({ initialHoldings, orders, token }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [holdings, setHoldings] = useState(initialHoldings);

  const holdingSymbols = useMemo(() => holdings.map((h) => `NSE:${h.symbol}`), [holdings]);
  const { ticks, connectionStatus } = useLiveMarket([], token, holdingSymbols);

  const livePriceBySymbol = useMemo(
    () => Object.fromEntries(ticks.map((t) => [t.symbol, t.price])),
    [ticks]
  );

  const liveHoldings = useMemo(
    () =>
      holdings.map((h) => {
        const livePrice = livePriceBySymbol[h.symbol];
        if (!livePrice || livePrice <= 0) return h;
        const marketValue = h.quantity * livePrice;
        const invested = h.quantity * h.averagePrice;
        const unrealizedPnl = marketValue - invested;
        return {
          ...h,
          lastPrice: livePrice,
          marketValue,
          unrealizedPnl,
          unrealizedPnlPercent: invested > 0 ? (unrealizedPnl / invested) * 100 : 0
        };
      }),
    [holdings, livePriceBySymbol]
  );

  const liveAnalytics = useMemo<PortfolioAnalytics>(() => {
    const totalInvested = liveHoldings.reduce((s, h) => s + h.quantity * h.averagePrice, 0);
    const totalMarketValue = liveHoldings.reduce((s, h) => s + h.marketValue, 0);
    const unrealizedPnl = totalMarketValue - totalInvested;
    return {
      totalInvested,
      totalMarketValue,
      unrealizedPnl,
      unrealizedPnlPercent: totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0,
      holdingsCount: liveHoldings.length,
      winners: liveHoldings.filter((h) => h.unrealizedPnl >= 0).length,
      losers: liveHoldings.filter((h) => h.unrealizedPnl < 0).length
    };
  }, [liveHoldings]);

  const realizedPnl = useMemo(
    () => orders.filter((o) => o.pnl != null).reduce((s, o) => s + (o.pnl ?? 0), 0),
    [orders]
  );
  const totalPnl = liveAnalytics.unrealizedPnl + realizedPnl;

  const allocation = useMemo(() => {
    const total = liveAnalytics.totalMarketValue || 1;
    return [...liveHoldings]
      .map((h) => ({ ...h, weight: (h.marketValue / total) * 100 }))
      .sort((a, b) => b.weight - a.weight);
  }, [liveHoldings, liveAnalytics.totalMarketValue]);

  const topMovers = useMemo(
    () => [...liveHoldings].sort((a, b) => b.unrealizedPnlPercent - a.unrealizedPnlPercent),
    [liveHoldings]
  );

  // Manage form state
  const [symbol, setSymbol] = useState("RELIANCE");
  const [quantity, setQuantity] = useState("10");
  const [averagePrice, setAveragePrice] = useState("2900");
  const [lastPrice, setLastPrice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [orderFilter, setOrderFilter] = useState<(typeof ORDER_FILTERS)[number]>("ALL");

  const [aiAnalysis, setAiAnalysis] = useState<{ risk_score: number; suggestion: string; portfolio_beta: number; vix_exposure: number } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [coachQuestion, setCoachQuestion] = useState("How risky is my portfolio for a normal investor?");
  const [isCoachLoading, setIsCoachLoading] = useState(false);
  const [coachOutput, setCoachOutput] = useState<{
    summary: string;
    alerts: Array<{ title: string; message: string; level: "low" | "medium" | "high" }>;
    actions: string[];
    answer: string | null;
  } | null>(null);

  async function refreshPortfolio() {
    const response = await fetch("/api/portfolio");
    const payload = await response.json();
    if (response.ok && payload.ok) {
      setHoldings(payload.data.holdings);
    }
  }

  function saveHolding() {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            quantity: Number(quantity),
            averagePrice: Number(averagePrice),
            lastPrice: lastPrice ? Number(lastPrice) : undefined
          })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Unable to save holding.");
        await refreshPortfolio();
        setMessage("Holding saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to save holding.");
      }
    });
  }

  function deleteHolding(id: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Unable to delete holding.");
        await refreshPortfolio();
        setMessage("Holding deleted.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to delete holding.");
      }
    });
  }

  async function handleAiAnalyze() {
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/ai/portfolio-hedge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(liveHoldings)
      });
      const data = await response.json();
      if (response.ok) setAiAnalysis(data);
    } catch (err) {
      console.error("AI Analysis failed", err);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCoachAnalyze() {
    setIsCoachLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ai/portfolio-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: liveHoldings.map((item) => ({
            symbol: item.symbol,
            quantity: item.quantity,
            averagePrice: item.averagePrice,
            lastPrice: item.lastPrice,
            marketValue: item.marketValue,
            unrealizedPnl: item.unrealizedPnl,
            unrealizedPnlPercent: item.unrealizedPnlPercent
          })),
          analytics: liveAnalytics,
          question: coachQuestion
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Unable to generate coach guidance.");
      setCoachOutput(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to generate coach guidance.");
    } finally {
      setIsCoachLoading(false);
    }
  }

  const visibleOrders = orderFilter === "ALL" ? orders : orders.filter((o) => o.status === orderFilter);
  const isLive = connectionStatus === "live";
  const pnlUp = liveAnalytics.unrealizedPnl >= 0;

  return (
    <div className="space-y-6">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-[#071018] via-[#050d16] to-[#0a0612] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-glow/10 blur-[90px]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-soft/80">
              <Wallet className="h-3.5 w-3.5" /> Portfolio &amp; Orders
              <span
                className={cn(
                  "ml-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px]",
                  isLive ? "bg-emerald-500/10 text-emerald-400" : "bg-white/[0.05] text-slate-500"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-600")} />
                {connectionStatus}
              </span>
            </div>
            <p className="mt-3 font-mono text-4xl font-black tracking-tight text-white md:text-5xl">
              {formatCurrency(Math.round(liveAnalytics.totalMarketValue))}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold tabular-nums",
                  pnlUp ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                )}
              >
                {pnlUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                {formatCurrency(Math.round(liveAnalytics.unrealizedPnl))} ({formatPercent(liveAnalytics.unrealizedPnlPercent)})
              </span>
              <span className="text-slate-500">unrealized today</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            {[
              { label: "Invested", value: formatCurrency(Math.round(liveAnalytics.totalInvested)) },
              { label: "Realized P&L", value: formatCurrency(Math.round(realizedPnl)), tone: realizedPnl >= 0 },
              { label: "Net P&L", value: formatCurrency(Math.round(totalPnl)), tone: totalPnl >= 0 },
              { label: "Win / Loss", value: `${liveAnalytics.winners} / ${liveAnalytics.losers}` }
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">{kpi.label}</p>
                <p
                  className={cn(
                    "mt-1.5 font-mono text-lg font-bold tabular-nums",
                    kpi.tone === undefined ? "text-white" : kpi.tone ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.06] bg-slate-900/40 p-1 no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-bold transition-all",
                active
                  ? "bg-[#0d1f35] text-white shadow-md ring-1 ring-cyan-500/20"
                  : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-cyan-400" : "text-slate-600")} />
              {t.label}
              {t.id === "orders" && (
                <span className="rounded-full bg-white/[0.06] px-1.5 text-[10px] text-slate-400">{orders.length}</span>
              )}
              {t.id === "holdings" && (
                <span className="rounded-full bg-white/[0.06] px-1.5 text-[10px] text-slate-400">{liveHoldings.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Overview ──────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><PieChart className="h-4 w-4 text-cyan-soft" /> Allocation</CardTitle>
              <span className="text-xs text-slate-500">{allocation.length} positions</span>
            </CardHeader>
            <CardContent className="space-y-3">
              {allocation.length === 0 ? (
                <p className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
                  No holdings yet. Add positions in the Manage tab.
                </p>
              ) : (
                allocation.map((h) => (
                  <div key={h.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white">{h.symbol}</span>
                      <span className="tabular-nums text-slate-400">
                        {h.weight.toFixed(1)}% · {formatCurrency(Math.round(h.marketValue))}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className={cn("h-full rounded-full", h.unrealizedPnl >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                        style={{ width: `${Math.max(2, h.weight)}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-soft" /> Top movers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {topMovers.slice(0, 5).map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <SymbolAvatar symbol={h.symbol} />
                      <div>
                        <p className="text-sm font-semibold text-white">{h.symbol}</p>
                        <p className="text-[10px] text-slate-500">{h.quantity} qty</p>
                      </div>
                    </div>
                    <span className={cn("flex items-center gap-1 text-sm font-semibold tabular-nums", h.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {h.unrealizedPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {formatPercent(h.unrealizedPnlPercent)}
                    </span>
                  </div>
                ))}
                {topMovers.length === 0 && <p className="text-sm text-slate-500">No positions to rank.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ListOrdered className="h-4 w-4 text-cyan-soft" /> Recent orders</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {orders.slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold text-white">{o.symbol}</span>
                      <span className={cn("ml-2 font-bold uppercase", o.direction === "BUY" ? "text-emerald-400" : "text-rose-400")}>{o.direction}</span>
                    </div>
                    <span className="tabular-nums text-slate-400">{o.quantity} @ {o.entryPrice != null ? formatCurrency(o.entryPrice) : "—"}</span>
                  </div>
                ))}
                {orders.length === 0 && <p className="text-sm text-slate-500">No orders yet.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Holdings ──────────────────────────────────────────── */}
      {tab === "holdings" && (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Live holdings</CardTitle>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 border-cyan-glow/30 text-cyan-soft hover:bg-cyan-glow/10"
              onClick={handleAiAnalyze}
              disabled={isAnalyzing || liveHoldings.length === 0}
            >
              {isAnalyzing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
              AI Risk Scan
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {aiAnalysis && (
              <div className={cn(
                "m-4 rounded-xl border p-4",
                aiAnalysis.risk_score > 60 ? "border-rose-500/30 bg-rose-500/5" : "border-cyan-glow/30 bg-cyan-glow/[0.05]"
              )}>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center rounded-lg border border-white/5 bg-black/20 px-4 py-2">
                    <span className="text-[9px] uppercase tracking-widest text-slate-500">Risk</span>
                    <span className={cn("text-2xl font-bold", aiAnalysis.risk_score > 70 ? "text-rose-400" : aiAnalysis.risk_score > 40 ? "text-amber-400" : "text-emerald-400")}>
                      {aiAnalysis.risk_score}
                    </span>
                  </div>
                  <p className="flex-1 text-sm italic leading-relaxed text-slate-200">&quot;{aiAnalysis.suggestion}&quot;</p>
                </div>
              </div>
            )}
            {liveHoldings.length === 0 ? (
              <p className="p-12 text-center text-sm text-slate-500">No holdings. Add positions in the Manage tab.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Symbol</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Avg</th>
                      <th className="px-4 py-3 text-right">LTP</th>
                      <th className="px-4 py-3 text-right">Mkt Value</th>
                      <th className="px-4 py-3 text-right">P&L</th>
                      <th className="px-4 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {liveHoldings.map((h) => (
                      <tr key={h.id} className="hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <SymbolAvatar symbol={h.symbol} />
                            <span className="font-semibold text-white">{h.symbol}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">{h.quantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-400">{formatCurrency(Math.round(h.averagePrice))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-cyan-soft">{h.lastPrice ? formatCurrency(h.lastPrice) : "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-white">{formatCurrency(Math.round(h.marketValue))}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={h.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            {formatCurrency(Math.round(h.unrealizedPnl))}
                            <span className="ml-1 text-[10px] opacity-70">({formatPercent(h.unrealizedPnlPercent)})</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                            onClick={() => deleteHolding(h.id)}
                            disabled={isPending}
                            aria-label={`Delete ${h.symbol}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Orders ────────────────────────────────────────────── */}
      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1">
            {ORDER_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setOrderFilter(f)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition",
                  orderFilter === f
                    ? "bg-cyan-glow/[0.18] text-cyan-soft ring-1 ring-inset ring-cyan-500/20"
                    : "bg-white/[0.06] text-slate-400 hover:bg-white/[0.10] hover:text-white"
                )}
              >
                {f === "ALL"
                  ? `All (${orders.length})`
                  : `${f.charAt(0)}${f.slice(1).toLowerCase()} (${orders.filter((o) => o.status === f).length})`}
              </button>
            ))}
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {visibleOrders.length === 0 ? (
                <p className="p-12 text-center text-sm text-slate-500">No orders found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Symbol</th>
                        <th className="px-4 py-3 text-left">Side</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3 text-right">Entry</th>
                        <th className="px-4 py-3 text-right">Exit</th>
                        <th className="px-4 py-3 text-right">P&L</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {visibleOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-white/[0.03]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <SymbolAvatar symbol={o.symbol} />
                              <span className="font-medium text-white">{o.symbol}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("text-xs font-bold uppercase", o.direction === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                              {o.direction}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{o.quantity}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{o.entryPrice != null ? formatCurrency(o.entryPrice) : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-300">{o.exitPrice != null ? formatCurrency(o.exitPrice) : "—"}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {o.pnl != null ? (
                              <span className={o.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                {o.pnl >= 0 ? "+" : ""}{formatCurrency(o.pnl)}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex rounded border px-2 py-0.5 text-[10px] font-medium", STATUS_STYLE[o.status] ?? "border-slate-700 bg-slate-700/30 text-slate-400")}>
                              {o.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {new Date(o.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Manage ────────────────────────────────────────────── */}
      {tab === "manage" && (
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-cyan-soft" /> Add holding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SymbolSearchDropdown value={symbol} onChange={setSymbol} placeholder="Select any symbol" />
              <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantity" type="number" />
              <Input value={averagePrice} onChange={(e) => setAveragePrice(e.target.value)} placeholder="Average price" type="number" />
              <Input value={lastPrice} onChange={(e) => setLastPrice(e.target.value)} placeholder="Last price (optional)" type="number" />
              <Button className="w-full" onClick={saveHolding} disabled={isPending}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Save holding
              </Button>
              {message ? <p className="rounded-md border border-white/10 bg-white/[0.05] p-3 text-sm text-slate-300">{message}</p> : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03]">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-soft" /> AI Portfolio Coach</CardTitle>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 border-cyan-glow/30 text-cyan-soft hover:bg-cyan-glow/10"
                onClick={handleCoachAnalyze}
                disabled={isCoachLoading || liveHoldings.length === 0}
              >
                {isCoachLoading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
                Generate advice
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={coachQuestion} onChange={(e) => setCoachQuestion(e.target.value)} placeholder="Ask in plain English..." />
              {coachOutput ? (
                <div className="space-y-3 rounded-md border border-white/10 bg-black/20 p-4">
                  <p className="text-sm text-slate-200">{coachOutput.summary}</p>
                  {coachOutput.answer ? <p className="text-sm text-cyan-soft">{coachOutput.answer}</p> : null}
                  <div className="space-y-2">
                    {coachOutput.alerts.map((a) => (
                      <div key={a.title} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                        <p className="flex items-center gap-2 text-sm font-medium text-white">
                          {a.level === "high" ? <AlertCircle className="h-3.5 w-3.5 text-rose-400" /> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
                          {a.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">{a.message}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {coachOutput.actions.map((item) => (
                      <p key={item} className="text-xs text-slate-300">— {item}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Explains your portfolio in plain words with practical next steps.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
