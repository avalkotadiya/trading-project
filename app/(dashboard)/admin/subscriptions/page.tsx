"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Subscription = {
  id: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
  plan: { key: string; name: string; priceInr: number };
};

type Summary = {
  total: number;
  active: number;
  trialing: number;
  canceled: number;
  pastDue: number;
  lifetimeRevenueInr: number;
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  TRIALING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  PAST_DUE: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  CANCELED: "bg-rose-500/10 text-rose-400 border-rose-500/20"
};

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subscriptions");
      const json = await res.json();
      if (json.ok) {
        setSubs(json.data.subscriptions);
        setSummary(json.data.summary);
      } else {
        setError(json.error?.message ?? "Failed to load subscriptions.");
      }
    } catch {
      setError("Network error while loading subscriptions.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/subscribe`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) {
        await load();
      } else {
        setError(json.error?.message ?? "Failed to revoke subscription.");
      }
    } catch {
      setError("Network error while revoking subscription.");
    }
    setBusy(null);
  }

  const cards = summary
    ? [
        { label: "Total", value: summary.total },
        { label: "Active", value: summary.active },
        { label: "Trialing", value: summary.trialing },
        { label: "Canceled", value: summary.canceled },
        { label: "Lifetime Revenue", value: `₹${summary.lifetimeRevenueInr.toLocaleString("en-IN")}` }
      ]
    : [];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Subscription Management</h1>
        <p className="text-slate-400">Monitor plans, billing status, and revoke access.</p>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map((c) => (
            <Card key={c.label} className="p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{c.value}</p>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="p-4 font-medium">User</th>
                  <th className="p-4 font-medium">Plan</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Period End</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : subs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">No subscriptions yet.</td>
                  </tr>
                ) : (
                  subs.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-800/50">
                      <td className="p-4">
                        <div className="font-medium text-slate-200">{s.user.name || "No Name"}</div>
                        <div className="text-xs text-slate-500">{s.user.email}</div>
                      </td>
                      <td className="p-4 text-slate-300">
                        {s.plan.name}
                        <span className="ml-1 text-xs text-slate-500">
                          ₹{s.plan.priceInr.toLocaleString("en-IN")}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLES[s.status] ?? "bg-slate-700/30 text-slate-400 border-slate-700"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {s.currentPeriodEnd
                          ? new Date(s.currentPeriodEnd).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="p-4 text-right">
                        {s.status !== "CANCELED" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                            onClick={() => revoke(s.user.id)}
                            disabled={busy === s.user.id}
                          >
                            <XCircle className="mr-1 h-3 w-3" /> Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
