"use client";

import { useEffect, useState } from "react";
import { Activity, PlugZap, RefreshCcw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DhanStatusPayload = {
  auth?: { configured?: boolean; source?: string };
  marketFeed?: {
    connected?: boolean;
    reconnectAttempt?: number;
    totalSubscribed?: number;
    nextRetryAt?: number | null;
    lastError?: string | null;
  };
  orderUpdates?: { connected?: boolean; lastError?: string | null };
};

export function DhanDashboardCard() {
  const [status, setStatus] = useState<DhanStatusPayload | null>(null);
  const [ordersCount, setOrdersCount] = useState(0);
  const [tradesCount, setTradesCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const feedRetryAt =
    typeof status?.marketFeed?.nextRetryAt === "number" && status.marketFeed.nextRetryAt > now
      ? new Date(status.marketFeed.nextRetryAt).toLocaleTimeString()
      : null;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const statusRes = await fetch("/api/dhan/market/status", { cache: "no-store" });

      const statusJson = await statusRes.json();

      if (!statusRes.ok || !statusJson.ok) {
        throw new Error(statusJson?.error?.message ?? "Unable to load Dhan status.");
      }

      setStatus(statusJson.data ?? null);

      // Fetch order/trade book only when token appears configured.
      if (statusJson?.data?.auth?.configured) {
        const [ordersRes, tradesRes] = await Promise.all([
          fetch("/api/dhan/orders", { cache: "no-store" }),
          fetch("/api/dhan/trades", { cache: "no-store" })
        ]);
        const ordersJson = await ordersRes.json().catch(() => ({}));
        const tradesJson = await tradesRes.json().catch(() => ({}));
        setOrdersCount(ordersRes.ok && Array.isArray(ordersJson?.data?.orders) ? ordersJson.data.orders.length : 0);
        setTradesCount(tradesRes.ok && Array.isArray(tradesJson?.data?.trades) ? tradesJson.data.trades.length : 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Dhan panel.");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }

  async function connectNow() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/dhan/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error?.message ?? "Dhan connection failed.");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect Dhan.");
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Card className="border-cyan-glow/20 bg-cyan-glow/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-bold">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-soft" />
            DhanHQ
          </span>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-xs text-trade-red">{error}</p> : null}
        <Button type="button" className="w-full" onClick={connectNow} disabled={connecting}>
          <PlugZap className="h-4 w-4" />
          {connecting ? "Connecting Dhan..." : "Connect / Reconnect Dhan Feed"}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Badge tone={status?.auth?.configured ? "green" : "red"}>
            Token: {status?.auth?.configured ? "Configured" : "Missing"}
          </Badge>
          <Badge tone={status?.marketFeed?.connected ? "green" : "amber"}>
            Feed: {status?.marketFeed?.connected ? "Connected" : "Reconnecting"}
          </Badge>
          <Badge tone={status?.orderUpdates?.connected ? "green" : "amber"}>
            Orders WS: {status?.orderUpdates?.connected ? "Connected" : "Reconnecting"}
          </Badge>
        </div>

        <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-300">
          <div className="flex items-center justify-between">
            <span>Order book entries</span>
            <span className="font-semibold text-white">{ordersCount}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Trade book entries</span>
            <span className="font-semibold text-white">{tradesCount}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Reconnect attempts</span>
            <span className="font-semibold text-white">{status?.marketFeed?.reconnectAttempt ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Subscribed instruments</span>
            <span className="font-semibold text-white">{status?.marketFeed?.totalSubscribed ?? 0}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>Next feed retry</span>
            <span className="font-semibold text-white">{feedRetryAt ?? "-"}</span>
          </div>
        </div>

        {status?.marketFeed?.lastError ? <p className="text-[11px] text-amber-300">Feed error: {status.marketFeed.lastError}</p> : null}
        {!status?.marketFeed?.connected && feedRetryAt ? (
          <p className="text-[11px] text-slate-300">Feed reconnect scheduled at {feedRetryAt}</p>
        ) : null}
        {status?.orderUpdates?.lastError ? <p className="text-[11px] text-amber-300">Order WS error: {status.orderUpdates.lastError}</p> : null}
        <p className="flex items-center gap-1 text-[11px] text-slate-400">
          <Activity className="h-3.5 w-3.5" />
          This connects automatically. Use Settings only for manual token auth if needed.
        </p>
      </CardContent>
    </Card>
  );
}
