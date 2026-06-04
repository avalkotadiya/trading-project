"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import type { ScannerBeta, ScannerSector } from "@/services/scanner-pro";
import { cn } from "@/utils/cn";

const SECTORS: ScannerSector[] = [
  "All", "Nifty 50", "Bank Nifty", "Indices",
  "Financials", "IT", "Energy", "Metals", "Auto", "FMCG",
  "Pharma", "Cement & Infra", "Chemicals", "Capital Goods",
  "Real Estate", "Discretionary", "Telecom", "Diversified",
];

const DIRECTIONS = ["All", "Bullish", "Bearish", "Neutral"];
const BETAS: ScannerBeta[] = ["All", "High", "Medium", "Low"];
const SORTS = ["Strongest Signal %", "R-Factor", "Highest % Change", "Lowest % Change", "Latest Time"];

interface ScannerFiltersProps {
  sector: ScannerSector;
  beta: ScannerBeta;
  direction: string;
  sortBy: string;
  search: string;
  onSectorChange: (v: ScannerSector) => void;
  onBetaChange: (v: ScannerBeta) => void;
  onDirectionChange: (v: string) => void;
  onSortChange: (v: string) => void;
  onSearchChange: (v: string) => void;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all whitespace-nowrap",
        active
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
          : "border-white/[0.08] bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200"
      )}
    >
      {children}
    </button>
  );
}

export function ScannerFilters({
  sector, beta, direction, sortBy, search,
  onSectorChange, onBetaChange, onDirectionChange, onSortChange, onSearchChange,
}: ScannerFiltersProps) {
  return (
    <div className="space-y-3">
      {/* Search + Sort row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 transition-colors peer-focus:text-cyan-400" />
          <input
            placeholder="Search symbol..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="peer h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-xs text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
          />
        </div>

        <div className="relative">
          <SlidersHorizontal className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            aria-label="Sort by"
            className="h-9 appearance-none rounded-xl border border-white/[0.08] bg-white/[0.03] pl-7 pr-6 text-xs text-slate-300 focus:border-cyan-500/40 focus:outline-none transition-all"
          >
            {SORTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Direction pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Signal</span>
        {DIRECTIONS.map((d) => (
          <Pill key={d} active={direction === d} onClick={() => onDirectionChange(d)}>
            {d}
          </Pill>
        ))}

        <div className="mx-1 h-4 w-px shrink-0 bg-white/[0.08]" />

        {/* Beta pills */}
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">β</span>
        {BETAS.map((b) => (
          <Pill key={b} active={beta === b} onClick={() => onBetaChange(b)}>
            {b}
          </Pill>
        ))}
      </div>

      {/* Sector scroll */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">Sector</span>
        {SECTORS.map((s) => (
          <Pill key={s} active={sector === s} onClick={() => onSectorChange(s)}>
            {s}
          </Pill>
        ))}
      </div>
    </div>
  );
}
