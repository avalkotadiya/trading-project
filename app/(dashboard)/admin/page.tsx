import Link from "next/link";
import { redirect } from "next/navigation";
import type { AuditLog } from "@/lib/generated/prisma";
import { Shield, UsersRound, ReceiptText, Activity, IndianRupee, Radio, BellRing } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthenticatedUser, isDatabaseConfigured } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { dhanMarketFeedService } from "@/services/dhan/dhanMarketFeed";
import { dhanAuthService } from "@/services/dhan/dhanAuth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();

  if (!hasRole(user, "ADMIN")) {
    redirect("/dashboard");
  }

  let users = 1;
  let alerts = 0;
  let watchlists = 0;
  let activeSubs = 0;
  let invoices = 0;
  let revenueInr = 0;
  let signals = 0;
  let auditLogs: AuditLog[] = [];

  if (isDatabaseConfigured()) {
    const [u, a, w, s, i, rev, sig, logs] = await Promise.all([
      prisma.user.count(),
      prisma.alert.count(),
      prisma.watchlist.count(),
      prisma.userSubscription.count({ where: { status: "ACTIVE" } }),
      prisma.invoice.count(),
      prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amountInr: true } }),
      prisma.tradingSignal.count(),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 })
    ]);
    users = u;
    alerts = a;
    watchlists = w;
    activeSubs = s;
    invoices = i;
    revenueInr = rev._sum.amountInr ?? 0;
    signals = sig;
    auditLogs = logs;
  }

  // The feed is a per-process singleton. The admin page must actively
  // ensure a connection (best-effort) before reading status — otherwise it
  // always reports "Disconnected" simply because nothing triggered connect
  // in this render. Capture the real failure reason if it can't connect.
  let connectError: string | null = null;
  try {
    await dhanMarketFeedService.ensureConnected();
  } catch (error) {
    connectError = error instanceof Error ? error.message : "Feed connection failed";
  }
  const feed = dhanMarketFeedService.getStatus();
  const tokenHealth = (await dhanAuthService.getTokenHealth()) as {
    tokenPresent: boolean;
    source: string;
    expired?: boolean | null;
  };
  const clientIdSet = Boolean(process.env.DHAN_CLIENT_ID?.trim());
  const feedReason =
    feed.lastError ??
    connectError ??
    (!clientIdSet
      ? "DHAN_CLIENT_ID is not set."
      : !tokenHealth.tokenPresent
        ? "Dhan access token missing — set DHAN_ACCESS_TOKEN or complete the consent flow."
        : tokenHealth.expired
          ? "Dhan access token has expired — refresh it."
          : null);

  const feedCapacity = Math.max(1, feed.maxLiveFeedInstruments ?? 1);
  const feedUsagePercent = Math.min(100, Math.round((feed.totalSubscribed / feedCapacity) * 100));
  const laneLabels: Record<string, string> = {
    critical: "Critical indices",
    dashboard: "Dashboard visible",
    interactive: "User search/actions",
    bulk: "Background universe",
    depth: "Depth/full feed",
    overflow: "Overflow"
  };
  const laneDescriptions: Record<string, string> = {
    critical: "Fast ticker lane for indices and market heartbeat symbols.",
    dashboard: "Quote lane for dashboard rows and curated equities.",
    interactive: "On-demand symbols added by users and provider reads.",
    bulk: "Large segment subscriptions and background coverage.",
    depth: "Depth/full packets for request codes 19 and 21.",
    overflow: "Fallback when a preferred lane is full."
  };
  const perConnection = feed.perConnection ?? [];
  const activeLanes = Array.from(new Set(perConnection.map((connection) => connection.lane)));
  const laneStatus = feed.laneStatus ?? [];

  const stats = [
    { label: "Users", value: users, icon: UsersRound, href: "/admin/users" },
    { label: "Active Subs", value: activeSubs, icon: ReceiptText, href: "/admin/subscriptions" },
    { label: "Revenue", value: `₹${revenueInr.toLocaleString("en-IN")}`, icon: IndianRupee, href: "/admin/subscriptions" },
    { label: "Alerts", value: alerts, icon: BellRing, href: null },
    { label: "Watchlists", value: watchlists, icon: Shield, href: null },
    { label: "Signals", value: signals, icon: Activity, href: null },
    { label: "Invoices", value: invoices, icon: ReceiptText, href: null }
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-soft">Admin dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Operations command center</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon;
          const block = (
            <Card className={`p-5 h-full ${item.href ? "transition-colors hover:bg-white/[0.03] border-white/20" : ""}`}>
              <Icon className="h-5 w-5 text-cyan-soft" />
              <p className="mt-3 text-sm text-slate-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
            </Card>
          );
          return item.href ? (
            <Link key={item.label} href={item.href}>{block}</Link>
          ) : (
            <div key={item.label}>{block}</div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-soft" />
              Live market feed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Status</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  feed.connected
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                }`}
              >
                {feed.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">WebSocket connections</span>
              <span className="text-white">
                {feed.connections} / {feed.maxConnections ?? 5}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Instruments subscribed</span>
              <span className="text-white">
                {feed.totalSubscribed.toLocaleString("en-IN")} / {feedCapacity.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Feed capacity used</span>
                <span className="font-mono text-slate-300">{feedUsagePercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-sapphire-soft"
                  style={{ width: `${feedUsagePercent}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Per connection cap</span>
              <span className="text-white">{(feed.instrumentsPerConnection ?? 5000).toLocaleString("en-IN")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Active lanes</span>
              <span className="text-white">{activeLanes.length || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Lane verifier</span>
              <span className={feed.lanePrewarmActive ? "text-sapphire-soft" : "text-slate-400"}>
                {feed.lanePrewarmActive ? "Running" : "Idle"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">DHAN_CLIENT_ID</span>
              <span className={clientIdSet ? "text-emerald-400" : "text-rose-400"}>
                {clientIdSet ? "Configured" : "Missing"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Access token</span>
              <span className={tokenHealth.tokenPresent && !tokenHealth.expired ? "text-emerald-400" : "text-rose-400"}>
                {!tokenHealth.tokenPresent
                  ? "Missing"
                  : tokenHealth.expired
                    ? "Expired"
                    : `OK (${tokenHealth.source})`}
              </span>
            </div>
            {feedReason && (
              <p className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-400">
                {feedReason}
              </p>
            )}
            {feed.connected && (
              <p className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs text-emerald-400">
                Feed is live and streaming.
              </p>
            )}

            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Socket lane plan</p>
              <div className="grid gap-2">
                {laneStatus.map((status) => {
                  const lane = status.lane;
                  const connected = status.connected > 0;
                  const hasConnection = status.connections > 0;
                  const isThrottled = Boolean(status.lastError?.includes("429"));
                  const tone = connected
                    ? "bg-emerald-500/10 text-emerald-400"
                    : isThrottled
                      ? "bg-amber-500/10 text-amber-300"
                      : hasConnection
                        ? "bg-sapphire-glow/10 text-sapphire-soft"
                        : "bg-slate-500/10 text-slate-400";
                  const label = connected
                    ? "Live"
                    : isThrottled
                      ? "Throttled"
                      : hasConnection
                        ? "Verifying"
                        : "Planned";
                  return (
                    <div key={lane} className="rounded-md border border-white/10 bg-white/[0.035] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{laneLabels[lane] ?? lane}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{laneDescriptions[lane] ?? "Reserved feed lane."}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
                          {label} · {status.connections}/{status.target}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {status.subscribed.toLocaleString("en-IN")} subscribed
                        {status.remaining ? ` · ${status.remaining.toLocaleString("en-IN")} free` : ""}
                      </p>
                      {status.nextRetryAt ? (
                        <p className="mt-1 text-[11px] text-amber-300">
                          Retry at {new Date(status.nextRetryAt).toLocaleTimeString("en-IN")}
                        </p>
                      ) : null}
                      {status.lastError ? (
                        <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-300">
                          {status.lastError}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Live sockets</p>
              {perConnection.length === 0 ? (
                <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-slate-500">
                  No market feed socket is active yet.
                </div>
              ) : null}
              {perConnection.map((connection) => {
                const usedPercent = Math.min(100, Math.round((connection.subscribed / Math.max(1, connection.capacity)) * 100));
                return (
                  <div key={connection.id} className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">
                          Socket {connection.id} · {laneLabels[connection.lane] ?? connection.lane}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {connection.subscribed.toLocaleString("en-IN")} used · {connection.remaining.toLocaleString("en-IN")} free
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${connection.connected ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                        {connection.connected ? "Live" : "Retrying"}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-sapphire-soft"
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                    <div className="mt-2 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
                      <span>Reconnects: {connection.reconnectAttempt}</span>
                      <span>
                        Next retry: {connection.nextRetryAt ? new Date(connection.nextRetryAt).toLocaleTimeString("en-IN") : "none"}
                      </span>
                    </div>
                    {connection.lastError ? (
                      <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[11px] text-amber-300">
                        {connection.lastError}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent audit logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {auditLogs.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
                Audit events appear here as users and admins manage roles, billing, and settings.
              </div>
            ) : null}
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.05] p-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">{log.action}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {log.actorEmail ?? "system"} · {log.entity}
                  </p>
                </div>
                <p className="text-xs text-slate-500">{log.createdAt.toLocaleString("en-IN")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
