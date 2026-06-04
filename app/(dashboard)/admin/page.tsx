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
              <span className="text-white">{feed.connections}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Instruments subscribed</span>
              <span className="text-white">{feed.totalSubscribed}</span>
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
