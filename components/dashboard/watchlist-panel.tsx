"use client";

import { useState, useTransition } from "react";
import { Bell, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLiveMarket } from "@/hooks/use-live-market";
import type { MarketTick } from "@/types/market";
import type { WatchlistSummary } from "@/types/platform";
import type { SubscriptionState } from "@/types/subscription";
import { formatPrice, formatRelativeTime } from "@/utils/format";

type WatchlistPanelProps = {
  initialWatchlists: WatchlistSummary[];
  currentSubscription: SubscriptionState;
  initialTicks: MarketTick[];
  token: string;
};

function normalizeWatchlist(payload: {
  id: string;
  name: string;
  symbols: string[];
  updatedAt?: string | Date;
}) {
  return {
    id: payload.id,
    name: payload.name,
    symbols: payload.symbols,
    updatedAt:
      typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : payload.updatedAt?.toISOString() ?? new Date().toISOString()
  } satisfies WatchlistSummary;
}

export function WatchlistPanel({ initialWatchlists, currentSubscription, initialTicks, token }: WatchlistPanelProps) {
  const [watchlists, setWatchlists] = useState(initialWatchlists);
  const [name, setName] = useState("Active Trades");
  const [symbolsInput, setSymbolsInput] = useState("NIFTY, RELIANCE");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { ticks } = useLiveMarket(initialTicks, token);
  const tickMap = new Map(ticks.map(tick => [tick.symbol, tick]));

  const uniqueSymbolCount = new Set(watchlists.flatMap((watchlist) => watchlist.symbols)).size;
  const planKey = currentSubscription.planKey ?? "free";

  function createWatchlist() {
    setMessage(null);

    const symbols = symbolsInput
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);

    startTransition(async () => {
      try {
        const response = await fetch("/api/watchlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, symbols })
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Unable to create watchlist.");
        }

        setWatchlists((current) => [normalizeWatchlist(payload.data.watchlist), ...current]);
        setSymbolsInput("");
        setName("Active Trades");
        setMessage("Watchlist saved.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to create watchlist.");
      }
    });
  }

  function deleteWatchlist(id: string) {
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/watchlists/${id}`, {
          method: "DELETE"
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error?.message ?? "Unable to delete watchlist.");
        }

        setWatchlists((current) => current.filter((watchlist) => watchlist.id !== id));
        setMessage("Watchlist removed.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to delete watchlist.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Watchlist</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            {planKey === "pro"
              ? currentSubscription.isAdminGrant
                ? `Unlimited symbols — ${currentSubscription.adminGrantRole === "OWNER" ? "owner" : "admin"} access.`
                : "Unlimited symbols on Pro."
              : `${uniqueSymbolCount}/5 symbols on Free.`}
          </p>
        </div>
        <Badge tone={planKey === "pro" ? "cyan" : "slate"}>
          {planKey === "pro"
            ? currentSubscription.isAdminGrant
              ? `Pro · ${currentSubscription.adminGrantRole === "OWNER" ? "Owner" : "Admin"}`
              : "Pro"
            : "Free"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-white/10 bg-white/[0.05] p-3">
          <div className="grid gap-3">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Watchlist name" />
            <Input
              value={symbolsInput}
              onChange={(event) => setSymbolsInput(event.target.value)}
              placeholder="Symbols, comma separated"
            />
            <Button onClick={createWatchlist} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add watchlist
            </Button>
          </div>
        </div>

        {message ? <p className="rounded-md border border-white/10 bg-white/[0.05] p-3 text-xs text-slate-300">{message}</p> : null}

        <div className="space-y-3">
          {watchlists.length === 0 ? (
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">
              Create your first watchlist to track symbols on the dashboard.
            </div>
          ) : null}

          {watchlists.map((watchlist) => (
            <div key={watchlist.id} className="rounded-md border border-white/10 bg-white/[0.05] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{watchlist.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatRelativeTime(watchlist.updatedAt)}</p>
                </div>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => deleteWatchlist(watchlist.id)}
                  disabled={isPending}
                  aria-label={`Delete ${watchlist.name}`}
                  title="Delete watchlist"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {watchlist.symbols.map((symbol) => {
                  const upperSymbol = symbol.toUpperCase();
                  // Try exact match, then try matching without prefix
                  const tick = tickMap.get(upperSymbol) || 
                               tickMap.get(`NSE:${upperSymbol}`) || 
                               tickMap.get(`BSE:${upperSymbol}`);
                               
                  return (
                    <span
                      key={`${watchlist.id}-${symbol}`}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-slate-300"
                    >
                      <Bell className="h-3 w-3 text-cyan-soft" />
                      <span className="font-medium text-white">{symbol}</span>
                      {tick ? (
                        <span className="text-slate-500 border-l border-white/10 pl-2 ml-1">
                          {formatPrice(tick.price)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600 border-l border-white/10 pl-2 ml-1">
                          No tick
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
