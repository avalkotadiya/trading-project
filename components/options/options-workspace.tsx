"use client";

import { Activity, BarChart3, Gauge, ShieldAlert, Sparkles, TrendingUp, TrendingDown, Zap, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OptionChainRow, PutCallRatio } from "@/types/market";
import { formatCompact, formatPrice } from "@/utils/format";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { useLiveMarket } from "@/hooks/use-live-market";
import { MarketSymbolSelector } from "@/components/shared/market-symbol-selector";

type OptionsWorkspaceProps = {
  pcr: PutCallRatio[];
  chain: OptionChainRow[];
  overview: {
    totalCallOi: number;
    totalPutOi: number;
    maxPain: number;
    maxOi: number;
    sentiment: string;
    symbol?: string;
    spotPrice?: number;
    expiry?: string;
    expiries?: string[];
    source?: "dhan" | "unavailable";
    updatedAt?: string;
  };
  token?: string;
};

type OptionsResponse = {
  ok: boolean;
  data?: {
    pcr: PutCallRatio[];
    optionChain: OptionChainRow[];
    overview: OptionsWorkspaceProps["overview"];
  };
  error?: {
    message?: string;
  };
};

const sentimentTone = {
  bullish: "green",
  bearish: "red",
  neutral: "slate"
} as const;

export function OptionsWorkspace({ pcr, chain, overview, token }: OptionsWorkspaceProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(overview.symbol ?? "NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState(overview.expiry ?? "");
  const [livePcr, setLivePcr] = useState(pcr);
  const [liveChain, setLiveChain] = useState(chain);
  const [liveOverview, setLiveOverview] = useState(overview);
  const [isRefreshingChain, setIsRefreshingChain] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [nlpInsight, setNlpInsight] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [tradeMessage, setTradeMessage] = useState<string | null>(null);
  
  // Connect to live AI signal and alert feed
  const { signal, alerts } = useLiveMarket([], token); 

  async function refreshOptionChain(symbol = selectedSymbol, expiry = selectedExpiry) {
    setIsRefreshingChain(true);
    setChainError(null);
    try {
      const params = new URLSearchParams({ symbol });
      if (expiry && expiry !== "unavailable") params.set("expiry", expiry);
      const response = await fetch(`/api/options?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as OptionsResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? "Option chain refresh failed.");
      }
      setLivePcr(payload.data.pcr);
      setLiveChain(payload.data.optionChain);
      setLiveOverview(payload.data.overview);
      setSelectedSymbol(payload.data.overview.symbol ?? symbol);
      setSelectedExpiry(payload.data.overview.expiry ?? expiry);
    } catch (error) {
      setChainError(error instanceof Error ? error.message : "Option chain refresh failed.");
    } finally {
      setIsRefreshingChain(false);
    }
  }


  async function handleNlpAnalyze() {
    setIsAnalyzing(true);
    try {
      const highestCall = Math.max(...liveChain.map(r => r.callOi));
      const highestPut = Math.max(...liveChain.map(r => r.putOi));
      const highestCallStrike = liveChain.find(r => r.callOi === highestCall)?.strike || 0;
      const highestPutStrike = liveChain.find(r => r.putOi === highestPut)?.strike || 0;

      const res = await fetch("/api/ai/options-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: liveOverview.symbol ?? selectedSymbol,
          spot_price: liveOverview.spotPrice ?? 0,
          put_call_ratio: livePcr[0]?.value || 1.0,
          max_pain_strike: liveOverview.maxPain,
          highest_call_oi: highestCallStrike,
          highest_put_oi: highestPutStrike,
          implied_volatility: 18.5
        })
      });
      const data = await res.json();
      setNlpInsight(data.insight ?? data.error ?? "Options AI analysis is unavailable right now.");
    } catch (err) {
      console.error(err);
      setNlpInsight("Options AI analysis could not be generated. Try again after market data refreshes.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleQuickTrade() {
    if (!signal) return;
    setIsExecuting(true);
    setTradeMessage(null);
    
    try {
      const res = await fetch("/api/execution/paper-trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: signal.symbol,
          direction: signal.direction === "BULLISH" ? "BUY" : "SELL",
          quantity: 1, // Default to 1 for quick trade
          price: signal.entryPrice,
          orderType: "MARKET",
          strategy: "AI_SIGNAL_QUICK_PAPER"
        })
      });
      
      const data = await res.json();
      if (res.ok && data.ok) {
        setTradeMessage(`Paper Order Filled: ${data.data.order.brokerOrderId}`);
      } else {
        setTradeMessage(`Error: ${data.error?.message || "Failed to place order"}`);
      }
    } catch {
      setTradeMessage("Network error during execution.");
    } finally {
      setIsExecuting(false);
      setTimeout(() => setTradeMessage(null), 5000);
    }
  }



  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-cyan-soft" />
              Put Call Ratio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {livePcr.map((item) => (
              <div key={item.symbol} className="rounded-md border border-white/10 bg-white/[0.05] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-white">{item.symbol}</p>
                  <Badge tone={sentimentTone[item.sentiment]} className="capitalize">
                    {item.sentiment}
                  </Badge>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <p className="text-3xl font-semibold text-white">{item.value.toFixed(2)}</p>
                  <p className="text-sm text-slate-400">Prev {item.previous.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {signal && (
          <Card className={cn(
            "border-trade-green/50 bg-trade-green/10 shadow-[0_0_20px_rgba(34,197,94,0.1)] animate-in fade-in slide-in-from-bottom-4 duration-500",
            signal.direction === "BEARISH" && "border-trade-red/50 bg-trade-red/10 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
          )}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-glow" />
                  LIVE AI SIGNAL
                </CardTitle>
                <Badge tone={signal.direction === "BULLISH" ? "green" : "red"}>{signal.confidence}% Confidence</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-full",
                  signal.direction === "BULLISH" ? "bg-trade-green/20 text-trade-green" : "bg-trade-red/20 text-trade-red"
                )}>
                  {signal.direction === "BULLISH" ? <TrendingUp /> : <TrendingDown />}
                </div>
                <div>
                  <p className="font-bold text-white text-lg">{signal.symbol}</p>
                  <p className="text-xs text-slate-400">{signal.strategy}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-200 leading-relaxed italic">&quot;{signal.summary}&quot;</p>
              <div className="mt-4">
                <Button 
                  className={cn(
                    "w-full h-11 text-xs font-bold uppercase tracking-widest transition-all",
                    signal.direction === "BULLISH" 
                      ? "bg-trade-green text-white hover:bg-trade-green/90 shadow-[0_0_15px_rgba(34,197,94,0.3)]" 
                      : "bg-trade-red text-white hover:bg-trade-red/90 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                  )}
                  onClick={handleQuickTrade}
                  disabled={isExecuting}
                >
                  {isExecuting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2 fill-white" />}
                  Execute Quick Trade
                </Button>
                {tradeMessage && (
                  <p className="mt-2 text-[10px] font-mono text-center text-white/70 animate-in fade-in zoom-in duration-300">
                    {tradeMessage}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-soft" />
              Open Interest
            </CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void refreshOptionChain()}
                disabled={isRefreshingChain}
                className="flex items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08]"
              >
                {isRefreshingChain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                Refresh
              </button>
              <button
                onClick={handleNlpAnalyze}
                disabled={isAnalyzing}
                className="flex items-center gap-1 rounded bg-cyan-glow/10 px-3 py-1.5 text-xs font-medium text-cyan-soft border border-cyan-glow/20 hover:bg-cyan-glow/20 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isAnalyzing ? "Analyzing..." : "AI Analyze"}
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <MarketSymbolSelector
                value={selectedSymbol}
                onSelect={(inst) => {
                  const sym = inst.symbol || inst.tradingSymbol;
                  setSelectedSymbol(sym);
                  void refreshOptionChain(sym, "");
                }}
                placeholder="Select index or stock…"
                defaultCategory="indices"
                filterSegments={["IDX_I", "NSE_EQ", "NSE_FNO"]}
              />
              <select
                aria-label="Expiry"
                value={selectedExpiry}
                onChange={(event) => {
                  const nextExpiry = event.target.value;
                  setSelectedExpiry(nextExpiry);
                  void refreshOptionChain(selectedSymbol, nextExpiry);
                }}
                className="h-10 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm text-white"
                disabled={!liveOverview.expiries?.length}
              >
                {(liveOverview.expiries?.length ? liveOverview.expiries : [selectedExpiry || "unavailable"]).map((expiry) => (
                  <option key={expiry} value={expiry}>{expiry}</option>
                ))}
              </select>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-400">
              Source <b className="text-white">{liveOverview.source === "dhan" ? "DhanHQ live option-chain" : "Unavailable until DhanHQ is configured"}</b>
              {liveOverview.spotPrice ? <> · Spot <b className="text-white">{formatPrice(liveOverview.spotPrice)}</b></> : null}
              {liveOverview.updatedAt ? <> · Updated <b className="text-white">{new Date(liveOverview.updatedAt).toLocaleTimeString("en-IN")}</b></> : null}
            </div>
            {chainError && (
              <div className="rounded-md border border-trade-amber/30 bg-trade-amber/10 p-3 text-xs text-trade-amber">
                {chainError}
              </div>
            )}
            {nlpInsight && (
              <div className="rounded-md border border-cyan-glow/30 bg-cyan-glow/[0.05] p-4 text-sm leading-relaxed text-slate-300 shadow-[0_0_15px_rgba(0,255,255,0.05)]">
                <span className="font-semibold text-cyan-soft block mb-1">AI Insight:</span>
                <span>
                  {nlpInsight.split(/\*\*(.*?)\*\*/g).map((part, i) =>
                    i % 2 === 1
                      ? <strong key={i} className="text-white font-bold">{part}</strong>
                      : part
                  )}
                </span>
              </div>
            )}
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-400">Call OI</span>
                <span className="text-white">{formatCompact(liveOverview.totalCallOi)}</span>
              </div>
              <progress
                className="h-3 w-full appearance-none overflow-hidden rounded-full bg-white/10 [&::-moz-progress-bar]:bg-trade-red [&::-webkit-progress-bar]:bg-white/10 [&::-webkit-progress-value]:bg-trade-red"
                value={liveOverview.totalCallOi}
                max={liveOverview.totalCallOi + liveOverview.totalPutOi}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-slate-400">Put OI</span>
                <span className="text-white">{formatCompact(liveOverview.totalPutOi)}</span>
              </div>
              <progress
                className="h-3 w-full appearance-none overflow-hidden rounded-full bg-white/10 [&::-moz-progress-bar]:bg-trade-green [&::-webkit-progress-bar]:bg-white/10 [&::-webkit-progress-value]:bg-trade-green"
                value={liveOverview.totalPutOi}
                max={liveOverview.totalCallOi + liveOverview.totalPutOi}
              />
            </div>
            <div className="rounded-md border border-cyan-glow/20 bg-cyan-glow/10 p-4">
              <p className="text-sm text-slate-400">Max pain</p>
              <p className="mt-1 text-2xl font-semibold text-white">{liveOverview.maxPain}</p>
              <p className="mt-2 text-sm text-cyan-soft">{liveOverview.sentiment}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-trade-red/30 bg-trade-red/5">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <ShieldAlert className="h-5 w-5 text-trade-red" />
            <CardTitle className="text-sm uppercase tracking-wider text-trade-red">Quant Risk Engine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts && alerts.length > 0 ? (
              alerts.map((alert, idx) => (
                <div key={idx} className="rounded border border-trade-red/20 bg-trade-red/10 p-3 animate-pulse-subtle">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-white uppercase">{alert.type}</p>
                    <Badge tone="red" className="text-[10px] px-1.5 h-4">{alert.risk_level}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-300 leading-relaxed">{alert.message}</p>
                  <div className="mt-2 text-[10px] font-mono text-trade-red/80">
                    ACTION: {alert.action}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 italic">Monitoring global risk vectors... (No active threats)</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-soft" />
            Option chain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {liveChain.map((row) => (
              <article key={row.strike} className="rounded-md border border-white/10 bg-white/[0.05] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Strike</p>
                  <p className="text-lg font-semibold text-cyan-soft">{row.strike}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md bg-trade-red/10 p-3">
                    <p className="text-slate-400">Call OI</p>
                    <p className="mt-1 font-medium text-trade-red">{formatCompact(row.callOi)}</p>
                    <p className="mt-1 text-xs text-slate-500">Chg {formatCompact(row.callChangeOi)}</p>
                    <p className="mt-1 text-xs text-white">LTP {formatPrice(row.callLtp)}</p>
                  </div>
                  <div className="rounded-md bg-trade-green/10 p-3">
                    <p className="text-slate-400">Put OI</p>
                    <p className="mt-1 font-medium text-trade-green">{formatCompact(row.putOi)}</p>
                    <p className="mt-1 text-xs text-slate-500">Chg {formatCompact(row.putChangeOi)}</p>
                    <p className="mt-1 text-xs text-white">LTP {formatPrice(row.putLtp)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-center text-sm">
              <thead className="text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr className="border-b border-white/10">
                  <th className="pb-3">Call OI</th>
                  <th className="pb-3">Chg OI</th>
                  <th className="pb-3">Call LTP</th>
                  <th className="pb-3 text-cyan-soft">Strike</th>
                  <th className="pb-3">Put LTP</th>
                  <th className="pb-3">Chg OI</th>
                  <th className="pb-3">Put OI</th>
                </tr>
              </thead>
              <tbody>
                {liveChain.map((row) => (
                  <tr key={row.strike} className="border-b border-white/10 last:border-0">
                    <td className="py-4 text-trade-red">{formatCompact(row.callOi)}</td>
                    <td className="py-4 text-slate-300">{formatCompact(row.callChangeOi)}</td>
                    <td className="py-4 text-white">{formatPrice(row.callLtp)}</td>
                    <td className="py-4 text-base font-semibold text-cyan-soft">{row.strike}</td>
                    <td className="py-4 text-white">{formatPrice(row.putLtp)}</td>
                    <td className="py-4 text-slate-300">{formatCompact(row.putChangeOi)}</td>
                    <td className="py-4 text-trade-green">{formatCompact(row.putOi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
