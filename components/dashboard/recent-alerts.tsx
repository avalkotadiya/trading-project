"use client";

import { Activity, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AlertSummary } from "@/types/platform";
import { cn } from "@/utils/cn";
import { useLiveMarket } from "@/hooks/use-live-market";

const icons = {
  positive: CheckCircle2,
  negative: AlertTriangle,
  neutral: Activity
};

type RecentAlertsProps = {
  alerts: AlertSummary[];
  token?: string;
};

export function RecentAlerts({ alerts: initialAlerts, token }: RecentAlertsProps) {
  const { alerts: liveAiAlerts } = useLiveMarket([], token);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Recent alerts</span>
          {liveAiAlerts.length > 0 && (
            <span className="flex h-2 w-2 rounded-full bg-trade-red animate-pulse" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Render Live AI Risk Alerts First */}
        {liveAiAlerts.map((alert, idx) => (
          <div key={`ai-${idx}`} className="flex gap-3 rounded-md border border-trade-red/30 bg-trade-red/10 p-3 animate-pulse-subtle">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-trade-red/20 text-trade-red">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-white uppercase">{alert.type}</p>
                <span className="text-[10px] text-trade-red font-mono">AI RISK</span>
              </div>
              <p className="mt-1 text-xs text-slate-300 leading-relaxed">{alert.message}</p>
              <p className="mt-1.5 text-[10px] font-bold text-trade-red uppercase">ACTION: {alert.action}</p>
            </div>
          </div>
        ))}

        {initialAlerts.length === 0 && liveAiAlerts.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
            Alerts you create will appear here in realtime.
          </div>
        ) : null}

        {initialAlerts.map((alert) => {
          const Icon = icons[alert.tone];

          return (
            <div key={alert.id} className="flex gap-3 rounded-md border border-white/10 bg-white/[0.05] p-3">
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  alert.tone === "positive" && "bg-trade-green/10 text-trade-green",
                  alert.tone === "negative" && "bg-trade-red/10 text-trade-red",
                  alert.tone === "neutral" && "bg-cyan-glow/10 text-cyan-soft"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-white">{alert.title}</p>
                  <span className="text-xs text-slate-500">{alert.createdAt}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{alert.message}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
