"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronUp, Zap, Activity, TrendingUp, TrendingDown,
  Info, AlertTriangle, LucideIcon,
} from "lucide-react";
import type { MarketPulseCategory } from "@/types/market-pulse";
import { cn } from "@/utils/cn";

interface CardContent {
  title: string;
  tagline: string;
  icon: LucideIcon;
  accentColor: string;
  description: string;
  guide: string[];
}

const CONTENT: Record<MarketPulseCategory, CardContent> = {
  "breakout-beacon": {
    title: "BREAKOUT BEACON",
    tagline: "Price breaks key resistance with volume",
    icon: Zap,
    accentColor: "text-amber-400 bg-amber-500/10 ring-amber-500/20",
    description:
      "Detects stocks breaking above multi-session resistance or below support with above-average volume. Signal% measures breakout conviction — the higher the absolute value, the stronger the move.",
    guide: [
      "Bullish: Price closing above the 20-day high with 2x+ average volume.",
      "Bearish: Breakdown below key support with heavy selling pressure.",
      "Entry: At the breakout candle or on the first retest.",
      "Stop-loss: Just below the breakout level to limit downside.",
    ],
  },
  "intraday-boost": {
    title: "INTRADAY BOOST",
    tagline: "Momentum surge with R-Factor scoring",
    icon: Activity,
    accentColor: "text-sapphire-soft bg-sapphire-glow/10 ring-sapphire-glow/20",
    description:
      "Ranks stocks by intraday momentum using the R-Factor — a composite of % change, volume, and order-flow imbalance. Stocks with R.Fac > 3 are experiencing abnormal momentum worth trading.",
    guide: [
      "R.Fac > 3: High momentum — significant buying or selling pressure.",
      "Green Boost: Buyers dominating; look for long entries on dips.",
      "Red Boost: Sellers in control; consider shorts or exit longs.",
      "Use trailing stop-losses — high momentum moves can reverse quickly.",
    ],
  },
  "top-level": {
    title: "TOP LEVEL STOCKS",
    tagline: "Trading near session or multi-day highs",
    icon: TrendingUp,
    accentColor: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
    description:
      "Identifies stocks trading near their intraday or multi-session highs. These are the market leaders — they attract buying when the broader index is strong.",
    guide: [
      "Look for High-High patterns (higher highs on consecutive sessions).",
      "Strong stocks in a weak market signal sector rotation.",
      "Caution: Exhaustion candles (doji, shooting star) near extremes.",
      "Best used to identify sector leaders for momentum continuation.",
    ],
  },
  "low-level": {
    title: "LOW LEVEL STOCKS",
    tagline: "Near support zones or oversold territory",
    icon: TrendingDown,
    accentColor: "text-rose-400 bg-rose-500/10 ring-rose-500/20",
    description:
      "Flags stocks trading near support levels or in oversold territory. Used for bottom-fishing, mean-reversion setups, and identifying potential turnaround candidates.",
    guide: [
      "Watch for volume dry-up near support — indicates absorption.",
      "A bullish reversal candle at support is the entry signal.",
      "Low-level + high R.Fac = potential squeeze setup.",
      "Never catch a falling knife — wait for price action confirmation.",
    ],
  },
};

interface FeatureCardProps {
  category: MarketPulseCategory;
}

export function ScannerFeatureCard({ category }: FeatureCardProps) {
  const [open, setOpen] = useState(false);
  const { title, tagline, icon: Icon, accentColor, description, guide } = CONTENT[category];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#050d1a]">
      <button
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", accentColor)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black tracking-tight text-white">{title}</h2>
          <p className="text-[11px] text-slate-500">{tagline}</p>
        </div>
        <span className="text-slate-500">
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4 animate-in slide-in-from-top-1 duration-200">
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-xs leading-relaxed text-slate-400">{description}</p>
          </div>

          <div className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
              <Info className="h-3 w-3" /> Trading Guide
            </h3>
            <ul className="space-y-1">
              {guide.map((step, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-slate-400">
                  <span className="mt-0.5 shrink-0 text-sapphire-core">—</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <p className="text-[10px] leading-normal text-rose-300/70">
              Signals are for educational and research purposes only. Intraday trading involves substantial risk.
              Always trade with predefined stop-losses.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
