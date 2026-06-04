"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ShieldCheck, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Subscription = {
  id: string;
  status: string;
  currentPeriodEnd: string | null;
  plan: { key: string; name: string };
};

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  autoTradeEnabled: boolean;
  subscriptions: Subscription[];
  _count: { watchlists: number; alerts: number; portfolio: number; orders: number };
};

const ROLE_OPTIONS = ["VIEWER", "TRADER", "ANALYST", "ADMIN", "OWNER"];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      const res = await fetch(`/api/admin/users?${params}`);
      const json = await res.json();
      if (json.ok) {
        setUsers(json.data.users);
      } else {
        setError(json.error?.message ?? "Failed to load users.");
      }
    } catch {
      setError("Network error while loading users.");
    }
    setLoading(false);
  }, [debounced, roleFilter]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  async function handleRoleChange(userId: string, newRole: string) {
    setUpdating(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole })
      });
      const json = await res.json();
      if (json.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      } else {
        setError(json.error?.message ?? "Failed to update role.");
      }
    } catch {
      setError("Network error while updating role.");
    }
    setUpdating(null);
  }

  async function handleSubscription(userId: string, action: "grant" | "revoke") {
    setUpdating(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/subscribe`, {
        method: action === "grant" ? "POST" : "DELETE"
      });
      const json = await res.json();
      if (json.ok) {
        await fetchUsers();
      } else {
        setError(json.error?.message ?? "Subscription update failed.");
      }
    } catch {
      setError("Network error while updating subscription.");
    }
    setUpdating(null);
  }

  const activeSub = (u: User) =>
    u.subscriptions.find((s) => s.status === "ACTIVE" || s.status === "TRIALING");

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">User Management</h1>
        <p className="text-slate-400">View and manage all registered accounts, roles, and access.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-9"
          />
        </div>
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-full sm:w-44"
        >
          <option value="ALL">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  <th className="p-4 font-medium">Name &amp; Email</th>
                  <th className="p-4 font-medium">Role</th>
                  <th className="p-4 font-medium">Subscription</th>
                  <th className="p-4 font-medium">Activity</th>
                  <th className="p-4 font-medium">Joined</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">No users found.</td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const sub = activeSub(user);
                    return (
                      <tr key={user.id} className="hover:bg-slate-800/50 align-top">
                        <td className="p-4">
                          <div className="font-medium text-slate-200">{user.name || "No Name"}</div>
                          <div className="text-slate-500 text-xs">{user.email}</div>
                        </td>
                        <td className="p-4">
                          <Select
                            disabled={updating === user.id}
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.id, e.target.value)}
                            className="w-32 h-8 text-xs bg-slate-950 border-slate-800"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </Select>
                        </td>
                        <td className="p-4">
                          {sub ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex w-fit items-center rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                                {sub.plan.name} ({sub.status})
                              </span>
                              {sub.currentPeriodEnd && (
                                <span className="text-[10px] text-slate-500">
                                  until {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs italic text-slate-500">Free Plan</span>
                          )}
                        </td>
                        <td className="p-4 text-xs text-slate-400">
                          <div>{user._count.orders} orders · {user._count.portfolio} holdings</div>
                          <div>{user._count.watchlists} watchlists · {user._count.alerts} alerts</div>
                          {user.autoTradeEnabled && (
                            <span className="mt-1 inline-block rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-400">
                              Auto-trade ON
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-slate-400 text-xs">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-right">
                          {sub ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 text-[10px] bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
                              onClick={() => handleSubscription(user.id, "revoke")}
                              disabled={updating === user.id}
                            >
                              <XCircle className="mr-1 h-3 w-3" /> Revoke Pro
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                              onClick={() => handleSubscription(user.id, "grant")}
                              disabled={updating === user.id}
                            >
                              <ShieldCheck className="mr-1 h-3 w-3" /> Grant Pro
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
