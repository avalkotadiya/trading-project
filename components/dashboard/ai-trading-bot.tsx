"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CircleStop,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Rocket,
  ScanLine,
  Settings2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wand2,
  Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useLiveMarket } from "@/hooks/use-live-market";
import { cn } from "@/utils/cn";
import type { BotConfig, BotPosition, BotRecommendation, BotState } from "@/types/bot";

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const inrCompact = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

type Tab = "positions" | "activity" | "settings";

const STATE_POLL_MS = 12000;
const SERVER_TICK_SEC = 60;

// Schema defaults — used to detect an "untouched" config so we can pre-fill the
// drafts from the AI recommendation the first time a user opens the bot.
const DEFAULTS = { cap: 50000, trailStart: 2, trailDistance: 1.5, sector: 0.4 } as const;

export function AiTradingBot() {
  const [state, setState] = useState<BotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("positions");
  const [busy, setBusy] = useState<string | null>(null);
  const [draftCap, setDraftCap] = useState<number>(50000);
  const [draftTrailStart, setDraftTrailStart] = useState<number>(2);
  const [draftTrailDistance, setDraftTrailDistance] = useState<number>(1.5);
  const [draftSectorCap, setDraftSectorCap] = useState<number>(0.4);
  const [draftWindowStart, setDraftWindowStart] = useState<string>("");
  const [draftWindowEnd, setDraftWindowEnd] = useState<string>("");
  const hydratedRef = useRef(false);

  // ── Continuous live prices ─────────────────────────────────────────────────
  // The shared SSE feed streams the dashboard universe (~4×/s). We overlay the
  // latest live price onto the bot's open positions so "Now" / P&L tick
  // continuously instead of jumping only every 12 s state poll.
  const heldSymbols = useMemo(
    () => (state?.positions ?? []).map((p) => `NSE:${p.symbol}`),
    [state?.positions]
  );
  const { ticks, connectionStatus } = useLiveMarket([], undefined, heldSymbols);
  const livePriceBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of ticks) if (t.price > 0) m.set(t.symbol, t.price);
    return m;
  }, [ticks]);
  const isLive = connectionStatus === "live";

  const runningRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/state?candidates=0", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setState(json.data);
        // Hydrate drafts once. If the stored config is still at the schema
        // defaults (never configured), seed from the AI recommendation so the
        // bot "takes its settings from the data" by default — otherwise keep
        // the user's saved values. Either way edits stick until they Save.
        if (!hydratedRef.current) {
          const cfg = json.data.config as BotConfig;
          const reco = json.data.recommendation as BotRecommendation | null;
          const untouched =
            cfg.maxDeployedCapital === DEFAULTS.cap &&
            cfg.botTrailStartPct === DEFAULTS.trailStart &&
            cfg.botTrailDistancePct === DEFAULTS.trailDistance &&
            cfg.botMaxSectorExposurePct === DEFAULTS.sector &&
            !cfg.botEntryWindowStart &&
            !cfg.botEntryWindowEnd;
          const src = untouched && reco ? reco : cfg;
          setDraftCap(src.maxDeployedCapital);
          setDraftTrailStart(src.botTrailStartPct);
          setDraftTrailDistance(src.botTrailDistancePct);
          setDraftSectorCap(src.botMaxSectorExposurePct);
          setDraftWindowStart(src.botEntryWindowStart ?? "");
          setDraftWindowEnd(src.botEntryWindowEnd ?? "");
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
    void fetchState();
    const poll = setInterval(() => void fetchState(), STATE_POLL_MS);
    return () => clearInterval(poll);
  }, [fetchState]);

  // ──────────────────────────────────────────────────────────────────────────
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

  function applyRecommendation(reco: BotRecommendation) {
    setDraftCap(reco.maxDeployedCapital);
    setDraftTrailStart(reco.botTrailStartPct);
    setDraftTrailDistance(reco.botTrailDistancePct);
    setDraftSectorCap(reco.botMaxSectorExposurePct);
    setDraftWindowStart(reco.botEntryWindowStart ?? "");
    setDraftWindowEnd(reco.botEntryWindowEnd ?? "");
  }

  async function startAutoTrading() {
    if (draftCap <= 0) return;
    setBusy("start");
    try {
      // One-click activation: save settings + flip engine on + fire a cycle now
      // so the user sees the bot react immediately rather than waiting 60s.
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
        "Reset virtual wallet to ₹1,00,000?\n\nThis clears all bot orders, portfolio holdings, wallet transactions, and bot activity events — gives you a clean slate to re-test the bot. Cannot be undone."
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

  // Live-overlaid positions + KPIs.
  const livePositions = useMemo<BotPosition[]>(() => {
    if (!state) return [];
    return state.positions.map((p) => {
      const live = livePriceBySymbol.get(p.symbol);
      if (!live || live <= 0) return p;
      const pnl = Number(((live - p.entryPrice) * p.quantity).toFixed(2));
      const pnlPct = p.entryPrice > 0 ? Number((((live - p.entryPrice) / p.entryPrice) * 100).toFixed(2)) : 0;
      return { ...p, currentPrice: live, pnl, pnlPct };
    });
  }, [state, livePriceBySymbol]);

  const liveUnrealized = useMemo(
    () => Number(livePositions.reduce((acc, p) => acc + p.pnl, 0).toFixed(2)),
    [livePositions]
  );

  const lossPct = useMemo(() => {
    if (!state) return 0;
    const { dailyLossUsed, dailyLossBudget } = state.kpis;
    return dailyLossBudget > 0 ? Math.min(100, (dailyLossUsed / dailyLossBudget) * 100) : 0;
  }, [state]);

  if (loading) return <Card className="matte-panel matte-card h-[420px] animate-pulse border-sapphire-glow/10" />;
  if (!state) {
    return (
      <Card className="border-trade-red/30 bg-trade-red/5">
        <CardContent className="p-6 text-sm text-trade-red">Unable to load the quant bot.</CardContent>
      </Card>
    );
  }

  const liveTotalPnl = Number((state.kpis.realizedPnlToday + liveUnrealized).toFixed(2));

  return (
    <Card
      className={cn(
        "matte-panel matte-card overflow-hidden transition-all duration-500",
        enabled ? "matte-active-rim shadow-matte-raise" : "shadow-matte"
      )}
    >
      <CardHeader className="border-b border-sapphire-glow/10 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-3 text-base">
            <span
              className={cn(
                "matte-raise flex h-11 w-11 items-center justify-center rounded-xl",
                enabled ? "text-sapphire-soft" : "text-slate-500"
              )}
            >
              <Bot className={cn("h-5 w-5", enabled && "animate-pulse")} />
            </span>
            <span>
              <span className="sapphire-title block text-lg font-black tracking-tight">AI Quant Bot</span>
              <span className="text-[11px] font-medium text-slate-400">
                Auto-tuned from your wallet, the edge model &amp; live scanner tape.
              </span>
            </span>
          </CardTitle>

          <div className="flex items-center gap-2">
            <Badge tone={isLive ? "green" : "slate"} className="gap-1.5">
              <Radio className={cn("h-3 w-3", isLive ? "animate-pulse text-trade-green" : "text-slate-500")} />
              {isLive ? "Live" : connectionStatus}
            </Badge>
            <Badge tone="slate">PAPER{liveLocked ? " · locked" : ""}</Badge>
            <Switch checked={enabled} onCheckedChange={toggleEngine} disabled={busy === "config"} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {/* Status strip */}
        <div className="matte-inset flex flex-wrap items-center gap-3 p-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", enabled ? "animate-pulse bg-trade-green" : "bg-slate-600")} />
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
              {enabled ? `Active · server ticks every ${SERVER_TICK_SEC}s` : "Paused"}
            </span>
          </div>

          <Button size="sm" variant="secondary" onClick={runCycle} disabled={!enabled || busy === "run"} className="ml-auto h-8">
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run cycle now
          </Button>

          <Button size="sm" variant="danger" onClick={killSwitch} disabled={busy === "kill"} className="h-8">
            {busy === "kill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleStop className="h-3.5 w-3.5" />}
            Kill
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Virtual Wallet" value={inr(state.kpis.balance)} tone="neutral" icon={Wallet} />
          <Kpi
            label="P&L Today"
            value={inr(liveTotalPnl)}
            tone={liveTotalPnl >= 0 ? "pos" : "neg"}
            icon={liveTotalPnl >= 0 ? TrendingUp : TrendingDown}
            live={livePositions.length > 0 && isLive}
          />
          <Kpi label="Win Rate" value={`${state.kpis.winRateToday}%`} tone="neutral" icon={Target} />
          <Kpi label="Trades" value={String(state.kpis.tradesToday)} tone="neutral" icon={Activity} />
        </div>

        <WalletUtilization
          freeBalance={state.kpis.balance}
          deployed={state.kpis.openExposure}
          openPositions={state.kpis.openPositionsCount}
        />

        {/* Scanner confluence — the live tape feeding the bot's entry algorithm */}
        {state.scanner && <ScannerConfluence scanner={state.scanner} />}

        {/* Daily loss budget */}
        <div className="matte-inset p-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-bold uppercase tracking-wide text-slate-400">Daily loss budget</span>
            <span className="font-mono text-slate-300">
              {inr(state.kpis.dailyLossUsed)} / {inr(state.kpis.dailyLossBudget)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/40">
            {/* eslint-disable-next-line no-inline-styles */}
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
        <div className="flex gap-1 border-b border-sapphire-glow/10">
          {(
            [
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
                  ? "border-sapphire-glow text-sapphire-soft"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {key === "positions" && livePositions.length > 0 && (
                <span className="rounded-full bg-sapphire-glow/20 px-1.5 text-[10px] text-sapphire-soft">
                  {livePositions.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "positions" && <Positions positions={livePositions} live={isLive} />}
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
            onApplyRecommendation={applyRecommendation}
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
  icon: Icon,
  live
}: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "neutral";
  icon: typeof TrendingUp;
  live?: boolean;
}) {
  return (
    <div className="matte-inset p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        {live ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-trade-green" title="Live" />
        ) : (
          <Icon
            className={cn(
              "h-3.5 w-3.5",
              tone === "pos" ? "text-trade-green" : tone === "neg" ? "text-trade-red" : "text-sapphire-soft"
            )}
          />
        )}
      </div>
      <p
        className={cn(
          "mt-1.5 font-mono text-lg font-bold tabular-nums",
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
  const total = freeBalance + deployed;
  const deployedPct = total > 0 ? (deployed / total) * 100 : 0;
  return (
    <div className="matte-inset p-3">
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
      <div className="h-2 overflow-hidden rounded-full bg-black/40">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r from-sapphire-deep to-sapphire-glow transition-all",
            deployedPct > 80 && "from-trade-amber to-trade-amber"
          )}
          style={{ width: `${deployedPct}%` }}
        />
      </div>
    </div>
  );
}

function ScannerConfluence({ scanner }: { scanner: NonNullable<BotState["scanner"]> }) {
  const breadthTone =
    scanner.breadth > 25 ? "text-trade-green" : scanner.breadth < -25 ? "text-trade-red" : "text-slate-300";
  const breadthLabel = scanner.breadth > 25 ? "Risk-On" : scanner.breadth < -25 ? "Risk-Off" : "Neutral";
  return (
    <div className="matte-inset p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
          <ScanLine className="h-3.5 w-3.5 text-sapphire-soft" />
          Scanner confluence
        </span>
        <span className="text-[10px] text-slate-500">{scanner.analyzed} symbols · feeds entry algo</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className={cn("font-mono text-lg font-bold tabular-nums", breadthTone)}>
            {scanner.breadth > 0 ? "+" : ""}
            {scanner.breadth}
          </p>
          <p className="text-[10px] text-slate-500">{breadthLabel} breadth</p>
        </div>
        <div>
          <p className="font-mono text-lg font-bold tabular-nums text-white">{scanner.avgRvol.toFixed(2)}x</p>
          <p className="text-[10px] text-slate-500">Avg RVOL</p>
        </div>
        <div>
          <p className="font-mono text-lg font-bold tabular-nums text-white">
            <span className="text-trade-green">{scanner.bullish}</span>
            <span className="mx-1 text-slate-600">/</span>
            <span className="text-trade-red">{scanner.bearish}</span>
          </p>
          <p className="text-[10px] text-slate-500">Bull / Bear</p>
        </div>
      </div>
      {scanner.leaders.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/5 pt-2.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Leaders</span>
          {scanner.leaders.map((l) => (
            <span
              key={l.symbol}
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold",
                l.signal === "bullish"
                  ? "border-trade-green/30 bg-trade-green/10 text-trade-green"
                  : l.signal === "bearish"
                    ? "border-trade-red/30 bg-trade-red/10 text-trade-red"
                    : "border-white/10 bg-white/5 text-slate-300"
              )}
            >
              {l.symbol} {l.score.toFixed(0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Positions({ positions, live }: { positions: BotPosition[]; live: boolean }) {
  if (positions.length === 0) {
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
            <th className="py-2">
              Now {live && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-trade-green align-middle" />}
            </th>
            <th className="py-2">SL / TP</th>
            <th className="py-2 text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.orderId} className="border-t border-white/5 font-mono">
              <td className="py-2.5 font-bold text-white">{p.symbol}</td>
              <td className="py-2.5 text-slate-300">{p.quantity}</td>
              <td className="py-2.5 text-slate-300">{inr(p.entryPrice)}</td>
              <td className="py-2.5 font-semibold text-sapphire-soft">{inr(p.currentPrice)}</td>
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
  onApplyRecommendation,
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
  onApplyRecommendation: (reco: BotRecommendation) => void;
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

  const tuned = state.config;
  const reco = state.recommendation;

  // Whether the current drafts already match the AI recommendation.
  const matchesReco =
    reco !== null &&
    draftCap === reco.maxDeployedCapital &&
    draftTrailStart === reco.botTrailStartPct &&
    draftTrailDistance === reco.botTrailDistancePct &&
    draftSectorCap === reco.botMaxSectorExposurePct &&
    (draftWindowStart || null) === reco.botEntryWindowStart &&
    (draftWindowEnd || null) === reco.botEntryWindowEnd;

  return (
    <div className="space-y-4">
      {/* AI recommendation banner */}
      {reco && (
        <div className="matte-raise p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-sapphire-glow/15 text-sapphire-soft">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <Label className="text-[11px] font-bold uppercase tracking-widest text-sapphire-soft">
                  AI-recommended settings
                </Label>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Derived from your ₹{Math.round(reco.basis.walletBalance).toLocaleString("en-IN")} wallet,{" "}
                  {reco.basis.candidatesAnalyzed} live edge candidates (~{reco.basis.medianAtrPct}% median ATR,
                  avg quality {reco.basis.avgCompositeScore}/100) and scanner breadth {reco.basis.scannerBreadth}.
                  Defaults are pre-filled — edit any field, or re-apply below.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onApplyRecommendation(reco)}
              disabled={matchesReco}
              className="h-8 shrink-0 border border-sapphire-glow/30"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {matchesReco ? "Applied" : "Use AI"}
            </Button>
          </div>
        </div>
      )}

      {/* Wallet deployment cap */}
      <div className="matte-inset p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-sapphire-soft">
              Wallet deployment cap
            </Label>
            <p className="mt-1 text-xs text-slate-400">
              Maximum ₹ the bot may have deployed across ALL open positions at once. Per-trade size is
              auto-decided by composite score × scanner confluence × Half-Kelly.
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-sapphire-soft">up to {inrCompact(draftCap)}</span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Max deployed (₹)</Label>
            {reco && <AiHint value={inrCompact(reco.maxDeployedCapital)} onClick={() => setDraftCap(reco.maxDeployedCapital)} />}
          </div>
          <Input
            type="number"
            min={1}
            step={1000}
            value={draftCap}
            onChange={(e) => setDraftCap(Math.max(1, Number(e.target.value)))}
            className={cn("h-10 bg-black/30 font-mono text-sm", capInvalid && "border-trade-red/60")}
          />
          {reco && <p className="text-[11px] leading-relaxed text-slate-500">{reco.rationale.maxDeployedCapital}</p>}
        </div>
        {capInvalid && <p className="mt-2 text-[11px] text-trade-red">Cap must be greater than zero.</p>}
      </div>

      {/* Trailing stop-loss */}
      <div className="matte-inset p-5">
        <div className="mb-3 flex items-center justify-between">
          <Label className="text-[11px] font-bold uppercase tracking-widest text-sapphire-soft">
            Trailing stop-loss
          </Label>
          {reco && (
            <AiHint
              value={`${reco.botTrailStartPct}% / ${reco.botTrailDistancePct}%`}
              onClick={() => {
                setDraftTrailStart(reco.botTrailStartPct);
                setDraftTrailDistance(reco.botTrailDistancePct);
              }}
            />
          )}
        </div>
        <p className="mb-3 text-xs text-slate-400">
          Once a position is up by <b>start %</b>, the stop ratchets to <b>distance %</b> below the latest peak so
          winners lock in profit. Set either to 0 to disable.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Start %</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={draftTrailStart}
              onChange={(e) => setDraftTrailStart(Math.max(0, Number(e.target.value)))}
              className="h-10 bg-black/30 font-mono text-sm"
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
              className="h-10 bg-black/30 font-mono text-sm"
            />
          </div>
        </div>
        {reco && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{reco.rationale.trailing}</p>}
      </div>

      {/* Sector exposure cap */}
      <div className="matte-inset p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[11px] font-bold uppercase tracking-widest text-sapphire-soft">
              Sector exposure cap
            </Label>
            <p className="mt-1 text-xs text-slate-400">
              Maximum fraction of deployed capital in any one sector. Forces diversification. Set to 0 to disable.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="font-mono text-sm font-bold text-sapphire-soft">{(draftSectorCap * 100).toFixed(0)}%</span>
            {reco && (
              <AiHint
                value={`${(reco.botMaxSectorExposurePct * 100).toFixed(0)}%`}
                onClick={() => setDraftSectorCap(reco.botMaxSectorExposurePct)}
              />
            )}
          </div>
        </div>
        <Input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={draftSectorCap}
          onChange={(e) => setDraftSectorCap(Math.min(1, Math.max(0, Number(e.target.value))))}
          className="h-10 bg-black/30 font-mono text-sm"
        />
        {reco && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{reco.rationale.sectorCap}</p>}
      </div>

      {/* Entry-window */}
      <div className="matte-inset p-5">
        <div className="mb-3 flex items-center justify-between">
          <Label className="text-[11px] font-bold uppercase tracking-widest text-sapphire-soft">
            Entry-window (IST)
          </Label>
          {reco && (
            <AiHint
              value={reco.botEntryWindowStart ? `${reco.botEntryWindowStart}–${reco.botEntryWindowEnd}` : "All hours"}
              onClick={() => {
                setDraftWindowStart(reco.botEntryWindowStart ?? "");
                setDraftWindowEnd(reco.botEntryWindowEnd ?? "");
              }}
            />
          )}
        </div>
        <p className="mb-3 text-xs text-slate-400">
          New entries only open inside this window. Exits run all session regardless. Leave both blank to permit
          entries any time during NSE hours.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">Start (HH:MM)</Label>
            <Input
              type="text"
              placeholder="09:30"
              value={draftWindowStart}
              onChange={(e) => setDraftWindowStart(e.target.value.trim())}
              className={cn(
                "h-10 bg-black/30 font-mono text-sm",
                (windowStartInvalid || windowOrderInvalid) && "border-trade-red/60"
              )}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-400">End (HH:MM)</Label>
            <Input
              type="text"
              placeholder="15:00"
              value={draftWindowEnd}
              onChange={(e) => setDraftWindowEnd(e.target.value.trim())}
              className={cn(
                "h-10 bg-black/30 font-mono text-sm",
                (windowEndInvalid || windowOrderInvalid) && "border-trade-red/60"
              )}
            />
          </div>
        </div>
        {(windowStartInvalid || windowEndInvalid) && (
          <p className="mt-2 text-[11px] text-trade-red">Use HH:MM (24-hour) — e.g. 09:30.</p>
        )}
        {windowOrderInvalid && <p className="mt-2 text-[11px] text-trade-red">End must be after start.</p>}
        {reco && !windowStartInvalid && !windowEndInvalid && !windowOrderInvalid && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{reco.rationale.entryWindow}</p>
        )}
      </div>

      <Button
        onClick={onStart}
        disabled={saving || formInvalid}
        className="w-full border border-trade-green/40 bg-trade-green/20 text-trade-green hover:bg-trade-green/30"
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

      {/* Virtual wallet */}
      <div className="rounded-xl border border-trade-amber/30 bg-trade-amber/[0.04] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-widest text-trade-amber">
              Virtual wallet (paper testing)
            </Label>
            <p className="mt-1 text-[11px] text-slate-400">
              Every PAPER buy debits this balance; every sell credits it. Reset to ₹1,00,000 for a clean test run.
            </p>
          </div>
          <span className="font-mono text-lg font-bold text-white">{inr(state.kpis.balance)}</span>
        </div>
        <Button onClick={onResetWallet} disabled={resetting || saving} variant="secondary" className="w-full border border-trade-amber/40">
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Reset virtual wallet to ₹1,00,000
        </Button>
      </div>

      {/* Auto-tuned values, read-only */}
      <div className="matte-inset p-4">
        <div className="mb-3 flex items-center justify-between">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Auto-tuned by bot</Label>
          <span className="text-[10px] text-slate-600">Derived from equity + your range</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] md:grid-cols-3">
          <ReadOnlyKV label="Signal threshold" value={`${tuned.botMinEdgePct.toFixed(2)}%`} />
          <ReadOnlyKV label="Min quality score" value={`${tuned.botMinCompositeScore}/100`} />
          <ReadOnlyKV label="Kelly cap" value={`${(tuned.botKellyCap * 100).toFixed(0)}%`} />
          <ReadOnlyKV label="Risk per trade" value={`${tuned.botRiskPctPerTrade.toFixed(1)}% equity`} />
          <ReadOnlyKV label="Max open positions" value={String(tuned.botMaxOpenPositions)} />
          <ReadOnlyKV label="Daily loss cap" value={inrCompact(tuned.botMaxDailyLoss)} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          The bot reads ~1y of daily candles per stock, backtests trend behaviour, then blends historical strength
          with live RSI / MACD / ADX / Bollinger / OBV into a 0-100 <span className="text-sapphire-soft">composite
          score</span>, confirmed against live <span className="text-sapphire-soft">scanner confluence</span>. Exits
          are ATR stop / ATR target / trailing stop / 8-day time-stop.
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

function AiHint({ value, onClick }: { value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-sapphire-glow/25 bg-sapphire-glow/10 px-1.5 py-0.5 text-[10px] font-bold text-sapphire-soft transition hover:bg-sapphire-glow/20"
      title="Apply AI suggestion"
    >
      <Sparkles className="h-2.5 w-2.5" />
      AI: {value}
    </button>
  );
}

function ReadOnlyKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-mono text-xs font-bold text-sapphire-soft">{value}</span>
    </div>
  );
}

function ActivityFeed({ state }: { state: BotState }) {
  if (state.events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No bot activity yet — the next cycle will populate this feed.
      </p>
    );
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
          <span className="font-mono text-[10px] text-slate-600">{new Date(e.createdAt).toLocaleTimeString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}
