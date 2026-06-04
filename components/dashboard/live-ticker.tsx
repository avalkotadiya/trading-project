"use client";

/**
 * LiveTicker — horizontal scrolling price band at the top of the dashboard.
 *
 * Renders only TICKER_INSTRUMENTS (~40 symbols flagged with ticker: true).
 * The set is hardcoded in lib/dhan-symbols.ts so DOM size is bounded forever,
 * regardless of how many instruments are subscribed.
 *
 * Performance:
 *   • useLiveMarket → shared SSE batch source (250 ms refresh)
 *   • TICKER_SYMBOL_SET → O(1) filter on each render
 *   • TICKER_ORDER     → stable, deterministic ordering
 *   • Doubled array drives the CSS infinite-scroll animation
 */

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import { useLiveMarket } from "@/hooks/use-live-market";
import { TICKER_INSTRUMENTS } from "@/lib/dhan-symbols";
import type { MarketTick } from "@/types/market";
import { cn } from "@/utils/cn";
import { formatPercent, formatPrice } from "@/utils/format";

type LiveTickerProps = {
  initialTicks: MarketTick[];
  token: string;
};

const TICKER_SYMBOL_SET = new Set(
  TICKER_INSTRUMENTS.map((i) => `${i.exchange}:${i.symbol}`)
);
const TICKER_ORDER = new Map(
  TICKER_INSTRUMENTS.map((i, idx) => [`${i.exchange}:${i.symbol}`, idx])
);

export function LiveTicker({ initialTicks, token }: LiveTickerProps) {
  const { ticks } = useLiveMarket(initialTicks, token);

  const tickerTicks = useMemo(() => {
    const filtered = ticks.filter((tick) =>
      TICKER_SYMBOL_SET.has(`${tick.exchange ?? "NSE"}:${tick.symbol}`)
    );
    return [...filtered].sort((a, b) => {
      const orderA = TICKER_ORDER.get(`${a.exchange ?? "NSE"}:${a.symbol}`) ?? 999;
      const orderB = TICKER_ORDER.get(`${b.exchange ?? "NSE"}:${b.symbol}`) ?? 999;
      return orderA - orderB;
    });
  }, [ticks]);

  if (tickerTicks.length === 0) {
    return (
      <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02] py-2">
        <div className="flex gap-2 px-3">
          {TICKER_INSTRUMENTS.slice(0, 10).map((inst) => (
            <div
              key={`${inst.exchange}-${inst.symbol}`}
              className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1 opacity-40"
            >
              <span className="text-xs font-semibold text-white">{inst.symbol}</span>
              <span className="text-[10px] text-slate-600">—</span>
            </div>
          ))}
          <span className="ml-2 self-center text-[10px] text-slate-600 animate-pulse">
            Connecting…
          </span>
        </div>
      </div>
    );
  }

  const repeated = [...tickerTicks, ...tickerTicks];

  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.02] py-2">
      <div className="flex min-w-max animate-ticker gap-2">
        {repeated.map((tick, index) => {
          const positive = tick.changePercent >= 0;
          const Icon = positive ? ArrowUpRight : ArrowDownRight;

          return (
            <div
              key={`${tick.exchange ?? "NSE"}-${tick.symbol}-${index}`}
              className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1"
            >
              <span className="text-xs font-semibold text-white">{tick.symbol}</span>
              <span className="text-xs text-slate-300">{formatPrice(tick.price)}</span>
              <span
                className={cn(
                  "flex items-center gap-0.5 text-[10px] font-medium",
                  positive ? "text-trade-green" : "text-trade-red"
                )}
              >
                <Icon className="h-3 w-3" />
                {formatPercent(tick.changePercent)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
