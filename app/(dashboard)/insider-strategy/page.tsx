"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, TrendingDown, TrendingUp, RefreshCcw } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";

type Signal = {
  symbol: string;
  companyName: string;
  price: number;
  percentChange: number;
  moneyFlux: number;
  relativeVolume: number;
  relativeStrength: number;
  conviction: number;
  bias: "accumulation" | "distribution";
  time: string;
};

type ApiData = {
  signals: Signal[];
  source?: "live" | "stale" | "unavailable";
  updatedAt?: string;
};

const POLL_MS = 12000;

export default function InsiderStrategyPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [source, setSource] = useState<"live" | "stale" | "unavailable">("live");
  const [requestError, setRequestError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const res = await fetch("/api/insider-strategy", { cache: "no-store" });
      if (!res.ok) {
        const message =
          res.status === 429 ? "Rate limited. Retrying automatically..." : "Feed temporarily unavailable.";
        if (mountedRef.current) setRequestError(message);
        return;
      }

      const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: ApiData } | null;
      if (!mountedRef.current) return;
      if (json?.ok && Array.isArray(json.data?.signals)) {
        setSignals(json.data.signals);
        setUpdatedAt(typeof json.data.updatedAt === "string" ? json.data.updatedAt : new Date().toISOString());
        setSource(
          json.data.source === "stale" || json.data.source === "unavailable" ? json.data.source : "live"
        );
        setRequestError(null);
      }
    } catch {
      if (mountedRef.current) setRequestError("Network issue while refreshing insider feed.");
    } finally {
      if (mountedRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const onVisibility = () => {
      if (!document.hidden) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">
            <Crosshair className="h-4 w-4" /> Insider Strategy
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">Smart-money footprint</h1>
          <p className="mt-1 text-xs text-slate-500">
            Order-flow imbalance amplified by abnormal participation (|flux| x RVOL).
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Feed:{" "}
            <span
              className={cn(
                source === "stale" ? "text-amber-400" : source === "unavailable" ? "text-rose-400" : "text-emerald-400"
              )}
            >
              {source}
            </span>
            {updatedAt ? ` | Updated ${new Date(updatedAt).toLocaleTimeString("en-IN")}` : ""}
          </p>
          {requestError ? <p className="mt-1 text-[11px] text-amber-400">{requestError}</p> : null}
        </div>
        <button
          onClick={() => void load()}
          className="rounded-full border border-white/[0.08] bg-white/[0.03] p-2 text-slate-500 transition hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCcw className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#050d1a]">
        <div className="flex items-center gap-3 border-b border-white/[0.06] bg-slate-900/50 px-4 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">
          <div className="flex-1">Symbol</div>
          <div className="w-20 text-right">% Chg</div>
          <div className="w-16 text-right">RVOL</div>
          <div className="w-16 text-right">Flux</div>
          <div className="w-24 text-right">Conviction</div>
        </div>
        {loading && signals.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">Scanning order flow...</div>
        ) : signals.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No high-conviction smart-money activity right now.
          </div>
        ) : (
          signals.map((s) => {
            const acc = s.bias === "accumulation";
            const dist = s.bias === "distribution";
            return (
              <div
                key={s.symbol}
                className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-white">
                    {s.symbol}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                        acc
                          ? "bg-emerald-500/15 text-emerald-400"
                          : dist
                            ? "bg-rose-500/15 text-rose-400"
                            : "bg-slate-700/40 text-slate-400"
                      )}
                    >
                      {s.bias}
                    </span>
                  </p>
                  <p className="truncate text-[10px] text-slate-500">
                    {formatCurrency(s.price)} | {s.time}
                  </p>
                </div>
                <div
                  className={cn(
                    "w-20 text-right text-sm font-bold tabular-nums",
                    s.percentChange >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  )}
                >
                  {s.percentChange > 0 ? "+" : ""}
                  {s.percentChange.toFixed(2)}%
                </div>
                <div className="w-16 text-right text-xs tabular-nums text-cyan-soft">
                  {s.relativeVolume.toFixed(2)}x
                </div>
                <div
                  className={cn(
                    "w-16 text-right text-xs font-semibold tabular-nums",
                    s.moneyFlux >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}
                >
                  {s.moneyFlux > 0 ? "+" : ""}
                  {s.moneyFlux.toFixed(0)}
                </div>
                <div className="flex w-24 items-center justify-end gap-1">
                  {acc ? (
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  ) : dist ? (
                    <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                  ) : null}
                  <span className="font-mono text-sm font-black text-white tabular-nums">{s.conviction}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
