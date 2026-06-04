import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit";
import { WalletManager } from "@/lib/execution/wallet-manager";
import { OrderManager } from "@/lib/execution/order-manager";
import { getMarketSnapshot } from "@/services/market-service";
import { getCachedEdgeSignals, getEdgeSignals, MIN_SAMPLES, type EdgeSignal } from "@/services/ai/quant-edge.service";
import { assessCandidates } from "@/services/ai/trade-advisor.service";
import {
  computeAutoTunedGates,
  type AutoTunedGates
} from "@/services/ai/bot-auto-config";
import { DASHBOARD_SYMBOLS } from "@/lib/constants";
import { getSector } from "@/lib/sector-map";
import type {
  BotCandidate,
  BotConfig,
  BotEventDto,
  BotGuardrail,
  BotKpis,
  BotPosition,
  BotRunResult,
  BotState,
  BotTradeMode
} from "@/types/bot";

const BOT_STRATEGY = "BOT_QUANT_EDGE";
// Shorter default cooldown (5 min, was 10) so the bot can re-enter a stock
// soon after a profitable exit — the user wants continuous redeployment as
// the AI calls it. Still keeps thrashing at bay on choppy candidates.
const COOLDOWN_MINUTES = Math.max(1, Number(process.env.BOT_COOLDOWN_MINUTES || "5"));
const MAX_HOLD_DAYS = 8; // time-stop, matches the backtest horizon

// Minimum AI conviction (0-100) for a quant-approved candidate to be traded.
// Lowered from 45 → 30 so the bot can build a diversified portfolio (many
// positions) instead of waiting for high-conviction concentrated bets. AI
// still filters out the obvious rejects (conviction < 30 = "strong skip").
const AI_MIN_CONVICTION = (() => {
  const n = Number(process.env.BOT_AI_MIN_CONVICTION);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 30;
})();

// Runtime stop controls: lets /api/bot/kill immediately halt an in-flight
// cycle and abort the active AI advisory HTTP call.
const activeCycleControllers = new Map<string, AbortController>();
const stopRequestedAt = new Map<string, number>();

export function requestBotStop(userId: string) {
  const now = Date.now();
  stopRequestedAt.set(userId, now);
  const controller = activeCycleControllers.get(userId);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
}

function hasStopRequestAfter(userId: string, startedAt: number) {
  return (stopRequestedAt.get(userId) ?? 0) >= startedAt;
}

async function isBotStillEnabled(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { autoTradeEnabled: true }
  });
  return row?.autoTradeEnabled === true;
}

/**
 * Paper-only lock. Default ON — flip BOT_FORCE_PAPER_MODE=false in .env once
 * you're ready to actually wire LIVE broker execution. While the lock is on,
 * the cycle treats every user as PAPER regardless of their stored botTradeMode,
 * and /api/bot/config silently coerces LIVE patches back to PAPER. Surfaced
 * to the UI via /api/bot/config so the LIVE toggle can disappear from view.
 */
export function isLiveModeLocked(): boolean {
  return (process.env.BOT_FORCE_PAPER_MODE ?? "true").toLowerCase() !== "false";
}

type UserBotRow = {
  id: string;
  email: string;
  balance: Prisma.Decimal;
  autoTradeEnabled: boolean;
  botTradeMode: string;
  maxAutoTradeAmount: Prisma.Decimal; // repurposed: total wallet deployment cap
  botTrailStartPct: number;
  botTrailDistancePct: number;
  botMaxSectorExposurePct: number;
  botEntryWindowStart: string | null;
  botEntryWindowEnd: string | null;
  botLastRunAt: Date | null;
};

const userBotSelect = {
  id: true,
  email: true,
  balance: true,
  autoTradeEnabled: true,
  botTradeMode: true,
  maxAutoTradeAmount: true,
  botTrailStartPct: true,
  botTrailDistancePct: true,
  botMaxSectorExposurePct: true,
  botEntryWindowStart: true,
  botEntryWindowEnd: true,
  botLastRunAt: true
} as const;

/**
 * Per-user, per-cycle gates. The user controls only the total wallet cap +
 * on/off + mode + trailing-SL/sector/entry-window; everything else
 * (min edge%, min score, Kelly cap, risk%, max positions, daily loss) is
 * derived here from their equity + cap.
 */
function gatesFor(user: UserBotRow): AutoTunedGates {
  return computeAutoTunedGates({
    equity: Number(user.balance),
    maxDeployedCapital: Number(user.maxAutoTradeAmount)
  });
}

/** Honors the global PAPER lock so callers don't have to know about it. */
function effectiveMode(user: UserBotRow): "PAPER" | "LIVE" {
  if (isLiveModeLocked()) return "PAPER";
  return user.botTradeMode === "LIVE" ? "LIVE" : "PAPER";
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Returns the current Kolkata wall-clock as { weekday, minutes-since-midnight }. */
function istClock() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    weekday: part("weekday"),
    minutes: Number(part("hour")) * 60 + Number(part("minute"))
  };
}

function isMarketOpenNow() {
  if (process.env.BOT_IGNORE_MARKET_HOURS === "true") return true;
  const { weekday, minutes } = istClock();
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 25;
}

/** Parse "HH:MM" → minutes since midnight; null/invalid → null. */
function parseHHMM(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Is the user-configured entry window open right now? Either bound null/invalid
 * = no restriction. Always true if entry-window enforcement is disabled by
 * env (BOT_IGNORE_MARKET_HOURS=true short-circuits both market hours and the
 * user window so paper-mode tests can fire any time).
 */
function isEntryWindowOpen(user: UserBotRow): boolean {
  if (process.env.BOT_IGNORE_MARKET_HOURS === "true") return true;
  const start = parseHHMM(user.botEntryWindowStart);
  const end = parseHHMM(user.botEntryWindowEnd);
  if (start === null || end === null || end <= start) return true; // no window set
  const { minutes } = istClock();
  return minutes >= start && minutes <= end;
}

function toConfig(user: UserBotRow): BotConfig {
  const gates = gatesFor(user);
  return {
    autoTradeEnabled: user.autoTradeEnabled,
    botTradeMode: effectiveMode(user) as BotTradeMode,
    maxDeployedCapital: Number(user.maxAutoTradeAmount),
    // Auto-tuned at runtime from equity + cap; UI surfaces them read-only.
    botMaxOpenPositions: gates.botMaxOpenPositions,
    botMaxDailyLoss: gates.botMaxDailyLoss,
    botMinEdgePct: gates.botMinEdgePct,
    botRiskPctPerTrade: gates.botRiskPctPerTrade,
    botKellyCap: gates.botKellyCap,
    botMinCompositeScore: gates.botMinCompositeScore,
    // User-controlled new features
    botTrailStartPct: user.botTrailStartPct,
    botTrailDistancePct: user.botTrailDistancePct,
    botMaxSectorExposurePct: user.botMaxSectorExposurePct,
    botEntryWindowStart: user.botEntryWindowStart,
    botEntryWindowEnd: user.botEntryWindowEnd,
    liveModeLocked: isLiveModeLocked()
  };
}

function normalizeSnapshotSymbol(symbol: string) {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  return trimmed.includes(":") ? trimmed : `NSE:${trimmed.toUpperCase()}`;
}

async function priceMap(extraSymbols: string[] = []): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const selectedSymbols = Array.from(
    new Set([
      ...DASHBOARD_SYMBOLS,
      ...extraSymbols
        .map(normalizeSnapshotSymbol)
        .filter((value): value is string => Boolean(value))
    ])
  );
  try {
    const snapshot = await getMarketSnapshot(selectedSymbols);
    for (const tick of snapshot.ticks) {
      if (tick.price > 0) map.set(tick.symbol, tick.price);
    }
  } catch (error) {
    logger.warn(`[AutoTrader] Dhan price snapshot failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
  return map;
}

type OrderMeta = {
  bot?: boolean;
  mode?: string;
  edgePct?: number;
  kelly?: number;
  stopPrice?: number;
  targetPrice?: number;
  // Trailing-SL bookkeeping. `peakPrice` is the highest live price seen
  // since entry (only set once the trade clears trailStartPct in profit);
  // `trailingStop` is the ratcheted-up stop that replaces stopPrice while
  // trailing is active. Both reset on close.
  peakPrice?: number;
  trailingStop?: number;
  closed?: boolean;
  exitPrice?: number;
  exitReason?: string;
  closedAt?: string;
};

function readMeta(value: Prisma.JsonValue | null): OrderMeta {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as OrderMeta;
  }
  return {};
}

async function openBotOrders(userId: string) {
  const orders = await prisma.order.findMany({
    where: { userId, direction: "BUY", status: "FILLED", strategy: { startsWith: "BOT" } },
    orderBy: { createdAt: "desc" }
  });
  return orders.filter((order) => {
    const meta = readMeta(order.metadata);
    return meta.bot === true && meta.closed !== true;
  });
}

async function logEvent(
  userId: string,
  level: BotEventDto["level"],
  message: string,
  symbol?: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.botEvent.create({
      data: { userId, level, message, symbol: symbol ?? null, metadata: metadata as Prisma.InputJsonValue }
    });
  } catch (error) {
    logger.error(`[AutoTrader] failed to persist event: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function recentEvents(userId: string): Promise<BotEventDto[]> {
  const rows = await prisma.botEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 40
  });
  return rows.map((row) => ({
    id: row.id,
    level: row.level as BotEventDto["level"],
    symbol: row.symbol,
    message: row.message,
    createdAt: row.createdAt.toISOString()
  }));
}

/* ------------------------------------------------------------------ */
/*  Execution helpers                                                  */
/* ------------------------------------------------------------------ */

async function openPosition(
  user: UserBotRow,
  sig: EdgeSignal,
  quantity: number,
  price: number,
  request?: unknown
) {
  // effectiveMode() respects the global BOT_FORCE_PAPER_MODE lock.
  const mode = effectiveMode(user).toLowerCase() as "paper" | "live";
  const meta = {
    bot: true,
    mode,
    edgePct: sig.edgePct,
    kelly: sig.kelly,
    stopPrice: sig.stopPrice,
    targetPrice: sig.targetPrice
  } as Prisma.InputJsonValue;

  if (mode === "live") {
    await OrderManager.executeOrder(
      user.id,
      { symbol: sig.symbol, direction: "BUY", quantity, orderType: "MARKET", price, strategy: BOT_STRATEGY },
      request
    );
    const created = await prisma.order.findFirst({
      where: { userId: user.id, symbol: sig.symbol, direction: "BUY", strategy: BOT_STRATEGY },
      orderBy: { createdAt: "desc" }
    });
    if (created) {
      await prisma.order.update({ where: { id: created.id }, data: { metadata: meta } });
    }
    return;
  }

  await WalletManager.processTrade(user.id, "BUY", price * quantity, sig.symbol, quantity, price);
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      symbol: sig.symbol,
      direction: "BUY",
      quantity,
      orderType: "MARKET",
      status: "FILLED",
      brokerOrderId: `BOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      entryPrice: price,
      strategy: BOT_STRATEGY,
      metadata: meta
    }
  });
  await writeAuditLog({
    userId: user.id,
    actorEmail: user.email,
    action: "bot.entry",
    entity: "Order",
    entityId: order.id,
    metadata: { symbol: sig.symbol, quantity, price, edgePct: sig.edgePct, kelly: sig.kelly, mode }
  });
}

async function closePosition(
  user: UserBotRow,
  position: { id: string; symbol: string; quantity: number; entryPrice: number },
  exitPrice: number,
  reason: string
) {
  const pnl = Number(((exitPrice - position.entryPrice) * position.quantity).toFixed(2));
  const mode = effectiveMode(user).toLowerCase() as "paper" | "live";

  try {
    if (mode === "live") {
      await OrderManager.executeOrder(user.id, {
        symbol: position.symbol,
        direction: "SELL",
        quantity: position.quantity,
        orderType: "MARKET",
        price: exitPrice,
        strategy: BOT_STRATEGY
      });
    } else {
      await WalletManager.processTrade(
        user.id,
        "SELL",
        exitPrice * position.quantity,
        position.symbol,
        position.quantity,
        exitPrice
      );
    }
  } catch (error) {
    await logEvent(
      user.id,
      "ERROR",
      `Exit failed for ${position.symbol}: ${error instanceof Error ? error.message : "unknown"}`,
      position.symbol
    );
    return null;
  }

  const buyOrder = await prisma.order.findUnique({ where: { id: position.id } });
  const prevMeta = readMeta(buyOrder?.metadata ?? null);
  await prisma.order.update({
    where: { id: position.id },
    data: {
      exitPrice,
      pnl,
      metadata: {
        ...prevMeta,
        closed: true,
        exitPrice,
        exitReason: reason,
        closedAt: new Date().toISOString()
      } as Prisma.InputJsonValue
    }
  });

  await writeAuditLog({
    userId: user.id,
    actorEmail: user.email,
    action: "bot.exit",
    entity: "Order",
    entityId: position.id,
    metadata: { symbol: position.symbol, exitPrice, pnl, reason, mode }
  });

  return pnl;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function runBotCycle(userId: string, request?: unknown): Promise<BotRunResult> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: userBotSelect
  })) as UserBotRow | null;

  if (!user) return { ran: false, reason: "User not found", entries: 0, exits: 0, events: [] };
  if (!user.autoTradeEnabled) return { ran: false, reason: "Bot is paused", entries: 0, exits: 0, events: [] };

  const cycleStartedAt = Date.now();
  const cycleAbort = new AbortController();
  activeCycleControllers.set(userId, cycleAbort);

  let lastEnabledCheckAt = 0;
  let cachedEnabled = true;
  const shouldStop = async (forceCheck = false) => {
    if (cycleAbort.signal.aborted) return true;
    if (hasStopRequestAfter(userId, cycleStartedAt)) return true;

    const now = Date.now();
    if (forceCheck || now - lastEnabledCheckAt > 1_500) {
      cachedEnabled = await isBotStillEnabled(userId);
      lastEnabledCheckAt = now;
    }
    return !cachedEnabled;
  };

  try {
    await prisma.user.update({ where: { id: userId }, data: { botLastRunAt: new Date() } });

    if (await shouldStop(true)) {
      return { ran: false, reason: "Bot stop requested", entries: 0, exits: 0, events: await recentEvents(userId) };
    }

    const gates = gatesFor(user);
    let entries = 0;
    let exits = 0;

    // Fast path: resolve exit dependencies first; edge/AI work only runs
    // when new entries are actually allowed this cycle.
    const open = await openBotOrders(userId);
    const prices = await priceMap(open.map((order) => order.symbol));

    // 1) Manage exits.
    const trailStartPct = user.botTrailStartPct;
    const trailDistancePct = user.botTrailDistancePct;
    const trailingActive = trailStartPct > 0 && trailDistancePct > 0;

    for (const order of open) {
      const meta = readMeta(order.metadata);
      const entry = Number(order.entryPrice ?? 0);
      if (entry <= 0) continue;
      const current = prices.get(order.symbol) ?? entry;

      const originalStop = meta.stopPrice ?? entry * 0.97;
      const target = meta.targetPrice ?? entry * 1.06;
      const ageDays = (Date.now() - order.createdAt.getTime()) / 86_400_000;

      let effectiveStop = meta.trailingStop ?? originalStop;
      let newPeak = meta.peakPrice;
      if (trailingActive) {
        const gainPct = ((current - entry) / entry) * 100;
        if (gainPct >= trailStartPct) {
          const candidatePeak = Math.max(meta.peakPrice ?? entry, current);
          newPeak = candidatePeak;
          const trailedStop = candidatePeak * (1 - trailDistancePct / 100);
          if (trailedStop > effectiveStop) effectiveStop = trailedStop;
        }
      }

      if (newPeak !== undefined && (newPeak !== meta.peakPrice || effectiveStop !== meta.trailingStop)) {
        try {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              metadata: {
                ...meta,
                peakPrice: newPeak,
                trailingStop: effectiveStop
              } as Prisma.InputJsonValue
            }
          });
        } catch (error) {
          logger.warn(
            `[AutoTrader] failed to persist trailing state for ${order.symbol}: ${
              error instanceof Error ? error.message : "unknown"
            }`
          );
        }
      }

      let reason: string | null = null;
      let label = "";
      if (current <= effectiveStop) {
        const trailingActiveOnThisTrade = effectiveStop > originalStop;
        reason = trailingActiveOnThisTrade ? "TRAILING_STOP" : "STOP_LOSS";
        label = trailingActiveOnThisTrade ? "Trailing stop" : "ATR stop";
      } else if (current >= target) {
        reason = "TAKE_PROFIT";
        label = "ATR target";
      } else if (ageDays >= MAX_HOLD_DAYS) {
        reason = "TIME_STOP";
        label = "Time-stop";
      }
      if (!reason) continue;

      const pnl = await closePosition(
        user,
        { id: order.id, symbol: order.symbol, quantity: order.quantity, entryPrice: entry },
        current,
        reason
      );
      if (pnl !== null) {
        exits += 1;
        await logEvent(
          userId,
          "TRADE",
          `${label} - exited ${order.quantity} ${order.symbol} @ Rs ${current.toFixed(2)} (P&L Rs ${pnl.toFixed(2)})`,
          order.symbol,
          { reason, pnl }
        );
      }
    }

    // 2) Risk guardrails.
    const todayStart = startOfToday();
    const [closedToday, stillOpen] = await Promise.all([
      prisma.order.findMany({
        where: { userId, strategy: { startsWith: "BOT" }, updatedAt: { gte: todayStart } }
      }),
      openBotOrders(userId)
    ]);

    const realizedLoss = closedToday
      .map((o) => Number(o.pnl ?? 0))
      .filter((p) => p < 0)
      .reduce((acc, p) => acc + Math.abs(p), 0);

    if (realizedLoss >= gates.botMaxDailyLoss) {
      await logEvent(
        userId,
        "RISK",
        `Daily loss budget exhausted (Rs ${realizedLoss.toFixed(2)} / Rs ${gates.botMaxDailyLoss.toFixed(2)}). Halting new entries.`
      );
      return { ran: true, reason: "Daily loss limit", entries, exits, events: await recentEvents(userId) };
    }

    if (stillOpen.length >= gates.botMaxOpenPositions) {
      return { ran: true, reason: "Max open positions", entries, exits, events: await recentEvents(userId) };
    }

    if (effectiveMode(user) === "LIVE" && !isMarketOpenNow()) {
      await logEvent(userId, "INFO", "Market is closed - skipping new entries.");
      return { ran: true, reason: "Market closed", entries, exits, events: await recentEvents(userId) };
    }

    if (!isEntryWindowOpen(user)) {
      await logEvent(
        userId,
        "INFO",
        `Outside entry window ${user.botEntryWindowStart}-${user.botEntryWindowEnd} IST - skipping new entries.`
      );
      return { ran: true, reason: "Outside entry window", entries, exits, events: await recentEvents(userId) };
    }

    if (await shouldStop(true)) {
      await logEvent(userId, "INFO", "Bot stop received - skipping edge scan and advisory.");
      return { ran: false, reason: "Bot stop requested", entries, exits, events: await recentEvents(userId) };
    }

    // 3) Edge + AI entry pipeline.
    const edges = await getEdgeSignals();
    if (edges.length === 0) {
      await logEvent(
        userId,
        "ERROR",
        "No edge signals returned - historical data unavailable or all symbols failed."
      );
      return { ran: true, reason: "No edge signals", entries, exits, events: await recentEvents(userId) };
    }

    const heldSymbols = new Set(stillOpen.map((o) => o.symbol));
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60_000);
    let balance = Number(user.balance);
    const equity = balance;
    const maxDeployedCapital = Number(user.maxAutoTradeAmount);
    let deployedExposure = stillOpen.reduce((acc, o) => acc + Number(o.entryPrice ?? 0) * o.quantity, 0);

    const sectorExposure = new Map<string, number>();
    for (const o of stillOpen) {
      const sector = getSector(o.symbol);
      sectorExposure.set(sector, (sectorExposure.get(sector) ?? 0) + Number(o.entryPrice ?? 0) * o.quantity);
    }
    const sectorCapFrac = user.botMaxSectorExposurePct;
    const sectorCapEnabled = sectorCapFrac > 0 && sectorCapFrac < 1;
    const sectorMaxRupees = sectorCapEnabled ? maxDeployedCapital * sectorCapFrac : Infinity;

    type EntryPlan = {
      sig: EdgeSignal;
      price: number;
      kellyFrac: number;
    };

    const quantApproved: EntryPlan[] = [];
    const recentCooldownSymbols = new Set(
      (
        await prisma.order.findMany({
          where: { userId, strategy: { startsWith: "BOT" }, createdAt: { gte: cooldownCutoff } },
          select: { symbol: true }
        })
      ).map((row) => row.symbol)
    );

    for (const sig of edges) {
      if (!sig.inSetup) continue;
      if (sig.sampleSize < MIN_SAMPLES) continue;
      if (sig.kelly <= 0 || sig.payoff <= 0) continue;
      if (sig.compositeScore < gates.botMinCompositeScore) continue;
      if (heldSymbols.has(sig.symbol)) continue;
      if (recentCooldownSymbols.has(sig.symbol)) continue;

      const price = prices.get(sig.symbol) ?? sig.price;
      if (!price || price <= 0) continue;

      const stop = sig.stopPrice > 0 && sig.stopPrice < price ? sig.stopPrice : price * 0.97;
      const riskPerShare = price - stop;
      if (riskPerShare <= 0) continue;

      quantApproved.push({
        sig: { ...sig, stopPrice: stop },
        price,
        kellyFrac: Math.min(sig.kelly, gates.botKellyCap)
      });
    }

    let plans = quantApproved;
    const convictionBySymbol = new Map<string, number>();

    if (quantApproved.length > 0 && !(await shouldStop(true))) {
      const advisory = await assessCandidates(
        quantApproved.map((p) => p.sig),
        { equity, openPositions: stillOpen.length, maxPositions: gates.botMaxOpenPositions },
        { signal: cycleAbort.signal }
      );

      if (await shouldStop(true)) {
        await logEvent(userId, "INFO", "Bot stop received while advisory was running - aborting entries.");
        return { ran: false, reason: "Bot stop requested", entries, exits, events: await recentEvents(userId) };
      }

      if (advisory) {
        const confirmed: { plan: EntryPlan; conviction: number }[] = [];
        for (const plan of quantApproved) {
          const verdict = advisory.assessments.get(plan.sig.symbol.toUpperCase());
          if (verdict && verdict.verdict === "TRADE" && verdict.conviction >= AI_MIN_CONVICTION) {
            confirmed.push({ plan, conviction: verdict.conviction });
            convictionBySymbol.set(plan.sig.symbol, verdict.conviction);
          } else {
            await logEvent(
              userId,
              "INFO",
              `AI advisor skipped ${plan.sig.symbol} - conviction ${verdict?.conviction ?? 0}/100${verdict?.reason ? `: ${verdict.reason}` : ""}`,
              plan.sig.symbol
            );
          }
        }
        confirmed.sort((a, b) => b.conviction - a.conviction);
        plans = confirmed.map((c) => c.plan);
        if (confirmed.length > 0) {
          await logEvent(
            userId,
            "INFO",
            `AI advisor (${advisory.provider}) confirmed ${confirmed.length}/${quantApproved.length} candidate${quantApproved.length !== 1 ? "s" : ""}`
          );
        }
      } else {
        await logEvent(userId, "INFO", "AI advisor unavailable - proceeding on quant signal alone.");
      }
    }

    let slotsLeft = gates.botMaxOpenPositions - stillOpen.length;
    for (const plan of plans) {
      if (slotsLeft <= 0) break;

      if (await shouldStop()) {
        await logEvent(userId, "INFO", "Bot stop received - halting remaining entries.");
        break;
      }

      const symbolSector = getSector(plan.sig.symbol);
      const capHeadroom = maxDeployedCapital - deployedExposure;
      if (capHeadroom <= 0) {
        await logEvent(
          userId,
          "INFO",
          `Wallet cap reached (Rs ${deployedExposure.toFixed(0)} / Rs ${maxDeployedCapital.toFixed(0)}) - pausing new entries.`
        );
        break;
      }

      let sectorHeadroom = Infinity;
      if (sectorCapEnabled) {
        const currentSector = sectorExposure.get(symbolSector) ?? 0;
        sectorHeadroom = sectorMaxRupees - currentSector;
        if (sectorHeadroom <= 0) {
          await logEvent(
            userId,
            "INFO",
            `Sector cap reached for ${symbolSector} (${(sectorCapFrac * 100).toFixed(0)}% of Rs ${maxDeployedCapital.toFixed(0)}) - skipping ${plan.sig.symbol}.`,
            plan.sig.symbol
          );
          continue;
        }
      }

      const composite = Math.max(0, Math.min(1, plan.sig.compositeScore / 100));
      const convictionRaw = convictionBySymbol.get(plan.sig.symbol);
      const quality =
        convictionRaw !== undefined
          ? composite * Math.max(0, Math.min(1, convictionRaw / 100))
          : composite;
      const sizingFactor = Math.sqrt(Math.max(0, quality));
      const evenSplit = capHeadroom / Math.max(1, slotsLeft);
      const targetStake = evenSplit * sizingFactor;

      const riskBudget = (equity * gates.botRiskPctPerTrade) / 100;
      const riskPerShare = Math.max(0.01, plan.price - plan.sig.stopPrice);
      const qtyByRisk = Math.floor(riskBudget / riskPerShare);

      const stakeCeiling = Math.min(targetStake, capHeadroom, sectorHeadroom);
      const qtyByBudget = Math.floor(stakeCeiling / plan.price);
      const qtyByCash = Math.floor(balance / plan.price);
      const quantity = Math.min(qtyByBudget, qtyByRisk, qtyByCash);
      if (quantity < 1) continue;

      try {
        await openPosition(user, plan.sig, quantity, plan.price, request);
        entries += 1;
        slotsLeft -= 1;
        const stake = quantity * plan.price;
        balance -= stake;
        deployedExposure += stake;
        sectorExposure.set(symbolSector, (sectorExposure.get(symbolSector) ?? 0) + stake);
        heldSymbols.add(plan.sig.symbol);

        const conviction = convictionBySymbol.get(plan.sig.symbol);
        await logEvent(
          userId,
          "TRADE",
          `${effectiveMode(user)} BUY ${quantity} ${plan.sig.symbol} @ Rs ${plan.price.toFixed(2)} | Rs ${stake.toFixed(0)} stake | score ${plan.sig.compositeScore}/100 | edge ${plan.sig.edgePct.toFixed(2)}% | win ${plan.sig.winProb.toFixed(0)}% | ${plan.sig.payoff}R | Kelly ${(plan.kellyFrac * 100).toFixed(1)}%${conviction !== undefined ? ` | AI ${conviction}/100` : ""}`,
          plan.sig.symbol,
          {
            edgePct: plan.sig.edgePct,
            winProb: plan.sig.winProb,
            payoff: plan.sig.payoff,
            compositeScore: plan.sig.compositeScore,
            scoreParts: plan.sig.scoreParts,
            quantity,
            stake,
            targetStake,
            stakeCeiling,
            deployedAfter: deployedExposure,
            sector: symbolSector,
            price: plan.price,
            stop: plan.sig.stopPrice,
            conviction: conviction ?? null
          }
        );
      } catch (error) {
        await logEvent(
          userId,
          "ERROR",
          `Entry failed for ${plan.sig.symbol}: ${error instanceof Error ? error.message : "unknown"}`,
          plan.sig.symbol
        );
      }
    }

    if (entries === 0) {
      const inSetupCount = edges.filter((s) => s.inSetup).length;
      await logEvent(
        userId,
        "INFO",
        `Cycle: ${edges.length} stocks | ${inSetupCount} in uptrend | ${quantApproved.length} passed quant gates | 0 entries${exits > 0 ? ` | ${exits} exit${exits !== 1 ? "s" : ""}` : ""}`
      );
    }

    return { ran: true, entries, exits, events: await recentEvents(userId) };
  } finally {
    if (activeCycleControllers.get(userId) === cycleAbort) {
      activeCycleControllers.delete(userId);
    }
  }
}

export async function getBotState(
  userId: string,
  options: { includeCandidates?: boolean | "cache" } = {}
): Promise<BotState> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: userBotSelect
  })) as UserBotRow | null;

  if (!user) throw new Error("User not found");

  const config = toConfig(user);
  // Same gates the cycle loop uses — single source of truth.
  const gates = gatesFor(user);
  const todayStart = startOfToday();

  const open = await openBotOrders(userId);
  const prices = await priceMap(open.map((order) => order.symbol));
  const positions: BotPosition[] = open.map((order) => {
    const meta = readMeta(order.metadata);
    const entry = Number(order.entryPrice ?? 0);
    const current = prices.get(order.symbol) ?? entry;
    const pnl = Number(((current - entry) * order.quantity).toFixed(2));
    return {
      orderId: order.id,
      symbol: order.symbol,
      quantity: order.quantity,
      entryPrice: entry,
      currentPrice: current,
      pnl,
      pnlPct: entry > 0 ? Number((((current - entry) / entry) * 100).toFixed(2)) : 0,
      stopLoss: meta.stopPrice ?? Number((entry * 0.97).toFixed(2)),
      takeProfit: meta.targetPrice ?? Number((entry * 1.06).toFixed(2)),
      openedAt: order.createdAt.toISOString()
    };
  });

  const closedToday = await prisma.order.findMany({
    where: { userId, strategy: { startsWith: "BOT" }, updatedAt: { gte: todayStart } }
  });
  const realizedClosed = closedToday.filter((o) => readMeta(o.metadata).closed === true);
  const realizedPnlToday = realizedClosed.reduce((acc, o) => acc + Number(o.pnl ?? 0), 0);
  const wins = realizedClosed.filter((o) => Number(o.pnl ?? 0) > 0).length;
  const winRateToday = realizedClosed.length > 0 ? Math.round((wins / realizedClosed.length) * 100) : 0;

  const tradesToday = await prisma.order.count({
    where: { userId, strategy: { startsWith: "BOT" }, createdAt: { gte: todayStart } }
  });

  const unrealizedPnl = Number(positions.reduce((acc, p) => acc + p.pnl, 0).toFixed(2));
  const openExposure = Number(positions.reduce((acc, p) => acc + p.entryPrice * p.quantity, 0).toFixed(2));
  const dailyLossUsed = Number(
    realizedClosed
      .map((o) => Number(o.pnl ?? 0))
      .filter((p) => p < 0)
      .reduce((acc, p) => acc + Math.abs(p), 0)
      .toFixed(2)
  );

  const kpis: BotKpis = {
    realizedPnlToday: Number(realizedPnlToday.toFixed(2)),
    unrealizedPnl,
    totalPnlToday: Number((realizedPnlToday + unrealizedPnl).toFixed(2)),
    tradesToday,
    winRateToday,
    openPositionsCount: positions.length,
    openExposure,
    dailyLossBudget: gates.botMaxDailyLoss,
    dailyLossUsed,
    balance: Number(user.balance)
  };

  let candidates: BotCandidate[] = [];
  if (options.includeCandidates !== false) {
    try {
      const edges = options.includeCandidates === "cache"
        ? (await getCachedEdgeSignals({ warmIfMissing: true })) ?? []
        : await getEdgeSignals();
      const held = new Set(open.map((o) => o.symbol));
      candidates = edges.slice(0, 12).map((s) => {
        let eligible = true;
        let reason = "Tradable edge";
        if (!s.inSetup) {
          eligible = false;
          reason = s.trendUp ? "Waiting for pullback" : "No uptrend";
        } else if (s.sampleSize < MIN_SAMPLES) {
          eligible = false;
          reason = `Thin sample (${s.sampleSize})`;
        } else if (s.compositeScore < gates.botMinCompositeScore) {
          eligible = false;
          reason = `Score ${s.compositeScore} < gate ${gates.botMinCompositeScore}`;
        } else if (s.kelly <= 0) {
          eligible = false;
          reason = "No positive Kelly";
        } else if (held.has(s.symbol)) {
          eligible = false;
          reason = "Already holding";
        } else if (positions.length >= gates.botMaxOpenPositions) {
          eligible = false;
          reason = "Max positions reached";
        }
        return {
          symbol: s.symbol,
          sector: getSector(s.symbol),
          price: s.price,
          inSetup: s.inSetup,
          edgePct: s.edgePct,
          winProb: s.winProb,
          payoff: s.payoff,
          kelly: Number(Math.min(s.kelly, gates.botKellyCap).toFixed(4)),
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
          eligible,
          reason,
          reasons: s.reasons
        };
      });
    } catch (error) {
      logger.error(`[AutoTrader] edge build failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  const maxDeployedCapital = Number(user.maxAutoTradeAmount);
  const guardrails: BotGuardrail[] = [
    {
      key: "engine",
      label: "Engine",
      ok: user.autoTradeEnabled,
      detail: user.autoTradeEnabled ? "Auto-trading active" : "Paused"
    },
    {
      key: "wallet_cap",
      label: "Wallet cap",
      ok: openExposure < maxDeployedCapital,
      detail: `₹${openExposure.toFixed(0)} / ₹${maxDeployedCapital.toFixed(0)} deployed`
    },
    {
      key: "daily_loss",
      label: "Daily loss",
      ok: dailyLossUsed < gates.botMaxDailyLoss,
      detail: `₹${dailyLossUsed.toFixed(0)} / ₹${gates.botMaxDailyLoss.toFixed(0)}`
    },
    {
      key: "positions",
      label: "Slots",
      ok: positions.length < gates.botMaxOpenPositions,
      detail: `${positions.length} / ${gates.botMaxOpenPositions} open`
    },
    {
      key: "entry_window",
      label: "Entry window",
      ok: isEntryWindowOpen(user),
      detail:
        user.botEntryWindowStart && user.botEntryWindowEnd
          ? `${user.botEntryWindowStart}–${user.botEntryWindowEnd} IST`
          : "All hours"
    }
  ];

  return {
    config,
    status: user.autoTradeEnabled ? "ACTIVE" : "PAUSED",
    kpis,
    guardrails,
    positions,
    candidates,
    events: await recentEvents(userId),
    lastRunAt: user.botLastRunAt ? user.botLastRunAt.toISOString() : null
  };
}

export async function flattenBotPositions(userId: string): Promise<number> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: userBotSelect
  })) as UserBotRow | null;
  if (!user) return 0;

  const open = await openBotOrders(userId);
  const prices = await priceMap(open.map((order) => order.symbol));
  let closed = 0;
  for (const order of open) {
    const entry = Number(order.entryPrice ?? 0);
    const current = prices.get(order.symbol) ?? entry;
    const pnl = await closePosition(
      user,
      { id: order.id, symbol: order.symbol, quantity: order.quantity, entryPrice: entry },
      current,
      "KILL_SWITCH"
    );
    if (pnl !== null) {
      closed += 1;
      await logEvent(
        userId,
        "RISK",
        `🚨 Kill-switch flattened ${order.quantity} ${order.symbol} @ ₹${current.toFixed(2)} (P&L ₹${pnl.toFixed(2)})`,
        order.symbol
      );
    }
  }
  return closed;
}

export async function runEnabledBotCycles(): Promise<{
  users: number;
  ran: number;
  entries: number;
  exits: number;
  errors: Array<{ userId: string; message: string }>;
}> {
  const users = await prisma.user.findMany({
    where: { autoTradeEnabled: true },
    select: { id: true }
  });

  let ran = 0;
  let entries = 0;
  let exits = 0;
  const errors: Array<{ userId: string; message: string }> = [];
  const concurrency = Math.max(1, Number(process.env.BOT_CRON_CONCURRENCY || "3"));
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, users.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= users.length) return;

        const user = users[index];
        try {
          const result = await runBotCycle(user.id);
          if (result.ran) ran += 1;
          entries += result.entries;
          exits += result.exits;
        } catch (error) {
          errors.push({ userId: user.id, message: error instanceof Error ? error.message : "unknown" });
        }
      }
    })
  );

  return { users: users.length, ran, entries, exits, errors };
}


