"use client";

import { TrendingUp, TrendingDown, Minus, ArrowUpDown } from "lucide-react";
import type { MarketPulseCategory, StockSignal } from "@/types/market-pulse";
import { cn } from "@/utils/cn";

// ─── Signal Animal Icon ───────────────────────────────────────────────────────

function SignalIcon({ signal }: { signal: StockSignal["signal"] }) {
  if (signal === "bullish") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0d2416]">
        {/* Bull silhouette SVG */}
        <svg viewBox="0 0 20 16" className="h-5 w-5 fill-[#22c55e]" aria-label="Bull">
          <path d="M3 2 Q2 0 1 1 Q0 2 1 3 L3 3 Q3 2 3 2Z" />
          <path d="M17 2 Q18 0 19 1 Q20 2 19 3 L17 3 Q17 2 17 2Z" />
          <ellipse cx="10" cy="7" rx="7" ry="4.5" />
          <ellipse cx="10" cy="5" rx="3.5" ry="3" />
          <rect x="4" y="11" width="2.5" height="4" rx="1.2" />
          <rect x="7.5" y="11" width="2.5" height="4" rx="1.2" />
          <rect x="10.5" y="11" width="2.5" height="4" rx="1.2" />
          <rect x="14" y="11" width="2.5" height="4" rx="1.2" />
        </svg>
      </div>
    );
  }
  if (signal === "bearish") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2a0d0d]">
        {/* Bear silhouette SVG */}
        <svg viewBox="0 0 20 16" className="h-5 w-5 fill-[#ef4444]" aria-label="Bear">
          <circle cx="7.5" cy="4.5" r="2.5" />
          <circle cx="12.5" cy="4.5" r="2.5" />
          <circle cx="5" cy="2.5" r="1.5" />
          <circle cx="15" cy="2.5" r="1.5" />
          <ellipse cx="10" cy="8.5" rx="7.5" ry="5" />
          <rect x="3.5" y="12" width="2.5" height="4" rx="1.2" />
          <rect x="7" y="13" width="2.5" height="3" rx="1.2" />
          <rect x="10.5" y="13" width="2.5" height="3" rx="1.2" />
          <rect x="14" y="12" width="2.5" height="4" rx="1.2" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800">
      <Minus className="h-3.5 w-3.5 text-slate-500" />
    </div>
  );
}

// ─── Mini Candlestick (Intraday Boost) ────────────────────────────────────────

function MiniCandlestick({ signal }: { signal: StockSignal["signal"] }) {
  const bars = signal === "bullish"
    ? [
        { h: 6, body: 4, top: 2, color: "#22c55e", wick: true },
        { h: 9, body: 6, top: 1, color: "#22c55e", wick: true },
        { h: 12, body: 8, top: 2, color: "#22c55e", wick: true },
      ]
    : signal === "bearish"
    ? [
        { h: 12, body: 8, top: 2, color: "#ef4444", wick: true },
        { h: 9, body: 5, top: 1, color: "#ef4444", wick: true },
        { h: 6, body: 3, top: 2, color: "#ef4444", wick: true },
      ]
    : [
        { h: 8, body: 5, top: 1, color: "#94a3b8", wick: true },
        { h: 10, body: 6, top: 2, color: "#22c55e", wick: true },
        { h: 7, body: 4, top: 1, color: "#ef4444", wick: true },
      ];

  return (
    <svg viewBox="0 0 24 18" className="h-5 w-6" aria-label="Candlestick chart">
      {bars.map((bar, i) => (
        <g key={i} transform={`translate(${i * 8 + 2}, ${18 - bar.h})`}>
          {/* wick */}
          <line x1="2" y1="0" x2="2" y2={bar.top} stroke={bar.color} strokeWidth="0.8" opacity="0.6" />
          {/* body */}
          <rect x="0" y={bar.top} width="4" height={bar.body} rx="0.5" fill={bar.color} opacity="0.9" />
        </g>
      ))}
    </svg>
  );
}

// ─── Stock logo (initials fallback) ──────────────────────────────────────────

function StockAvatar({ symbol, signal }: { symbol: string; signal: StockSignal["signal"] }) {
  const color =
    signal === "bullish" ? "from-emerald-900 to-emerald-800 ring-emerald-700/40"
    : signal === "bearish" ? "from-red-950 to-red-900 ring-red-800/40"
    : "from-slate-800 to-slate-700 ring-slate-700/40";

  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ring-1 text-[10px] font-extrabold tracking-tight text-white",
        color
      )}
    >
      {symbol.replace(/[-&]/g, "").slice(0, 3)}
    </div>
  );
}

// ─── Sgn% display value: maps 1-99 scale → signed -49 to +49 ─────────────────

function toSignedSgn(signalPercent: number) {
  return (signalPercent - 50).toFixed(2);
}

// ─── Row skeletons ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 animate-pulse">
          <div className="h-9 w-9 rounded-full bg-white/[0.05]" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-20 rounded bg-white/[0.05]" />
            <div className="h-2 w-28 rounded bg-white/[0.03]" />
          </div>
          <div className="h-3 w-12 rounded bg-white/[0.05]" />
          <div className="h-3 w-10 rounded bg-white/[0.05]" />
          <div className="h-3 w-10 rounded bg-white/[0.03]" />
          <div className="h-8 w-8 rounded-full bg-white/[0.05]" />
        </div>
      ))}
    </>
  );
}

// ─── Breakout / Top-Level / Low-Level row ─────────────────────────────────────

function BreakoutRow({ signal }: { signal: StockSignal }) {
  const isPos = signal.percentChange > 0;
  const isNeg = signal.percentChange < 0;
  const sgnNum = Number(toSignedSgn(signal.signalPercent));
  const sgnPos = sgnNum > 0;
  const sgnNeg = sgnNum < 0;

  return (
    <div className="group flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.03]">
      {/* Logo */}
      <StockAvatar symbol={signal.symbol} signal={signal.signal} />

      {/* Symbol + company */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight text-white">{signal.symbol}</p>
        <p className="truncate text-[10px] text-slate-500 max-w-[90px]">{signal.companyName}</p>
      </div>

      {/* % chg */}
      <div
        className={cn(
          "w-16 text-right text-sm font-bold tabular-nums",
          isPos ? "text-[#22c55e]" : isNeg ? "text-[#ef4444]" : "text-slate-400"
        )}
      >
        {isPos ? "+" : ""}{signal.percentChange.toFixed(2)}%
      </div>

      {/* Sgn % */}
      <div
        className={cn(
          "w-14 text-right text-xs font-semibold tabular-nums",
          sgnPos ? "text-[#22c55e]" : sgnNeg ? "text-[#ef4444]" : "text-slate-400"
        )}
      >
        {sgnPos ? "+" : ""}{toSignedSgn(signal.signalPercent)}
      </div>

      {/* Time */}
      <div className="w-12 text-right text-[10px] text-slate-500 tabular-nums">
        {signal.time}
      </div>

      {/* Signal icon */}
      <SignalIcon signal={signal.signal} />
    </div>
  );
}

// ─── Intraday Boost row ───────────────────────────────────────────────────────

function IntradayRow({ signal }: { signal: StockSignal }) {
  const isPos = signal.percentChange > 0;
  const isNeg = signal.percentChange < 0;

  return (
    <div className="group flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.03]">
      {/* Logo */}
      <StockAvatar symbol={signal.symbol} signal={signal.signal} />

      {/* Symbol + company */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-tight text-white">{signal.symbol}</p>
        <p className="truncate text-[10px] text-slate-500 max-w-[90px]">{signal.companyName}</p>
      </div>

      {/* Mini candlestick */}
      <div className="flex items-center gap-1">
        <MiniCandlestick signal={signal.signal} />
      </div>

      {/* R.Fac + % chg */}
      <div className="w-24 text-right">
        <p className="text-xs font-bold text-slate-300">
          R.Fac{" "}
          <span className="text-white">{signal.rFactor.toFixed(2)}</span>
        </p>
        <p
          className={cn(
            "text-[10px] font-semibold tabular-nums flex items-center justify-end gap-0.5",
            isPos ? "text-[#22c55e]" : isNeg ? "text-[#ef4444]" : "text-slate-400"
          )}
        >
          {isPos ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : isNeg ? (
            <TrendingDown className="h-2.5 w-2.5" />
          ) : null}
          {isPos ? "+" : ""}{signal.percentChange.toFixed(2)}%
        </p>
      </div>

      {/* Signal icon */}
      <SignalIcon signal={signal.signal} />
    </div>
  );
}

// ─── Table header ─────────────────────────────────────────────────────────────

function BreakoutHeader({
  sortBy,
  onSort,
}: {
  sortBy: string;
  onSort: (col: string) => void;
}) {
  const col = (label: string, key: string, right = true) => (
    <button
      onClick={() => onSort(key)}
      className={cn(
        "flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 transition-colors hover:text-slate-300",
        right ? "ml-auto" : ""
      )}
    >
      {label}
      <ArrowUpDown className={cn("h-2.5 w-2.5", sortBy === key ? "text-cyan-400" : "")} />
    </button>
  );

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2 bg-slate-900/50">
      <div className="w-9 shrink-0" />
      <div className="flex-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Symbol</div>
      <div className="w-16">{col("% Chg", "Highest % Change")}</div>
      <div className="w-14">{col("Sgn %", "Strongest Signal %")}</div>
      <div className="w-12 text-right text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Time</div>
      <div className="w-8 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Sgn</div>
    </div>
  );
}

function IntradayHeader({
  sortBy,
  onSort,
}: {
  sortBy: string;
  onSort: (col: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-2 bg-slate-900/50">
      <div className="w-9 shrink-0" />
      <div className="flex-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Symbol</div>
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Chart</div>
      <div className="w-24">
        <button
          onClick={() => onSort("R-Factor")}
          className="ml-auto flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 transition-colors hover:text-slate-300"
        >
          R.Fac
          <ArrowUpDown className={cn("h-2.5 w-2.5", sortBy === "R-Factor" ? "text-cyan-400" : "")} />
        </button>
      </div>
      <div className="w-8 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">Sgn</div>
    </div>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

interface CompactTableProps {
  signals: StockSignal[];
  category: MarketPulseCategory;
  loading: boolean;
  sortBy: string;
  onSort: (col: string) => void;
}

export function CompactScannerTable({ signals, category, loading, sortBy, onSort }: CompactTableProps) {
  const isIntraday = category === "intraday-boost";

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#050d1a] overflow-hidden">
      {isIntraday ? (
        <IntradayHeader sortBy={sortBy} onSort={onSort} />
      ) : (
        <BreakoutHeader sortBy={sortBy} onSort={onSort} />
      )}

      {loading && signals.length === 0 ? (
        <SkeletonRows />
      ) : signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-slate-500">No signals found</p>
          <p className="mt-1 text-xs text-slate-600">Try changing the filters</p>
        </div>
      ) : (
        signals.map((sig) =>
          isIntraday ? (
            <IntradayRow key={`${sig.exchange}-${sig.symbol}`} signal={sig} />
          ) : (
            <BreakoutRow key={`${sig.exchange}-${sig.symbol}`} signal={sig} />
          )
        )
      )}
    </div>
  );
}
