"use client";

import { Zap, TrendingUp, TrendingDown, Activity, LucideIcon } from "lucide-react";
import type { MarketPulseCategory } from "@/types/market-pulse";
import { cn } from "@/utils/cn";

const TABS: { id: MarketPulseCategory; label: string; short: string; icon: LucideIcon; color: string }[] = [
  { id: "breakout-beacon", label: "Breakout Beacon", short: "Breakout", icon: Zap, color: "text-amber-400" },
  { id: "intraday-boost", label: "Intraday Boost", short: "Intraday", icon: Activity, color: "text-cyan-400" },
  { id: "top-level", label: "Top Level", short: "Top Level", icon: TrendingUp, color: "text-emerald-400" },
  { id: "low-level", label: "Low Level", short: "Low Level", icon: TrendingDown, color: "text-rose-400" },
];

interface ScannerTabsProps {
  active: MarketPulseCategory;
  onChange: (id: MarketPulseCategory) => void;
}

export function ScannerTabs({ active, onChange }: ScannerTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar rounded-2xl border border-white/[0.06] bg-slate-900/40 p-1">
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-[11px] font-bold transition-all duration-200",
              isActive
                ? "bg-[#0d1f35] text-white shadow-md ring-1 ring-cyan-500/20"
                : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
            )}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5 transition-colors",
                isActive ? tab.color : "text-slate-600"
              )}
            />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
          </button>
        );
      })}
    </div>
  );
}
