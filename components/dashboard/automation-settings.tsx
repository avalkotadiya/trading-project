"use client";

import { useEffect, useState } from "react";
import { Bot, Settings2, ShieldCheck, Zap, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/utils/cn";

export function AutomationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [maxAmount, setMaxAmount] = useState(5000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/user/automation");
      const json = await res.json();
      if (json.ok) {
        setEnabled(json.data.autoTradeEnabled);
        setMaxAmount(json.data.maxAutoTradeAmount);
      }
    } catch (err) {
      console.error("Failed to load automation settings", err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(newEnabled?: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/user/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoTradeEnabled: newEnabled !== undefined ? newEnabled : enabled,
          maxAutoTradeAmount: maxAmount
        })
      });
      if (res.ok) {
        if (newEnabled !== undefined) setEnabled(newEnabled);
      }
    } catch (err) {
      console.error("Failed to save automation settings", err);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    fetchSettings();
  }, []);

  if (loading) {
    return <Card className="animate-pulse bg-white/5 border-white/10 h-[200px]" />;
  }

  return (
    <Card className={cn(
      "border-trade-blue/20 transition-all duration-500",
      enabled ? "bg-trade-blue/[0.05] border-trade-blue/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]" : "bg-white/[0.02]"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Bot className={cn("h-4 w-4", enabled ? "text-trade-blue" : "text-slate-500")} />
            AI Auto-Trading
          </CardTitle>
          <Switch 
            checked={enabled} 
            onCheckedChange={(val) => saveSettings(val)}
            disabled={saving}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Max per trade (INR)</Label>
            <span className="text-xs font-mono text-white">₹{maxAmount}</span>
          </div>
          <div className="flex gap-2">
            <Input 
              type="number" 
              value={maxAmount} 
              onChange={(e) => setMaxAmount(Number(e.target.value))}
              className="h-8 bg-black/20 border-white/10 text-xs"
              placeholder="5000"
            />
            <Button 
              size="sm" 
              variant="outline" 
              className="h-8 text-[10px] uppercase font-bold px-3 border-trade-blue/30 text-trade-blue hover:bg-trade-blue/10"
              onClick={() => saveSettings()}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings2 className="h-3 w-3" />}
            </Button>
          </div>
        </div>

        <div className={cn(
          "rounded-md p-3 flex items-start gap-2 transition-all",
          enabled ? "bg-trade-blue/10 border border-trade-blue/20" : "bg-white/5 border border-white/10"
        )}>
          {enabled ? (
            <Zap className="h-3.5 w-3.5 text-trade-blue mt-0.5 shrink-0 animate-pulse" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
          )}
          <p className="text-[10px] text-slate-300 leading-relaxed">
            {enabled 
              ? "Autopilot active. Executing trades on High-Confidence signals using the 'AI Signal Lab' strategy."
              : "Automation paused. Signals will be broadcasted but no trades will be executed automatically."
            }
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
