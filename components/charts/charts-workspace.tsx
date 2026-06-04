"use client";

import { useState } from "react";
import { cn } from "@/utils/cn";
import { MarketSymbolSelector, type MarketInstrument } from "@/components/shared/market-symbol-selector";
import { segmentToTvExchange } from "@/lib/market-categories";

const TIMEFRAMES = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "1D", value: "D" },
  { label: "1W", value: "W" },
];

type ChartsWorkspaceProps = {
  symbols?: readonly string[];
};

function buildTvUrl(symbol: string, interval: string) {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: "dark",
    style: "1",
    locale: "in",
    timezone: "Asia/Kolkata",
    toolbar_bg: "#131722",
    enable_publishing: "false",
    hide_side_toolbar: "0",
    withdateranges: "1",
    allow_symbol_change: "1",
    save_image: "0",
  });
  return `https://www.tradingview.com/widgetembed/?${params.toString()}`;
}

export function ChartsWorkspace({ symbols = [] }: ChartsWorkspaceProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(symbols[0] ?? "NSE:NIFTY");
  const [displayLabel, setDisplayLabel] = useState(
    (symbols[0] ?? "NSE:NIFTY").replace(/^(NSE|BSE|MCX):/, "")
  );
  const [interval, setInterval] = useState("D");

  function handleInstrumentSelect(inst: MarketInstrument) {
    const sym = inst.symbol || inst.tradingSymbol;
    const tvSymbol = segmentToTvExchange(inst.exchangeSegment, sym);
    setSelectedSymbol(tvSymbol);
    setDisplayLabel(sym);
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Symbol selector — full market search with category tabs */}
        <MarketSymbolSelector
          value={displayLabel}
          onSelect={handleInstrumentSelect}
          placeholder="Search symbol…"
          className="w-64"
        />

        {/* Timeframe selector */}
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              type="button"
              onClick={() => setInterval(tf.value)}
              className={cn(
                "px-3 py-2 text-xs font-medium transition",
                interval === tf.value
                  ? "bg-cyan-glow/[0.18] text-cyan-soft"
                  : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-white"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* TradingView chart */}
      <div className="relative h-[600px] overflow-hidden rounded-lg border border-white/10 bg-[#131722]">
        <iframe
          key={`${selectedSymbol}-${interval}`}
          src={buildTvUrl(selectedSymbol, interval)}
          className="h-full w-full border-0"
          title={`TradingView chart — ${displayLabel}`}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>

      <p className="text-right text-xs text-slate-600">
        Chart data provided by{" "}
        <a
          href="https://www.tradingview.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition hover:text-slate-400"
        >
          TradingView
        </a>
      </p>
    </div>
  );
}
