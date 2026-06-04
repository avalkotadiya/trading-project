"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft, Radio, RefreshCcw, TrendingUp, TrendingDown, Activity, Info,
} from "lucide-react";
import type { MarketPulseCategory, MarketPulseResponse } from "@/types/market-pulse";
import type { ScannerBeta, ScannerSector } from "@/services/scanner-pro";
import { SCANNER_PRO_SYMBOLS, buildScannerSignals } from "@/services/scanner-pro";
import { ScannerTabs } from "@/components/scanner-pro/scanner-tabs";
import { ScannerFilters } from "@/components/scanner-pro/scanner-filters";
import { ScannerFeatureCard } from "@/components/scanner-pro/feature-card";
import { CompactScannerTable } from "@/components/scanner-pro/compact-table";
import { BottomNavigation } from "@/components/layout/bottom-nav";
import { FloatingHelpButton } from "@/components/layout/floating-help";
import { useLiveMarket } from "@/hooks/use-live-market";
import { cn } from "@/utils/cn";

export default function ScannerProPage() {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [category, setCategory] = useState<MarketPulseCategory>("breakout-beacon");
  const [sector, setSector] = useState<ScannerSector>("All");
  const [beta, setBeta] = useState<ScannerBeta>("All");
  const [direction, setDirection] = useState("All");
  const [sortBy, setSortBy] = useState("Strongest Signal %");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── API fetch (snapshot) ─────────────────────────────────────────────────
  const queryParams = new URLSearchParams({
    sector,
    beta,
    direction: direction.toLowerCase(),
    sortBy,
    search: debouncedSearch,
    page: "1",
    limit: "80",
  });
  const endpoint = `/api/scanner-pro/${category}?${queryParams}`;

  const [data, setData] = useState<MarketPulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(endpoint, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((json: MarketPulseResponse) => { setData(json); setFetchError(null); })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name !== "AbortError") setFetchError(e.message);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [endpoint]);

  // ── Live WebSocket ticks ─────────────────────────────────────────────────
  const { ticks, connectionStatus, error: liveError } = useLiveMarket(
    [], undefined, SCANNER_PRO_SYMBOLS
  );

  // Build live signals when ticks arrive
  const livePulse = useMemo(
    () =>
      buildScannerSignals(ticks, category, {
        sector,
        beta,
        direction,
        sortBy,
        search: debouncedSearch,
        page: 1,
        limit: 80,
      }),
    [category, sector, beta, direction, sortBy, debouncedSearch, ticks]
  );

  // Once live ticks have arrived, the live-derived signals are the single
  // source of truth so every filter stays in sync with the streaming data.
  // The API snapshot is only used for the initial paint before ticks land.
  const hasLive = ticks.length > 0;
  const signals = useMemo(
    () => (hasLive ? livePulse.data : data?.data ?? []),
    [hasLive, livePulse.data, data]
  );
  const total = hasLive ? livePulse.total : data?.pagination?.total ?? 0;

  // ── Stats ────────────────────────────────────────────────────────────────
  const advancers = signals.filter((s) => s.percentChange > 0).length;
  const decliners = signals.filter((s) => s.percentChange < 0).length;
  const breadth = (advancers / (advancers + decliners || 1)) * 100;
  const topRFac = [...signals].sort((a, b) => b.rFactor - a.rFactor)[0];

  // ── Market sentiment (TradeFinder-style derived analytics) ───────────────
  const sentiment = useMemo(() => {
    if (signals.length === 0) {
      return { dial: 0, netFlux: 0, avgRvol: 0, rsLeader: null as (typeof signals)[number] | null };
    }
    const bull = signals.filter((s) => s.signal === "bullish").length;
    const bear = signals.filter((s) => s.signal === "bearish").length;
    const dial = Math.round(((bull - bear) / signals.length) * 100); // -100..100
    const netFlux = Math.round(
      signals.reduce((acc, s) => acc + (s.moneyFlux ?? 0), 0) / signals.length
    );
    const avgRvol =
      signals.reduce((acc, s) => acc + (s.relativeVolume ?? 1), 0) / signals.length;
    const rsLeader = [...signals].sort(
      (a, b) => (b.relativeStrength ?? 0) - (a.relativeStrength ?? 0)
    )[0];
    return { dial, netFlux, avgRvol: Number(avgRvol.toFixed(2)), rsLeader };
  }, [signals]);
  const sentimentLabel =
    sentiment.dial > 25 ? "Risk-On" : sentiment.dial < -25 ? "Risk-Off" : "Neutral";

  // Sort handler — toggle or change
  const handleSort = useCallback((col: string) => {
    setSortBy((prev) => (prev === col ? "Strongest Signal %" : col));
  }, []);

  const isLive = connectionStatus === "live";

  return (
    <div className="min-h-screen bg-[#030a15] pb-24 text-slate-200">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#030a15]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="group flex items-center gap-1 text-slate-500 transition-colors hover:text-white"
            >
              <ChevronLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
              <span className="hidden text-xs font-medium sm:inline">Back</span>
            </Link>
            <div className="h-5 w-px bg-white/10" />
            <div>
              <h1 className="text-base font-black tracking-tight text-white">Market Scanner</h1>
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">
                {SCANNER_PRO_SYMBOLS.length}+ symbols · All sectors
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={cn(
                "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 sm:flex",
                isLive
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-white/[0.08] bg-white/[0.03]"
              )}
            >
              <Radio
                className={cn(
                  "h-2.5 w-2.5",
                  isLive ? "text-emerald-400 animate-pulse" : "text-slate-600"
                )}
              />
              <span
                className={cn(
                  "text-[9px] font-bold uppercase tracking-wider",
                  isLive ? "text-emerald-400" : "text-slate-600"
                )}
              >
                {connectionStatus}
              </span>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] p-2 text-slate-500 transition-all hover:bg-white/[0.08] hover:text-white"
              aria-label="Refresh"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
        {/* ── Quick stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Total signals */}
          <div className="rounded-2xl border border-white/[0.06] bg-slate-900/30 p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Signals</p>
            <p className="mt-2 text-2xl font-black text-white">{total}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">Active · {category.replace("-", " ")}</p>
          </div>

          {/* Breadth */}
          <div className="rounded-2xl border border-white/[0.06] bg-slate-900/30 p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Breadth</p>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-xl font-black text-[#22c55e]">{advancers}</span>
              <span className="text-xs text-slate-600">vs</span>
              <span className="text-xl font-black text-[#ef4444]">{decliners}</span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#ef4444]/20">
              <div
                className="h-full rounded-full bg-[#22c55e] transition-all [width:var(--breadth)]"
                style={{ "--breadth": `${breadth}%` } as React.CSSProperties}
              />
            </div>
          </div>

          {/* Top R-Factor */}
          <div className="rounded-2xl border border-white/[0.06] bg-slate-900/30 p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Top R.Fac</p>
            <p className="mt-2 text-2xl font-black text-white">{topRFac?.rFactor.toFixed(2) ?? "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">{topRFac?.symbol ?? "Scanning..."}</p>
          </div>

          {/* Universe */}
          <div className="rounded-2xl border border-white/[0.06] bg-slate-900/30 p-4">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Universe</p>
            <p className="mt-2 text-2xl font-black text-white">{SCANNER_PRO_SYMBOLS.length}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">Stocks tracked</p>
          </div>
        </div>

        {/* ── Market sentiment strip ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.06] bg-slate-900/30 p-4 sm:grid-cols-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Sentiment</p>
            <p
              className={cn(
                "mt-1 text-2xl font-black",
                sentiment.dial > 25 ? "text-[#22c55e]" : sentiment.dial < -25 ? "text-[#ef4444]" : "text-slate-300"
              )}
            >
              {sentiment.dial > 0 ? "+" : ""}{sentiment.dial}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-600">{sentimentLabel}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn(
                  "h-full rounded-full transition-all [width:var(--sdial)]",
                  sentiment.dial >= 0 ? "bg-[#22c55e]" : "bg-[#ef4444] ml-auto"
                )}
                style={{ "--sdial": `${Math.min(100, Math.abs(sentiment.dial))}%` } as React.CSSProperties}
              />
            </div>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Net Money Flux</p>
            <p className={cn("mt-1 text-2xl font-black", sentiment.netFlux >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}>
              {sentiment.netFlux > 0 ? "+" : ""}{sentiment.netFlux}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-600">Order-flow bias</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Avg RVOL</p>
            <p className="mt-1 text-2xl font-black text-white">{sentiment.avgRvol.toFixed(2)}x</p>
            <p className="mt-0.5 text-[10px] text-slate-600">Participation</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">RS Leader</p>
            <p className="mt-1 truncate text-2xl font-black text-cyan-glow">{sentiment.rsLeader?.symbol ?? "—"}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">
              {sentiment.rsLeader ? `RS ${sentiment.rsLeader.relativeStrength?.toFixed(0)}` : "Scanning..."}
            </p>
          </div>
        </div>

        {/* ── Category tabs ────────────────────────────────────────────── */}
        <ScannerTabs active={category} onChange={(c) => { setCategory(c); setSortBy("Strongest Signal %"); }} />

        {/* ── Feature card ─────────────────────────────────────────────── */}
        <ScannerFeatureCard category={category} />

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <ScannerFilters
          sector={sector}
          beta={beta}
          direction={direction}
          sortBy={sortBy}
          search={search}
          onSectorChange={setSector}
          onBetaChange={setBeta}
          onDirectionChange={setDirection}
          onSortChange={setSortBy}
          onSearchChange={setSearch}
        />

        {/* ── Error banners ─────────────────────────────────────────────── */}
        {(fetchError || liveError) && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
            <Info className="h-4 w-4 shrink-0" />
            {liveError || "Viewing latest market snapshot — live sync paused."}
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <CompactScannerTable
          signals={signals}
          category={category}
          loading={loading && signals.length === 0}
          sortBy={sortBy}
          onSort={handleSort}
        />

        {/* ── Pagination hint ───────────────────────────────────────────── */}
        {total > 80 && (
          <p className="text-center text-[10px] text-slate-600">
            Showing top 80 of {total} signals. Refine filters to narrow results.
          </p>
        )}

        {/* ── Legend ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-center gap-4 rounded-2xl border border-white/[0.04] bg-slate-900/20 px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <TrendingUp className="h-3 w-3 text-[#22c55e]" />
            Bullish signal
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <TrendingDown className="h-3 w-3 text-[#ef4444]" />
            Bearish signal
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Activity className="h-3 w-3 text-cyan-500" />
            Sgn% = (Signal Score − 50) · higher = stronger conviction
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="font-bold text-slate-400">β</span>
            Beta filter classifies stocks by volatility
          </div>
        </div>
      </main>

      <FloatingHelpButton />
      <BottomNavigation />
    </div>
  );
}
