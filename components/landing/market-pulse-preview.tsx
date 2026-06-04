import { Activity, ArrowDownRight, ArrowUpRight, BrainCircuit, RadioTower } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";
import { formatCompact, formatPercent, formatPrice } from "@/utils/format";

const bars = [38, 52, 46, 72, 64, 78, 70, 86, 76, 91, 84, 96];
const previewTicks = [
  { symbol: "NIFTY", price: 0, changePercent: 0, volume: 0 },
  { symbol: "BANKNIFTY", price: 0, changePercent: 0, volume: 0 },
  { symbol: "SENSEX", price: 0, changePercent: 0, volume: 0 }
];

export function MarketPulsePreview() {
  return (
    <div className="glass-panel depth-card relative rounded-lg p-4 shadow-panel">
      <div className="absolute inset-0 bg-market-grid bg-[size:28px_28px] opacity-40" />
      <div className="market-scan pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="rounded-lg border border-white/10 bg-black/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-soft">Live market fabric</p>
              <h2 className="mt-2 text-xl font-semibold text-white">NIFTY momentum model</h2>
            </div>
            <Badge tone="green" className="gap-1">
              <RadioTower className="h-3 w-3" />
              Streaming
            </Badge>
          </div>

          <div className="mt-8 flex h-48 items-end gap-2">
            {bars.map((height, index) => (
              <div
                key={height + index}
                className={cn(
                  "flex-1 origin-bottom rounded-t-sm shadow-[0_0_18px_rgba(59,130,246,0.16)] animate-[dataBarRise_700ms_ease-out_both]",
                  index % 4 === 1 ? "bg-trade-red/70" : "bg-cyan-glow/70"
                )}
                style={{ height: `${height}%`, animationDelay: `${index * 55}ms` }}
              />
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {previewTicks.map((tick) => {
              const positive = tick.changePercent >= 0;
              const Icon = positive ? ArrowUpRight : ArrowDownRight;

              return (
                <div key={tick.symbol} className="rounded-md border border-white/10 bg-white/[0.06] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:-translate-y-0.5 hover:border-cyan-glow/30">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{tick.symbol}</p>
                    <Icon className={cn("h-4 w-4", positive ? "text-trade-green" : "text-trade-red")} />
                  </div>
                  <p className="mt-2 text-lg font-semibold text-white">{formatPrice(tick.price)}</p>
                  <p className={cn("text-xs", positive ? "text-trade-green" : "text-trade-red")}>
                    {formatPercent(tick.changePercent)} / {formatCompact(tick.volume)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-cyan-glow/20 bg-cyan-glow/10 p-4 shadow-[0_18px_46px_rgba(59,130,246,0.08)]">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-glow text-white">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-white">Signal confidence</p>
                <p className="text-2xl font-semibold text-cyan-soft">88%</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Volume breakout, higher-low structure, and put writing are aligned.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-white">Recent alerts</p>
              <Activity className="h-4 w-4 text-cyan-soft" />
            </div>
            <div className="space-y-3">
              {["Connect DhanHQ feed", "Enable AI services", "Create alert rules"].map((item) => (
                <div key={item} className="rounded-md border border-white/10 bg-white/[0.05] p-3">
                  <p className="text-sm font-medium text-white">{item}</p>
                  <p className="mt-1 text-xs text-slate-400">Configured from your live workspace.</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
