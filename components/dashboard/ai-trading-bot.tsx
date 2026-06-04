"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CircleStop,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Settings2,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/utils/cn";
import type { BotConfig, BotState, BotCandidate } from "@/types/bot";

// Subset of the server-side EdgeSignal carried by /api/bot/signals/stream.
// Matches the runtime shape of EdgeSignal in services/ai/quant-edge.service.ts.
type StreamedSignal = {
  symbol: string;
  price: number;
  edgePct: number;
  winProb: number;
  payoff: number;
  kelly: number;
  sampleSize: number;
  stopPrice: number;
  targetPrice: number;
  zScore: number;
  trendUp: boolean;
  intradayMomentum: number;
  intradayTrendUp: boolean;
  intradayPullback: boolean;
  inSetup: boolean;
  rvol: number;
  rsi14: number;
  macdHist: number;
  adx14: number;
  bbPctB: number;
  obvSlope: number;
  compositeScore: number;
};

type ScanProgress = {
  scanning: boolean;
  processed: number;
  total: number;
  kept: number;
  dropped: number;
  startedAt: number | null;
  finishedAt: number | null;
};

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const inrCompact = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

type Tab = "edge" | "positions" | "activity" | "settings";

// The autonomous server-side ticker runs every BOT_AUTOTICK_SECONDS (60s by
// default). The UI polls /api/bot/state every 12s for fresh KPIs.
const STATE_POLL_MS = 12000;
const SERVER_TICK_SEC = 60;

// localStorage keys for persisting the live scan state across refreshes.
// The server's partial cache flushes are throttled (~1.5s gap, every 25 signals)
// so on refresh the SSE snapshot can lag behind what the user already saw.
// Persisting client-side guarantees the edge list never goes blank between
// renders / refreshes / cache evictions.
const STORAGE_KEY_SIGNALS = "bot:streamed-signals:v1";
const STORAGE_KEY_PROGRESS = "bot:scan-progress:v1";
// Drop persisted entries older than 24h — by then any active scan has long
// since completed and the data is no longer representative of live conditions.
const STORAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type PersistedSignals = {
  signals: Record<string, StreamedSignal>;
  savedAt: number;
};
type PersistedProgress = {
  progress: ScanProgress | null;
  savedAt: number;
};

function loadPersistedSignals(): Record<string, StreamedSignal> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SIGNALS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSignals;
    if (!parsed || typeof parsed !== "object" || !parsed.signals) return {};
    if (Date.now() - (parsed.savedAt ?? 0) > STORAGE_MAX_AGE_MS) return {};
    return parsed.signals;
  } catch {
    return {};
  }
}

function loadPersistedProgress(): ScanProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProgress;
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - (parsed.savedAt ?? 0) > STORAGE_MAX_AGE_MS) return null;
    return parsed.progress;
  } catch {
    return null;
  }
}

export function AiTradingBot() {
  const [state, setState] = useState<BotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("edge");
  const [busy, setBusy] = useState<string | null>(null);
  // Live progressive scan feed — signals stream in one at a time via SSE so
  // the user sees the edge list grow during a 30-60 min cold full-universe
  // scan instead of waiting for a single 30 min payload at the end.
  // Lazy initializers hydrate from localStorage so signals + progress survive
  // a page refresh even if the server-side partial cache is between flushes
  // or has been evicted.
  const [streamedSignals, setStreamedSignals] = useState<Record<string, StreamedSignal>>(loadPersistedSignals);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(loadPersistedProgress);
  const [draftCap, setDraftCap] = useState<number>(50000);
  const [draftTrailStart, setDraftTrailStart] = useState<number>(2);
  const [draftTrailDistance, setDraftTrailDistance] = useState<number>(1.5);
  const [draftSectorCap, setDraftSectorCap] = useState<number>(0.4);
  const [draftWindowStart, setDraftWindowStart] = useState<string>("");
  const [draftWindowEnd, setDraftWindowEnd] = useState<string>("");
  const hydratedRef = useRef(false);
  const runningRef = useRef(false);

  const fetchState = useCallback(async (includeCandidates: boolean | "cache" = "cache") => {
    try {
      const query =
        includeCandidates === "cache"
          ? "?candidates=cache"
          : includeCandidates
            ? ""
            : "?candidates=0";
      const res = await fetch(`/api/bot/state${query}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setState(json.data);
        // Hydrate drafts from server once — after that the user's edits stick
        // until they hit Save (otherwise polling would clobber their typing).
        if (!hydratedRef.current) {
          const cfg = json.data.config;
          setDraftCap(cfg.maxDeployedCapital);
          setDraftTrailStart(cfg.botTrailStartPct);
          setDraftTrailDistance(cfg.botTrailDistancePct);
          setDraftSectorCap(cfg.botMaxSectorExposurePct);
          setDraftWindowStart(cfg.botEntryWindowStart ?? "");
          setDraftWindowEnd(cfg.botEntryWindowEnd ?? "");
          hydratedRef.current = true;
        }
      }
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, []);

  const runCycle = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy("run");
    try {
      await fetch("/api/bot/run", { method: "POST" });
      await fetchState();
    } catch {
      /* transient */
    } finally {
      runningRef.current = false;
      setBusy(null);
    }
  }, [fetchState]);

  useEffect(() => {
    const includeCandidatesInPoll = tab === "edge" ? "cache" : false;
    void fetchState(false);
    const loadCandidates = () => void fetchState("cache");
    const idleId =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? window.requestIdleCallback(loadCandidates, { timeout: 2500 })
        : undefined;
    const timer = idleId === undefined ? setTimeout(loadCandidates, 600) : undefined;
    const poll = setInterval(() => void fetchState(includeCandidatesInPoll), STATE_POLL_MS);
    return () => {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [fetchState, tab]);

  // ──────────────────────────────────────────────────────────────────────────
  //  Progressive edge-signal stream
  // ──────────────────────────────────────────────────────────────────────────
  // Opens an SSE connection to /api/bot/signals/stream. Each `signal` event
  // appends one EdgeSignal to the local overlay map keyed by symbol. The
  // overlay is merged with state.candidates in EdgeList so the user sees
  // every symbol pop into the list as the quant scanner produces it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/bot/signals/stream");

    const apply = (signals: StreamedSignal[]) => {
      if (signals.length === 0) return;
      setStreamedSignals((prev) => {
        const next = { ...prev };
        for (const sig of signals) {
          if (sig && typeof sig.symbol === "string") next[sig.symbol] = sig;
        }
        return next;
      });
    };

    es.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as StreamedSignal[];
        if (Array.isArray(payload)) apply(payload);
      } catch {
        /* malformed payload — ignore */
      }
    });

    es.addEventListener("signal", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as StreamedSignal;
        apply([payload]);
      } catch {
        /* malformed payload — ignore */
      }
    });

    es.addEventListener("progress", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as ScanProgress;
        setScanProgress(payload);
      } catch {
        /* malformed payload — ignore */
      }
    });

    es.addEventListener("complete", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as ScanProgress;
        setScanProgress(payload);
      } catch {
        /* malformed payload — ignore */
      }
    });

    return () => {
      es.close();
    };
  }, []);

  // Persist the streamed signal map to localStorage so the edge list survives
  // a refresh. Debounced 400ms — during a fast scan we update the map dozens
  // of times per second and writing every update would thrash localStorage
  // (which is synchronous and blocks the main thread).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setTimeout(() => {
      try {
        const payload: PersistedSignals = { signals: streamedSignals, savedAt: Date.now() };
        window.localStorage.setItem(STORAGE_KEY_SIGNALS, JSON.stringify(payload));
      } catch {
        // quota exceeded / private-mode / disabled — silently drop, the next
        // SSE snapshot will rehydrate from the server cache on next refresh.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [streamedSignals]);

  // Same idea for scan progress so the progress bar comes back on refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setTimeout(() => {
      try {
        const payload: PersistedProgress = { progress: scanProgress, savedAt: Date.now() };
        window.localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(payload));
      } catch {
        /* see above */
      }
    }, 400);
    return () => clearTimeout(id);
  }, [scanProgress]);

  async function patchConfig(patch: Partial<BotConfig>) {
    setBusy("config");
    try {
      const res = await fetch("/api/bot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) await fetchState();
    } finally {
      setBusy(null);
    }
  }

  async function toggleEngine(next: boolean) {
    await patchConfig({ autoTradeEnabled: next });
  }

  async function startAutoTrading() {
    if (draftCap <= 0) return;
    setBusy("start");
    try {
      // One-click activation: save settings + flip engine on + fire a cycle
      // now so the user sees the bot react immediately rather than waiting
      // for the 60s server tick.
      const patch: Record<string, unknown> = {
        autoTradeEnabled: true,
        maxDeployedCapital: draftCap,
        botTrailStartPct: draftTrailStart,
        botTrailDistancePct: draftTrailDistance,
        botMaxSectorExposurePct: draftSectorCap,
        botEntryWindowStart: draftWindowStart.trim() || null,
        botEntryWindowEnd: draftWindowEnd.trim() || null
      };
      await fetch("/api/bot/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      await fetch("/api/bot/run", { method: "POST" });
      await fetchState();
    } finally {
      setBusy(null);
    }
  }

  async function killSwitch() {
    if (!window.confirm("Emergency stop: pause the AI bot now? Open trades and wallet stay unchanged.")) return;
    setBusy("kill");
    try {
      await fetch("/api/bot/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      await fetchState();
    } finally {
      setBusy(null);
    }
  }

  async function resetWallet() {
    if (
      !window.confirm(
        "Reset virtual wallet to ₹100,000?\n\nThis clears all bot orders, portfolio holdings, wallet transactions, and bot activity events — gives you a clean slate to re-test the bot. Cannot be undone."
      )
    )
      return;
    setBusy("reset");
    try {
      await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESET" })
      });
      await fetchState();
    } finally {
      setBusy(null);
    }
  }

  const enabled = state?.config.autoTradeEnabled ?? false;
  const liveLocked = state?.config.liveModeLocked ?? true;
  const lossPct = useMemo(() => {
    if (!state) return 0;
    const { dailyLossUsed, dailyLossBudget } = state.kpis;
    return dailyLossBudget > 0 ? Math.min(100, (dailyLossUsed / dailyLossBudget) * 100) : 0;
  }, [state]);

  // Surface the top tradable candidate so the user always sees "what's next"
  // — even before the bot actually fires.
  const nextCandidate = useMemo(() => {
    if (!state) return null;
    return state.candidates.find((c) => c.eligible) ?? state.candidates[0] ?? null;
  }, [state]);

  if (loading) return <Card className="h-[380px] animate-pulse border-white/10 bg-white/5" />;
  if (!state) {
    return (
      <Card className="border-trade-red/30 bg-trade-red/5">
        <CardContent className="p-6 text-sm text-trade-red">Unable to load the quant bot.</CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden border transition-all duration-500",
        enabled
          ? "border-trade-blue/40 bg-trade-blue/[0.04] shadow-[0_0_24px_rgba(59,130,246,0.12)]"
          : "border-white/10 bg-white/[0.02]"
      )}
    >
      <CardHeader className="border-b border-white/5 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border",
                enabled
                  ? "border-trade-blue/40 bg-trade-blue/10 text-trade-blue"
                  : "border-white/10 bg-white/5 text-slate-500"
              )}
            >
              <Bot className={cn("h-5 w-5", enabled && "animate-pulse")} />
            </span>
            <span>
              <span className="block font-bold text-white">AI Quant Bot</span>
              <span className="text-[11px] font-normal text-slate-400">
                Set your ₹ range. Bot auto-tunes everything else.
              </span>
            </span>
          </CardTitle>

          <div className="flex items-center gap-2">
            <Badge tone={enabled ? "green" : "slate"}>
              <span
                className={cn(
                  "mr-1.5 inline-block h-2 w-2 rounded-full",
                  enabled ? "animate-pulse bg-trade-green" : "bg-slate-500"
                )}
              />
              {state.status}
            </Badge>
            <Badge tone="cyan">PAPER{liveLocked ? " · locked" : ""}</Badge>
            <Switch checked={enabled} onCheckedChange={toggleEngine} disabled={busy === "config"} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {/* Live status strip — always visible so the user knows the bot is alive */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", enabled ? "animate-pulse bg-trade-green" : "bg-slate-600")} />
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
              {enabled ? `Live · ticks every ${SERVER_TICK_SEC}s` : "Paused"}
            </span>
          </div>

          {nextCandidate && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-slate-500">Next:</span>
              <span className="font-mono font-bold text-white">{nextCandidate.symbol}</span>
              <span className="font-mono text-slate-400">{inr(nextCandidate.price)}</span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold",
                  nextCandidate.eligible ? "bg-trade-green/20 text-trade-green" : "bg-white/5 text-slate-500"
                )}
                title={nextCandidate.reason}
              >
                {nextCandidate.compositeScore}/100
              </span>
            </div>
          )}

          <Button size="sm" variant="secondary" onClick={runCycle} disabled={!enabled || busy === "run"} className="ml-auto h-8">
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run cycle now
          </Button>

          <Button size="sm" variant="danger" onClick={killSwitch} disabled={busy === "kill"} className="h-8">
            {busy === "kill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleStop className="h-3.5 w-3.5" />}
            Kill
          </Button>
        </div>

        {/* KPI strip — Wallet replaces Exposure (more meaningful in paper-test context) */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Virtual Wallet"
            value={inr(state.kpis.balance)}
            tone="neutral"
            icon={Wallet}
          />
          <Kpi
            label="P&L Today"
            value={inr(state.kpis.totalPnlToday)}
            tone={state.kpis.totalPnlToday >= 0 ? "pos" : "neg"}
            icon={state.kpis.totalPnlToday >= 0 ? TrendingUp : TrendingDown}
          />
          <Kpi label="Win Rate" value={`${state.kpis.winRateToday}%`} tone="neutral" icon={Target} />
          <Kpi label="Trades" value={String(state.kpis.tradesToday)} tone="neutral" icon={Activity} />
        </div>

        {/* Wallet utilization — shows how much of the virtual wallet the bot has deployed */}
        <WalletUtilization
          freeBalance={state.kpis.balance}
          deployed={state.kpis.openExposure}
          openPositions={state.kpis.openPositionsCount}
        />

        {/* Daily loss budget */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-bold uppercase tracking-wide text-slate-400">Daily loss budget</span>
            <span className="font-mono text-slate-300">
              {inr(state.kpis.dailyLossUsed)} / {inr(state.kpis.dailyLossBudget)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                lossPct < 60 ? "bg-trade-green" : lossPct < 90 ? "bg-trade-amber" : "bg-trade-red"
              )}
              style={{ width: `${lossPct}%` }}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10">
          {(
            [
              ["edge", "Edge Signals", Gauge],
              ["positions", "Positions", Wallet],
              ["activity", "Activity", Activity],
              ["settings", "Settings", Settings2]
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition",
                tab === key
                  ? "border-cyan-glow text-cyan-soft"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {key === "positions" && state.positions.length > 0 && (
                <span className="rounded-full bg-cyan-glow/20 px-1.5 text-[10px] text-cyan-soft">
                  {state.positions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "edge" && (
          <EdgeList
            state={state}
            streamedSignals={streamedSignals}
            scanProgress={scanProgress}
          />
        )}
        {tab === "positions" && <Positions state={state} />}
        {tab === "activity" && <ActivityFeed state={state} />}
        {tab === "settings" && (
          <SettingsTab
            state={state}
            draftCap={draftCap}
            draftTrailStart={draftTrailStart}
            draftTrailDistance={draftTrailDistance}
            draftSectorCap={draftSectorCap}
            draftWindowStart={draftWindowStart}
            draftWindowEnd={draftWindowEnd}
            setDraftCap={setDraftCap}
            setDraftTrailStart={setDraftTrailStart}
            setDraftTrailDistance={setDraftTrailDistance}
            setDraftSectorCap={setDraftSectorCap}
            setDraftWindowStart={setDraftWindowStart}
            setDraftWindowEnd={setDraftWindowEnd}
            onStart={startAutoTrading}
            saving={busy === "start" || busy === "config"}
            enabled={enabled}
            onResetWallet={resetWallet}
            resetting={busy === "reset"}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- sub-components ---------- */

function Kpi({
  label,
  value,
  tone,
  icon: Icon
}: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "neutral";
  icon: typeof TrendingUp;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "pos" ? "text-trade-green" : tone === "neg" ? "text-trade-red" : "text-cyan-soft"
          )}
        />
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-lg font-bold",
          tone === "pos" ? "text-trade-green" : tone === "neg" ? "text-trade-red" : "text-white"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function WalletUtilization({
  freeBalance,
  deployed,
  openPositions
}: {
  freeBalance: number;
  deployed: number;
  openPositions: number;
}) {
  // freeBalance = wallet cash after BUYs have debited it.
  // deployed    = sum of entry-price × qty across open BOT positions.
  // total       = what the user originally had to work with.
  const total = freeBalance + deployed;
  const deployedPct = total > 0 ? (deployed / total) * 100 : 0;
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-bold uppercase tracking-wide text-slate-400">Wallet utilization</span>
        <span className="font-mono text-slate-300">
          {inr(deployed)} deployed
          <span className="ml-2 text-slate-500">·</span>
          <span className="ml-2">{inr(freeBalance)} free</span>
          {openPositions > 0 && (
            <span className="ml-2 text-slate-500">({openPositions} position{openPositions === 1 ? "" : "s"})</span>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            "h-full rounded-full bg-trade-blue transition-all",
            deployedPct > 80 && "bg-trade-amber"
          )}
          style={{ width: `${deployedPct}%` }}
        />
      </div>
    </div>
  );
}

function scoreTone(score: number) {
  if (score >= 65) return "text-trade-green";
  if (score >= 45) return "text-cyan-soft";
  return "text-slate-500";
}

function ScanProgressBar({
  scanProgress,
  pct
}: {
  scanProgress: ScanProgress | null;
  pct: number;
}) {
  if (!scanProgress) return null;
  const done = !scanProgress.scanning && scanProgress.finishedAt !== null;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        done
          ? "border-trade-green/30 bg-trade-green/[0.04]"
          : "border-cyan-glow/20 bg-cyan-glow/[0.05]"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
        <span className={done ? "text-trade-green" : "text-cyan-soft"}>
          {done ? "Scan complete" : "Scanning universe"}
        </span>
        <span className="font-mono text-slate-400">
          {scanProgress.processed.toLocaleString("en-IN")} /{" "}
          {scanProgress.total.toLocaleString("en-IN")} · {scanProgress.kept} kept
          {scanProgress.dropped > 0 ? ` · ${scanProgress.dropped} skipped` : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={cn(
            "h-full transition-all duration-500",
            done ? "bg-trade-green" : "bg-cyan-soft"
          )}
          // eslint-disable-next-line react/forbid-component-props
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Synthesise a BotCandidate-shaped row from a streamed EdgeSignal. The
// streaming path doesn't have the AI/sector/eligibility decoration so we
// flag it as ineligible with a "Scanning..." reason; the next bot cycle's
// real BotCandidate (via polling) overwrites the entry once available.
function streamedToCandidate(s: StreamedSignal): BotCandidate {
  return {
    symbol: s.symbol,
    sector: null,
    price: s.price,
    inSetup: s.inSetup,
    edgePct: s.edgePct,
    winProb: s.winProb,
    payoff: s.payoff,
    kelly: s.kelly,
    sampleSize: s.sampleSize,
    stopPrice: s.stopPrice,
    targetPrice: s.targetPrice,
    zScore: s.zScore,
    trendUp: s.trendUp,
    intradayMomentum: s.intradayMomentum,
    intradayTrendUp: s.intradayTrendUp,
    intradayPullback: s.intradayPullback,
    rvol: s.rvol,
    rsi14: s.rsi14,
    macdHist: s.macdHist,
    adx14: s.adx14,
    bbPctB: s.bbPctB,
    obvSlope: s.obvSlope,
    compositeScore: s.compositeScore,
    eligible: false,
    reason: "Scanning…",
    reasons: []
  };
}

function EdgeList({
  state,
  streamedSignals,
  scanProgress
}: {
  state: BotState;
  streamedSignals: Record<string, StreamedSignal>;
  scanProgress: ScanProgress | null;
}) {
  // Merge: full BotCandidates win (they carry AI assessment + eligibility);
  // streamed-only entries fill the rest so the user sees every symbol the
  // scanner has touched, not just the ones the last full cycle assessed.
  const merged: BotCandidate[] = (() => {
    const seen = new Set<string>();
    const out: BotCandidate[] = [];
    for (const c of state.candidates) {
      if (seen.has(c.symbol)) continue;
      seen.add(c.symbol);
      out.push(c);
    }
    for (const sym of Object.keys(streamedSignals)) {
      if (seen.has(sym)) continue;
      seen.add(sym);
      out.push(streamedToCandidate(streamedSignals[sym]));
    }
    // Sort by composite score desc so the freshest live signals get ordered
    // alongside the assessed candidates instead of always pinned at the bottom.
    return out.sort((a, b) => b.compositeScore - a.compositeScore || b.edgePct - a.edgePct);
  })();

  const pct =
    scanProgress && scanProgress.total > 0
      ? Math.min(100, Math.round((scanProgress.processed / scanProgress.total) * 100))
      : 0;
  const showProgress =
    scanProgress &&
    (scanProgress.scanning || (scanProgress.finishedAt !== null && Date.now() - scanProgress.finishedAt < 8000));

  if (merged.length === 0) {
    return (
      <div className="space-y-3">
        {showProgress ? <ScanProgressBar scanProgress={scanProgress} pct={pct} /> : null}
        <p className="py-8 text-center text-sm text-slate-500">
          {scanProgress?.scanning
            ? `Scanning the universe… ${scanProgress.processed}/${scanProgress.total}`
            : "Computing edge from historical data…"}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {showProgress ? <ScanProgressBar scanProgress={scanProgress} pct={pct} /> : null}
      {/* On wide dashboards the bot now spans the full container, so render
          the edge list in a responsive grid: 1 column on mobile, 2 on lg+,
          3 on 2xl. Otherwise the cards would sit in a single tall stack
          and waste most of the horizontal real estate. */}
      <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {merged.map((c) => (
        <div
          key={c.symbol}
          className={cn(
            "rounded-lg border p-3 transition",
            c.eligible ? "border-trade-green/30 bg-trade-green/[0.04]" : "border-white/10 bg-white/[0.02]"
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-white">{c.symbol}</span>
              <span className="font-mono text-xs text-slate-400">{inr(c.price)}</span>
              {c.eligible ? (
                <Badge tone="green">TRADE</Badge>
              ) : (
                <span className="text-[11px] text-slate-500">{c.reason}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn("font-mono text-lg font-bold tabular-nums", scoreTone(c.compositeScore))}
                title="Composite quality score (0-100) — drives Kelly sizing"
              >
                {c.compositeScore}
              </span>
              <span
                className={cn(
                  "font-mono text-xs font-bold",
                  c.edgePct > 0 ? "text-trade-green" : "text-trade-red"
                )}
                title="Backtested expected value per trade"
              >
                edge {c.edgePct > 0 ? "+" : ""}
                {c.edgePct.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
            <span title="14-period RSI" className={c.rsi14 >= 35 && c.rsi14 <= 60 ? "text-cyan-soft" : ""}>
              RSI {c.rsi14.toFixed(0)}
            </span>
            <span title="14-period ADX (trend strength)" className={c.adx14 >= 20 ? "text-cyan-soft" : ""}>
              ADX {c.adx14.toFixed(0)}
            </span>
            <span title="MACD histogram (+ = momentum up)" className={c.macdHist > 0 ? "text-trade-green" : "text-trade-red"}>
              MACD {c.macdHist > 0 ? "+" : ""}{c.macdHist.toFixed(2)}
            </span>
            <span title="Bollinger %B position (0=lower, 1=upper)" className={c.bbPctB >= 0.1 && c.bbPctB <= 0.6 ? "text-cyan-soft" : ""}>
              %B {(c.bbPctB * 100).toFixed(0)}
            </span>
            <span title="OBV normalized slope" className={c.obvSlope > 0 ? "text-trade-green" : "text-trade-red"}>
              OBV {c.obvSlope > 0 ? "+" : ""}{(c.obvSlope * 100).toFixed(1)}
            </span>
            <span title="Relative volume">RVOL {c.rvol.toFixed(2)}x</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-400">
            <span>Win {c.winProb.toFixed(0)}%</span>
            <span>Payoff {c.payoff.toFixed(2)}R</span>
            <span className="text-cyan-soft">Kelly {(c.kelly * 100).toFixed(1)}%</span>
            <span className="text-trade-red">SL {inr(c.stopPrice)}</span>
            <span className="text-trade-green">TP {inr(c.targetPrice)}</span>
          </div>
        </div>
        ))}
      </div>
    </div>
  );
}

function Positions({ state }: { state: BotState }) {
  if (state.positions.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No open positions. The bot is scanning…</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500">
            <th className="py-2">Symbol</th>
            <th className="py-2">Qty</th>
            <th className="py-2">Entry</th>
            <th className="py-2">Now</th>
            <th className="py-2">SL / TP</th>
            <th className="py-2 text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {state.positions.map((p) => (
            <tr key={p.orderId} className="border-t border-white/5 font-mono">
              <td className="py-2.5 font-bold text-white">{p.symbol}</td>
              <td className="py-2.5 text-slate-300">{p.quantity}</td>
              <td className="py-2.5 text-slate-300">{inr(p.entryPrice)}</td>
              <td className="py-2.5 text-slate-300">{inr(p.currentPrice)}</td>
              <td className="py-2.5 text-[11px]">
                <span className="text-trade-red">{inr(p.stopLoss)}</span>
                {" / "}
                <span className="text-trade-green">{inr(p.takeProfit)}</span>
              </td>
              <td className={cn("py-2.5 text-right font-bold", p.pnl >= 0 ? "text-trade-green" : "text-trade-red")}>
                {p.pnl >= 0 ? "+" : ""}
                {inr(p.pnl)}
                <span className="ml-1 text-[10px] opacity-70">
                  ({p.pnlPct >= 0 ? "+" : ""}
                  {p.pnlPct}%)
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsTab({
  state,
  draftCap,
  draftTrailStart,
  draftTrailDistance,
  draftSectorCap,
  draftWindowStart,
  draftWindowEnd,
  setDraftCap,
  setDraftTrailStart,
  setDraftTrailDistance,
  setDraftSectorCap,
  setDraftWindowStart,
  setDraftWindowEnd,
  onStart,
  saving,
  enabled,
  onResetWallet,
  resetting
}: {
  state: BotState;
  draftCap: number;
  draftTrailStart: number;
  draftTrailDistance: number;
  draftSectorCap: number;
  draftWindowStart: string;
  draftWindowEnd: string;
  setDraftCap: (n: number) => void;
  setDraftTrailStart: (n: number) => void;
  setDraftTrailDistance: (n: number) => void;
  setDraftSectorCap: (n: number) => void;
  setDraftWindowStart: (s: string) => void;
  setDraftWindowEnd: (s: string) => void;
  onStart: () => void;
  saving: boolean;
  enabled: boolean;
  onResetWallet: () => void;
  resetting: boolean;
}) {
  const capInvalid = draftCap <= 0;
  const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  const windowStartInvalid = draftWindowStart.length > 0 && !hhmmRegex.test(draftWindowStart);
  const windowEndInvalid = draftWindowEnd.length > 0 && !hhmmRegex.test(draftWindowEnd);
  const windowOrderInvalid =
    !windowStartInvalid &&
    !windowEndInvalid &&
    draftWindowStart.length > 0 &&
    draftWindowEnd.length > 0 &&
    draftWindowEnd <= draftWindowStart;
  const formInvalid = capInvalid || windowStartInvalid || windowEndInvalid || windowOrderInvalid;

  // Auto-tuned values pulled straight from server config — these update
  // automatically as the user changes the wallet cap (gates are derived
  // from equity + cap).
  const tuned = state.config;

  return (
    <div className="space-y-4">
      {/* Wallet deployment cap — the single ₹ knob the user controls */}
      <div className="rounded-xl border border-cyan-glow/30 bg-cyan-glow/[0.04] p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-cyan-soft">
              Wallet deployment cap
            </Label>
            <p className="mt-1 text-xs text-slate-400">
              Maximum ₹ the bot may have deployed across ALL open positions at once.
              Once it hits this ceiling, no new entries open. Per-trade size is
              auto-decided by composite score × Half-Kelly.
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-cyan-soft">
            up to {inrCompact(draftCap)}
          </span>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest text-slate-400">
            Max deployed (₹)
          </Label>
          <Input
            type="number"
            min={1}
            step={1000}
            value={draftCap}
            onChange={(e) => setDraftCap(Math.max(1, Number(e.target.value)))}
            className={cn("h-10 bg-black/30 text-sm font-mono", capInvalid && "border-trade-red/60")}
          />
        </div>
        {capInvalid && (
          <p className="mt-2 text-[11px] text-trade-red">Cap must be greater than zero.</p>
        )}
      </div>

      {/* Trailing stop-loss */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-5">
        <div className="mb-3">
          <Label className="text-[11px] font-bold uppercase tracking-widest text-cyan-soft">
            Trailing stop-loss
          </Label>
          <p className="mt-1 text-xs text-slate-400">
            Once a position is up by <b>start %</b>, the stop ratchets up to <b>distance %</b>{" "}
            below the latest peak so winners lock in profit. Set either to 0 to disable.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Start %</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={draftTrailStart}
              onChange={(e) => setDraftTrailStart(Math.max(0, Number(e.target.value)))}
              className="h-10 bg-black/30 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Distance %</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={draftTrailDistance}
              onChange={(e) => setDraftTrailDistance(Math.max(0, Number(e.target.value)))}
              className="h-10 bg-black/30 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Sector exposure cap */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-cyan-soft">
              Sector exposure cap
            </Label>
            <p className="mt-1 text-xs text-slate-400">
              Maximum fraction of deployed capital allowed in any one sector. Forces
              diversification (e.g. caps Banking from eating all your wallet). Set to 0 to disable.
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-cyan-soft">
            {(draftSectorCap * 100).toFixed(0)}%
          </span>
        </div>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={draftSectorCap}
          onChange={(e) => setDraftSectorCap(Math.min(1, Math.max(0, Number(e.target.value))))}
          className="h-10 bg-black/30 text-sm font-mono"
        />
      </div>

      {/* Entry-window */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-5">
        <div className="mb-3">
          <Label className="text-[11px] font-bold uppercase tracking-widest text-cyan-soft">
            Entry-window (IST)
          </Label>
          <p className="mt-1 text-xs text-slate-400">
            New entries are only opened inside this window. Exits run all session regardless.
            Leave both blank to permit entries any time during NSE hours.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Start (HH:MM)</Label>
            <Input
              type="text"
              placeholder="09:30"
              value={draftWindowStart}
              onChange={(e) => setDraftWindowStart(e.target.value.trim())}
              className={cn(
                "h-10 bg-black/30 text-sm font-mono",
                (windowStartInvalid || windowOrderInvalid) && "border-trade-red/60"
              )}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">End (HH:MM)</Label>
            <Input
              type="text"
              placeholder="14:00"
              value={draftWindowEnd}
              onChange={(e) => setDraftWindowEnd(e.target.value.trim())}
              className={cn(
                "h-10 bg-black/30 text-sm font-mono",
                (windowEndInvalid || windowOrderInvalid) && "border-trade-red/60"
              )}
            />
          </div>
        </div>
        {(windowStartInvalid || windowEndInvalid) && (
          <p className="mt-2 text-[11px] text-trade-red">Use HH:MM (24-hour) — e.g. 09:30.</p>
        )}
        {windowOrderInvalid && (
          <p className="mt-2 text-[11px] text-trade-red">End must be after start.</p>
        )}
      </div>

      <Button
        onClick={onStart}
        disabled={saving || formInvalid}
        className="w-full bg-trade-green/20 text-trade-green hover:bg-trade-green/30 border border-trade-green/40"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : enabled ? (
          <Zap className="h-4 w-4" />
        ) : (
          <Rocket className="h-4 w-4" />
        )}
        {enabled ? "Save settings & run cycle now" : "Start Auto-Trading"}
      </Button>

      {/* Virtual wallet — for paper-mode testing */}
      <div className="rounded-lg border border-trade-amber/30 bg-trade-amber/[0.04] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-trade-amber">
              Virtual wallet (paper testing)
            </Label>
            <p className="mt-1 text-[11px] text-slate-400">
              Every PAPER buy debits this balance; every sell credits it. Reset to ₹100,000
              for a clean test run — clears bot orders, holdings, transactions, and activity.
            </p>
          </div>
          <span className="font-mono text-lg font-bold text-white">{inr(state.kpis.balance)}</span>
        </div>
        <Button
          onClick={onResetWallet}
          disabled={resetting || saving}
          variant="secondary"
          className="w-full border border-trade-amber/40"
        >
          {resetting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Reset virtual wallet to ₹1,00,000
        </Button>
      </div>

      {/* Auto-tuned values, read-only — so the user can audit what the bot is doing */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Auto-tuned by bot
          </Label>
          <span className="text-[10px] text-slate-600">Derived from equity + your range</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] md:grid-cols-3">
          <ReadOnlyKV label="Min edge gate" value={`${tuned.botMinEdgePct.toFixed(2)}%`} />
          <ReadOnlyKV label="Min quality score" value={`${tuned.botMinCompositeScore}/100`} />
          <ReadOnlyKV label="Kelly cap" value={`${(tuned.botKellyCap * 100).toFixed(0)}%`} />
          <ReadOnlyKV label="Risk per trade" value={`${tuned.botRiskPctPerTrade.toFixed(1)}% equity`} />
          <ReadOnlyKV label="Max open positions" value={String(tuned.botMaxOpenPositions)} />
          <ReadOnlyKV label="Daily loss cap" value={inrCompact(tuned.botMaxDailyLoss)} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          The bot reads ~1y of daily candles per stock, backtests a trend-pullback rule, then blends the
          backtested edge with live RSI / MACD / ADX / Bollinger / OBV into a 0-100{" "}
          <span className="text-cyan-soft">composite score</span>. Setups below the score gate are skipped.
          Exits are ATR stop / ATR target / 8-day time-stop.
          {tuned.liveModeLocked && (
            <>
              {" "}
              <span className="text-trade-amber">LIVE mode is locked off (paper-only testing).</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function ReadOnlyKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-mono text-xs font-bold text-cyan-soft">{value}</span>
    </div>
  );
}

function ActivityFeed({ state }: { state: BotState }) {
  if (state.events.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No bot activity yet — the next cycle will populate this feed.</p>;
  }
  const tone: Record<string, string> = {
    TRADE: "text-trade-green",
    RISK: "text-trade-amber",
    ERROR: "text-trade-red",
    INFO: "text-slate-400"
  };
  return (
    <div className="max-h-72 space-y-1.5 overflow-y-auto">
      {state.events.map((e) => (
        <div key={e.id} className="flex items-start gap-2 rounded-md bg-white/[0.02] p-2 text-xs">
          <span className={cn("mt-0.5 font-mono text-[10px] font-bold", tone[e.level])}>{e.level}</span>
          <span className="flex-1 text-slate-300">{e.message}</span>
          <span className="font-mono text-[10px] text-slate-600">
            {new Date(e.createdAt).toLocaleTimeString("en-IN")}
          </span>
        </div>
      ))}
    </div>
  );
}
