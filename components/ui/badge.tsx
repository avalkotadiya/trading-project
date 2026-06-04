import * as React from "react";
import { cn } from "@/utils/cn";

type BadgeTone = "cyan" | "green" | "red" | "amber" | "slate";

const tones: Record<BadgeTone, string> = {
  cyan: "border-cyan-glow/30 bg-cyan-glow/10 text-cyan-soft",
  green: "border-trade-green/30 bg-trade-green/10 text-trade-green",
  red: "border-trade-red/30 bg-trade-red/10 text-trade-red",
  amber: "border-trade-amber/30 bg-trade-amber/10 text-trade-amber",
  slate: "border-white/10 bg-white/[0.08] text-slate-300"
};

export function Badge({
  className,
  tone = "slate",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
