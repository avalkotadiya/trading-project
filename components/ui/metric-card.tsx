import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/utils/cn";

type MetricCardProps = {
  label: string;
  value: string;
  change: string;
  tone?: "positive" | "negative" | "neutral";
};

export function MetricCard({ label, value, change, tone = "neutral" }: MetricCardProps) {
  const Icon = tone === "positive" ? ArrowUpRight : tone === "negative" ? ArrowDownRight : Minus;

  return (
    <div className="glass-panel depth-card rounded-lg p-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-400">{label}</p>
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md border",
            tone === "positive" && "border-trade-green/20 bg-trade-green/10 text-trade-green",
            tone === "negative" && "border-trade-red/20 bg-trade-red/10 text-trade-red",
            tone === "neutral" && "border-cyan-glow/20 bg-cyan-glow/10 text-cyan-soft"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-4">
        <p className="text-2xl font-semibold tracking-normal text-white">{value}</p>
        <p
          className={cn(
            "mt-1 text-sm",
            tone === "positive" && "text-trade-green",
            tone === "negative" && "text-trade-red",
            tone === "neutral" && "text-slate-400"
          )}
        >
          {change}
        </p>
      </div>
    </div>
  );
}
