"use client";

/**
 * useLiveMarket — shared real-time market data hook.
 *
 * Data path (new architecture):
 *   Dhan WS → server (dhanMarketFeed) → SSE batch event every 250 ms
 *   → one startTransition setState per batch (not per tick)
 *
 * Key optimisations vs the old per-tick approach:
 *  • ONE shared EventSource across ALL hook consumers (module-level singleton).
 *  • SSE stream now emits `batch` events (JSON arrays) not individual `tick`
 *    events, reducing HTTP overhead from 900+/s to 4/s.
 *  • `applyDhanBatch` processes the entire array in a single setState call
 *    wrapped in startTransition so React de-prioritises tick renders vs user
 *    interactions (clicks, scrolling, input).
 *  • `processPacket` is a pure function (no side effects except prevClose map)
 *    so the batch loop is predictable and avoids nested setStates.
 *  • Polling fallback continues unchanged for environments without Dhan WS.
 */

import { useEffect, useMemo, useState, startTransition, useSyncExternalStore } from "react";
import type { MarketConnectionStatus, MarketTick } from "@/types/market";
import type { NormalizedTick } from "@/services/market-data/market-data.types";
import type { FeaturedSignal } from "@/types/platform";
import { DHAN_DASHBOARD_INSTRUMENTS, DHAN_SYMBOL_BY_SECURITY_ID } from "@/lib/dhan-symbols";

// Pre-computed subscribe lists — indices use requestCode 15 (index/ticker stream);
// all other segments use requestCode 17 (quote mode with OHLCV).
const AUTO_SUBSCRIBE_INDICES = DHAN_DASHBOARD_INSTRUMENTS.filter((i) => i.segment === "INDEX").map(
  (i) => ({ ExchangeSegment: i.ExchangeSegment, SecurityId: i.SecurityId })
);
const AUTO_SUBSCRIBE_EQUITIES = DHAN_DASHBOARD_INSTRUMENTS.filter((i) => i.segment !== "INDEX").map(
  (i) => ({ ExchangeSegment: i.ExchangeSegment, SecurityId: i.SecurityId })
);

type LiveAlert = {
  type: string;
  severity?: string;
  risk_level?: string;
  trigger?: string;
  message?: string;
  suggestion?: string;
  action?: string;
  timestamp?: string;
};

// ─── Module-level shared SSE singleton ────────────────────────────────────────
// One EventSource serves every mounted useLiveMarket consumer simultaneously.

let dhanConnectInitialized = false;
let dhanSharedSource: EventSource | null = null;
let liveConsumerCount = 0;
let lastSharedLiveAt = 0;
const prevCloseBySecurity = new Map<string, number>();

const POLLING_INTERVAL_MS = 2000;

type PollSnapshot = {
  ticks: NormalizedTick[];
  error: string | null;
};

type MarketTickPatch = Partial<MarketTick> & Pick<MarketTick, "symbol" | "name">;

type SharedPoller = {
  subscribers: Set<(snapshot: PollSnapshot) => void>;
  timer?: ReturnType<typeof setInterval>;
  inFlight: boolean;
  lastSnapshot?: PollSnapshot;
};

const sharedPollers = new Map<string, SharedPoller>();

type LiveMarketSnapshot = {
  ticks: MarketTick[];
  connectionStatus: MarketConnectionStatus;
  error: string | null;
  signal: FeaturedSignal | null;
  alerts: LiveAlert[];
};

type LiveMarketStoreState = {
  ticksByKey: Record<string, MarketTick>;
  snapshot: LiveMarketSnapshot;
};

const liveMarketListeners = new Set<() => void>();
const liveMarketStore: LiveMarketStoreState = {
  ticksByKey: {},
  snapshot: {
    ticks: [],
    connectionStatus: "connecting",
    error: null,
    signal: null,
    alerts: []
  }
};

// Stable, deterministic snapshot for SSR + first client paint.
// `liveMarketStore.snapshot` accumulates state across the lifetime of the
// process (module-level singleton), which on the server means SSR can see
// ticks from prior requests — but the freshly-evaluated client module starts
// empty. That divergence caused React to throw a hydration mismatch and
// regenerate the entire tree (visible to the user as a blank/broken page).
// Returning a constant initial snapshot from `useSyncExternalStore`'s
// `getServerSnapshot` makes server and client first render agree; React swaps
// to the live snapshot after hydration completes.
const INITIAL_SNAPSHOT: LiveMarketSnapshot = {
  ticks: [],
  connectionStatus: "connecting",
  error: null,
  signal: null,
  alerts: []
};

function getInitialLiveMarketSnapshot() {
  return INITIAL_SNAPSHOT;
}

function publishLiveMarketSnapshot() {
  liveMarketStore.snapshot = {
    ...liveMarketStore.snapshot,
    ticks: Object.values(liveMarketStore.ticksByKey)
  };
  for (const listener of liveMarketListeners) listener();
}

function publishLiveMarketMeta(patch: Partial<Omit<LiveMarketSnapshot, "ticks">>) {
  liveMarketStore.snapshot = {
    ...liveMarketStore.snapshot,
    ...patch
  };
  for (const listener of liveMarketListeners) listener();
}

function subscribeLiveMarket(listener: () => void) {
  liveMarketListeners.add(listener);
  return () => {
    liveMarketListeners.delete(listener);
  };
}

function getLiveMarketSnapshot() {
  return liveMarketStore.snapshot;
}

function ensureDhanSource() {
  if (typeof window === "undefined") return null;
  if (dhanSharedSource) return dhanSharedSource;

  dhanSharedSource = new EventSource("/api/dhan/stream");

  // ── Primary path: batch events (one per 250 ms flush) ─────────────────────
  dhanSharedSource.addEventListener("batch", (evt) => {
    try {
      const batch = JSON.parse((evt as MessageEvent).data) as unknown[];
      applyDhanBatch(batch);
    } catch {
      // ignore malformed batch
    }
  });

  // ── Legacy path: individual tick events (backward compat) ──────────────────
  dhanSharedSource.addEventListener("tick", (evt) => {
    try {
      const parsed = JSON.parse((evt as MessageEvent).data) as unknown;
      applyDhanPacket(parsed);
    } catch {
      // ignore malformed packet
    }
  });

  dhanSharedSource.onerror = () => {
    publishLiveMarketMeta({ connectionStatus: "polling" });
  };

  return dhanSharedSource;
}

function toSymbolInput(tick: Pick<MarketTick, "exchange" | "symbol">) {
  return `${tick.exchange ?? "NSE"}:${tick.symbol}`;
}

function normalizeTick(tick: NormalizedTick): MarketTick {
  return {
    exchange: tick.exchange,
    segment: tick.segment,
    symbol: tick.symbol,
    name: tick.symbol,
    price: tick.lastPrice,
    change: tick.change,
    changePercent: tick.changePercent,
    volume: tick.volume,
    high: tick.high,
    low: tick.low,
    open: tick.open,
    close: tick.close,
    direction: tick.changePercent > 0 ? "up" : tick.changePercent < 0 ? "down" : "flat",
    updatedAt: tick.timestamp,
    instrumentToken: tick.instrumentToken,
    source: tick.source,
    lastTradedQuantity: tick.lastTradedQuantity,
    averageTradedPrice: tick.averageTradedPrice,
    totalBuyQty: tick.totalBuyQty,
    totalSellQty: tick.totalSellQty,
    openInterest: tick.openInterest,
    bidPrice: tick.bidPrice,
    askPrice: tick.askPrice,
    bidQty: tick.bidQty,
    askQty: tick.askQty
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pickNumber(next: number | undefined, current: number | undefined, options: { keepCurrentOnZero?: boolean } = {}) {
  if (!isFiniteNumber(next)) return current;
  if (options.keepCurrentOnZero && next === 0 && isFiniteNumber(current) && current !== 0) {
    return current;
  }
  return next;
}

function mergeMarketTick(current: MarketTick | undefined, next: MarketTickPatch): MarketTick {
  if (!current) {
    const changePercent = pickNumber(next.changePercent, 0) ?? 0;
    return {
      name: next.name,
      symbol: next.symbol,
      exchange: next.exchange,
      segment: next.segment,
      price: pickNumber(next.price, 0) ?? 0,
      change: pickNumber(next.change, 0) ?? 0,
      changePercent,
      volume: pickNumber(next.volume, 0) ?? 0,
      high: pickNumber(next.high, next.price ?? 0) ?? 0,
      low: pickNumber(next.low, next.price ?? 0) ?? 0,
      open: next.open,
      close: next.close,
      direction: changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat",
      updatedAt: next.updatedAt ?? new Date().toISOString(),
      instrumentToken: next.instrumentToken,
      source: next.source,
      ltt: next.ltt,
      lastTradedQuantity: next.lastTradedQuantity,
      averageTradedPrice: next.averageTradedPrice,
      totalBuyQty: next.totalBuyQty,
      totalSellQty: next.totalSellQty,
      openInterest: next.openInterest,
      bidPrice: next.bidPrice,
      askPrice: next.askPrice,
      bidQty: next.bidQty,
      askQty: next.askQty
    };
  }

  const keepCurrentOnZero = next.source === "dhan:empty" || next.price === 0;
  const price = pickNumber(next.price, current.price, { keepCurrentOnZero }) ?? current.price;
  const change = pickNumber(next.change, current.change, { keepCurrentOnZero }) ?? current.change;
  const changePercent = pickNumber(next.changePercent, current.changePercent, { keepCurrentOnZero }) ?? current.changePercent;

  return {
    ...current,
    ...next,
    name: current.name ?? next.name,
    price,
    change,
    changePercent,
    volume: pickNumber(next.volume, current.volume, { keepCurrentOnZero: next.segment !== "INDEX" }) ?? current.volume,
    high: pickNumber(next.high, current.high, { keepCurrentOnZero }) ?? current.high,
    low: pickNumber(next.low, current.low, { keepCurrentOnZero }) ?? current.low,
    open: pickNumber(next.open, current.open, { keepCurrentOnZero }),
    close: pickNumber(next.close, current.close, { keepCurrentOnZero }),
    lastTradedQuantity: pickNumber(next.lastTradedQuantity, current.lastTradedQuantity),
    averageTradedPrice: pickNumber(next.averageTradedPrice, current.averageTradedPrice, { keepCurrentOnZero }),
    totalBuyQty: pickNumber(next.totalBuyQty, current.totalBuyQty, { keepCurrentOnZero: next.segment !== "INDEX" }),
    totalSellQty: pickNumber(next.totalSellQty, current.totalSellQty, { keepCurrentOnZero: next.segment !== "INDEX" }),
    openInterest: pickNumber(next.openInterest, current.openInterest),
    bidPrice: pickNumber(next.bidPrice, current.bidPrice, { keepCurrentOnZero }),
    askPrice: pickNumber(next.askPrice, current.askPrice, { keepCurrentOnZero }),
    bidQty: pickNumber(next.bidQty, current.bidQty, { keepCurrentOnZero: next.segment !== "INDEX" }),
    askQty: pickNumber(next.askQty, current.askQty, { keepCurrentOnZero: next.segment !== "INDEX" }),
    direction: changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat",
    updatedAt: next.updatedAt ?? current.updatedAt
  };
}

function processDhanPacket(packet: unknown): MarketTickPatch | null {
  if (!packet || typeof packet !== "object") return null;
  const p = packet as Record<string, unknown>;
  const type = typeof p.type === "string" ? p.type : "";
  const securityId = typeof p.securityId === "string" ? p.securityId : "";
  if (!securityId) return null;

  const serverSymbol = typeof p.symbol === "string" ? p.symbol : null;
  const serverExchange = typeof p.exchange === "string" ? p.exchange : null;
  const serverSegment = typeof p.segment === "string" ? p.segment : null;
  const mapped = serverSymbol && serverExchange && serverSegment
    ? {
        symbol: serverSymbol,
        exchange: serverExchange as "NSE" | "BSE" | "MCX",
        segment: serverSegment as "EQ" | "INDEX" | "FNO" | "COMM" | "CURRENCY",
        name: typeof p.name === "string" ? p.name : serverSymbol
      }
    : DHAN_SYMBOL_BY_SECURITY_ID[securityId]
      ? {
          symbol: DHAN_SYMBOL_BY_SECURITY_ID[securityId].symbol,
          exchange: DHAN_SYMBOL_BY_SECURITY_ID[securityId].exchange as "NSE" | "BSE" | "MCX",
          segment: DHAN_SYMBOL_BY_SECURITY_ID[securityId].segment as "EQ" | "INDEX" | "FNO" | "COMM" | "CURRENCY",
          name: DHAN_SYMBOL_BY_SECURITY_ID[securityId].symbol
        }
      : null;

  if (!mapped) return null;

  if (type === "prev_close" && typeof p.prevClose === "number") {
    prevCloseBySecurity.set(securityId, p.prevClose);
    return null;
  }

  if (type !== "index" && type !== "ticker" && type !== "quote" && type !== "full") return null;
  if (typeof p.ltp !== "number") return null;

  const prevClose = prevCloseBySecurity.get(securityId);
  const close = typeof p.close === "number" && p.close > 0 ? p.close : prevClose;
  const hasClose = typeof close === "number" && close > 0;
  const change = hasClose ? p.ltp - close : undefined;
  const changePercent = hasClose ? ((p.ltp - close) / close) * 100 : undefined;

  return {
    exchange: mapped.exchange,
    segment: mapped.segment,
    symbol: mapped.symbol,
    name: (typeof p.name === "string" ? p.name : null) ?? mapped.name ?? mapped.symbol,
    price: p.ltp,
    change,
    changePercent,
    volume: typeof p.volume === "number" ? p.volume : undefined,
    high: typeof p.high === "number" ? p.high : undefined,
    low: typeof p.low === "number" ? p.low : undefined,
    open: typeof p.open === "number" ? p.open : undefined,
    close,
    direction: changePercent && changePercent > 0 ? "up" : changePercent && changePercent < 0 ? "down" : "flat",
    updatedAt: typeof p.receivedAt === "string" ? p.receivedAt : new Date().toISOString(),
    source: "dhan-feed",
    ltt: typeof p.ltt === "string" ? p.ltt : undefined,
    lastTradedQuantity: typeof p.lastTradedQuantity === "number" ? p.lastTradedQuantity : undefined,
    averageTradedPrice: typeof p.atp === "number" ? p.atp : undefined,
    totalBuyQty: typeof p.totalBuyQty === "number" ? p.totalBuyQty : undefined,
    totalSellQty: typeof p.totalSellQty === "number" ? p.totalSellQty : undefined,
    openInterest: typeof p.openInterest === "number" ? p.openInterest : undefined,
    bidPrice: typeof p.bidPrice === "number" ? p.bidPrice : undefined,
    askPrice: typeof p.askPrice === "number" ? p.askPrice : undefined,
    bidQty: typeof p.bidQty === "number" ? p.bidQty : undefined,
    askQty: typeof p.askQty === "number" ? p.askQty : undefined
  };
}

function mergeTickIntoStore(tick: MarketTickPatch) {
  const key = toSymbolInput(tick as Pick<MarketTick, "exchange" | "symbol">);
  liveMarketStore.ticksByKey[key] = mergeMarketTick(liveMarketStore.ticksByKey[key], tick);
}

function seedInitialTicks(initialTicks: MarketTick[]) {
  if (initialTicks.length === 0) return;
  let changed = false;
  for (const tick of initialTicks) {
    const key = toSymbolInput(tick);
    if (liveMarketStore.ticksByKey[key]) continue;
    liveMarketStore.ticksByKey[key] = tick;
    changed = true;
  }
  if (changed) {
    publishLiveMarketSnapshot();
  }
}

function applyDhanBatch(packets: unknown[]) {
  const patches: MarketTickPatch[] = [];
  for (const packet of packets) {
    const patch = processDhanPacket(packet);
    if (patch) patches.push(patch);
  }
  if (patches.length === 0) return;

  for (const patch of patches) mergeTickIntoStore(patch);
  liveMarketStore.snapshot = {
    ...liveMarketStore.snapshot,
    ticks: Object.values(liveMarketStore.ticksByKey),
    connectionStatus: "live",
    error: null
  };
  lastSharedLiveAt = Date.now();
  for (const listener of liveMarketListeners) listener();
}

function applyDhanPacket(packet: unknown) {
  if (!packet || typeof packet !== "object") return;
  const p = packet as Record<string, unknown>;
  if (p.type === "stream_error") {
    publishLiveMarketMeta({ connectionStatus: "polling" });
    return;
  }
  const patch = processDhanPacket(packet);
  if (!patch) return;
  mergeTickIntoStore(patch);
  liveMarketStore.snapshot = {
    ...liveMarketStore.snapshot,
    ticks: Object.values(liveMarketStore.ticksByKey),
    connectionStatus: "live",
    error: null
  };
  lastSharedLiveAt = Date.now();
  for (const listener of liveMarketListeners) listener();
}

function subscribeToSharedPolling(symbols: string[], callback: (snapshot: PollSnapshot) => void) {
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
  if (normalizedSymbols.length === 0) {
    return () => {};
  }

  const key = normalizedSymbols.join(",");
  let poller = sharedPollers.get(key);

  async function pollTicks() {
    const activePoller = sharedPollers.get(key);
    if (!activePoller || activePoller.inFlight) return;

    activePoller.inFlight = true;

    try {
      const response = await fetch(`/api/market/ticks?symbols=${encodeURIComponent(key)}`, {
        cache: "no-store"
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error?.message ?? "Market data polling failed.");
      }

      activePoller.lastSnapshot = {
        ticks: payload.data.ticks as NormalizedTick[],
        error: null
      };
    } catch (pollError) {
      activePoller.lastSnapshot = {
        ticks: [],
        error: pollError instanceof Error ? pollError.message : "Market data polling failed."
      };
    } finally {
      activePoller.inFlight = false;
      if (activePoller.lastSnapshot) {
        for (const subscriber of activePoller.subscribers) {
          subscriber(activePoller.lastSnapshot);
        }
      }
    }
  }

  if (!poller) {
    poller = {
      subscribers: new Set(),
      inFlight: false
    };
    sharedPollers.set(key, poller);
    void pollTicks();
    poller.timer = setInterval(() => {
      void pollTicks();
    }, POLLING_INTERVAL_MS);
  }

  poller.subscribers.add(callback);

  if (poller.lastSnapshot) {
    callback(poller.lastSnapshot);
  }

  return () => {
    const activePoller = sharedPollers.get(key);
    if (!activePoller) return;

    activePoller.subscribers.delete(callback);
    if (activePoller.subscribers.size === 0) {
      if (activePoller.timer) {
        clearInterval(activePoller.timer);
      }
      sharedPollers.delete(key);
    }
  };
}

export function useLiveMarket(initialTicks: MarketTick[], token?: string, fallbackSymbols: string[] = []) {
  const symbolsKey = useMemo(() => {
    const fromTicks = initialTicks.map(toSymbolInput);
    const source = fromTicks.length > 0 ? fromTicks : fallbackSymbols;
    return source.join(",");
  }, [initialTicks, fallbackSymbols]);

  const snapshot = useSyncExternalStore(
    subscribeLiveMarket,
    getLiveMarketSnapshot,
    getInitialLiveMarketSnapshot
  );

  // Seed the shared store from the SSR-provided initial ticks on the client
  // only (effect doesn't run on the server). This keeps the first paint
  // identical between server and client, then swaps in the seeded data right
  // after hydration via the useSyncExternalStore listener notification.
  useEffect(() => {
    seedInitialTicks(initialTicks);
  }, [initialTicks]);

  const [, setTicks] = useState<Record<string, MarketTick>>(() =>
    Object.fromEntries(initialTicks.map((tick) => [toSymbolInput(tick), tick]))
  );
  const [, setConnectionStatus] = useState<MarketConnectionStatus>("connecting");
  const [, setError] = useState<string | null>(null);
  const [, setSignal] = useState<FeaturedSignal | null>(null);
  const [, setAlerts] = useState<LiveAlert[]>([]);

  useEffect(() => {
    let cancelled = false;
    let stopPolling: (() => void) | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let reconnectAttempt = 0;
    let usingPollingFallback = false;
    let consecutivePollErrors = 0;
    let lastLiveAt = 0;
    const LIVE_GRACE_MS = 12000;
    const symbols = symbolsKey.split(",").filter(Boolean);
    const prevCloseBySecurity = new Map<string, number>();

    // ── Pure packet processor ──────────────────────────────────────────────
    // Extracts a MarketTickPatch from a raw Dhan binary-decoded packet.
    // Returns null for packets that should be skipped (unknown symbol,
    // prev_close updates, control messages, etc.).
    // Side effect: updates prevCloseBySecurity for prev_close packets.
    function processPacket(packet: unknown): MarketTickPatch | null {
      if (!packet || typeof packet !== "object") return null;
      const p = packet as Record<string, unknown>;
      const type = typeof p.type === "string" ? p.type : "";
      const securityId = typeof p.securityId === "string" ? p.securityId : "";
      if (!securityId) return null;

      // Server-side enrichment: the feed service injects symbol/exchange/segment
      // into every packet before SSE emission. Fall back to the client-side map
      // for any packet that bypasses enrichment (e.g. custom subscribed symbols
      // not yet registered — rare since subscribe route now registers them).
      const serverSymbol = typeof p.symbol === "string" ? p.symbol : null;
      const serverExchange = typeof p.exchange === "string" ? p.exchange : null;
      const serverSegment = typeof p.segment === "string" ? p.segment : null;
      const mapped = serverSymbol && serverExchange && serverSegment
        ? {
            symbol: serverSymbol,
            exchange: serverExchange as "NSE" | "BSE" | "MCX",
            segment: serverSegment as "EQ" | "INDEX" | "FNO" | "COMM" | "CURRENCY",
            name: typeof p.name === "string" ? p.name : serverSymbol
          }
        : DHAN_SYMBOL_BY_SECURITY_ID[securityId]
          ? {
              symbol: DHAN_SYMBOL_BY_SECURITY_ID[securityId].symbol,
              exchange: DHAN_SYMBOL_BY_SECURITY_ID[securityId].exchange as "NSE" | "BSE" | "MCX",
              segment: DHAN_SYMBOL_BY_SECURITY_ID[securityId].segment as "EQ" | "INDEX" | "FNO" | "COMM" | "CURRENCY",
              name: DHAN_SYMBOL_BY_SECURITY_ID[securityId].symbol
            }
          : null;

      if (!mapped) return null; // Unknown symbol — not in our universe; drop safely.

      // prev_close packets carry the previous day's close for % calculation.
      // Update the map as a side effect, then skip (no price tick to render).
      if (type === "prev_close" && typeof p.prevClose === "number") {
        prevCloseBySecurity.set(securityId, p.prevClose);
        return null;
      }

      if (type !== "index" && type !== "ticker" && type !== "quote" && type !== "full") return null;
      if (typeof p.ltp !== "number") return null;

      const prevClose = prevCloseBySecurity.get(securityId);
      const close = typeof p.close === "number" && p.close > 0 ? p.close : prevClose;
      const hasClose = typeof close === "number" && close > 0;
      const change = hasClose ? p.ltp - close : undefined;
      const changePercent = hasClose ? ((p.ltp - close) / close) * 100 : undefined;

      return {
        exchange: mapped.exchange,
        segment: mapped.segment,
        symbol: mapped.symbol,
        name: (typeof p.name === "string" ? p.name : null) ?? mapped.name ?? mapped.symbol,
        price: p.ltp,
        change,
        changePercent,
        volume: typeof p.volume === "number" ? p.volume : undefined,
        high: typeof p.high === "number" ? p.high : undefined,
        low: typeof p.low === "number" ? p.low : undefined,
        open: typeof p.open === "number" ? p.open : undefined,
        close,
        direction: changePercent && changePercent > 0 ? "up" : changePercent && changePercent < 0 ? "down" : "flat",
        updatedAt: typeof p.receivedAt === "string" ? p.receivedAt : new Date().toISOString(),
        source: "dhan-feed",
        ltt: typeof p.ltt === "string" ? p.ltt : undefined,
        lastTradedQuantity: typeof p.lastTradedQuantity === "number" ? p.lastTradedQuantity : undefined,
        averageTradedPrice: typeof p.atp === "number" ? p.atp : undefined,
        totalBuyQty: typeof p.totalBuyQty === "number" ? p.totalBuyQty : undefined,
        totalSellQty: typeof p.totalSellQty === "number" ? p.totalSellQty : undefined,
        openInterest: typeof p.openInterest === "number" ? p.openInterest : undefined,
        bidPrice: typeof p.bidPrice === "number" ? p.bidPrice : undefined,
        askPrice: typeof p.askPrice === "number" ? p.askPrice : undefined,
        bidQty: typeof p.bidQty === "number" ? p.bidQty : undefined,
        askQty: typeof p.askQty === "number" ? p.askQty : undefined
      };
    }

    // ── Batch handler (PRIMARY data path) ──────────────────────────────────
    // Called once per 250 ms flush with all changed ticks.
    // Processes the entire array and applies all changes in ONE setState call
    // wrapped in startTransition so React can deprioritise it vs user events.
    function applyDhanBatch(packets: unknown[]) {
      if (cancelled) return;

      // Collect all valid patches from this batch.
      const patches: Array<{ key: string; patch: MarketTickPatch }> = [];
      for (const packet of packets) {
        const patch = processPacket(packet);
        if (!patch) continue;
        const key = `${patch.exchange ?? "NSE"}:${patch.symbol}`;
        patches.push({ key, patch });
      }

      if (patches.length === 0) return;

      // ── Single setState for the entire batch ──
      startTransition(() => {
        setTicks((current) => {
          const next: Record<string, MarketTick> = { ...current };
          for (const { key, patch } of patches) {
            next[key] = mergeMarketTick(current[key], patch);
          }
          return next;
        });
      });

      lastLiveAt = Date.now();
      lastSharedLiveAt = lastLiveAt;
      consecutivePollErrors = 0;
      setConnectionStatus("live");
      setError(null);
    }

    // ── Legacy single-tick handler (polling fallback, backward compat) ─────
    function applyDhanPacket(packet: unknown) {
      if (!packet || typeof packet !== "object") return;
      const p = packet as Record<string, unknown>;
      if (p.type === "stream_error") {
        // Handled by polling fallback; don't surface immediately.
        return;
      }
      const patch = processPacket(packet);
      if (!patch) return;
      const key = `${patch.exchange ?? "NSE"}:${patch.symbol}`;
      setTicks((current) => ({
        ...current,
        [key]: mergeMarketTick(current[key], patch)
      }));
      lastLiveAt = Date.now();
      lastSharedLiveAt = lastLiveAt;
      consecutivePollErrors = 0;
      setConnectionStatus("live");
      setError(null);
    }

    function mergeTick(tick: MarketTickPatch) {
      const key = toSymbolInput(tick as Pick<MarketTick, "exchange" | "symbol">);
      setTicks((current) => ({
        ...current,
        [key]: mergeMarketTick(current[key], tick)
      }));
      mergeTickIntoStore(tick);
      lastSharedLiveAt = Date.now();
      publishLiveMarketSnapshot();
    }

    void applyDhanBatch;
    void applyDhanPacket;

    function startPolling() {
      if (usingPollingFallback || symbols.length === 0) return;
      usingPollingFallback = true;
      stopPolling = subscribeToSharedPolling(symbols, (snapshot) => {
        if (cancelled) return;

        for (const tick of snapshot.ticks) {
          mergeTick(normalizeTick(tick));
        }

        // The Dhan SSE channel is the primary live source; while it is
        // actively delivering batches, ignore transient poll outcomes so
        // the connection badge does not oscillate live <-> polling.
        if (Date.now() - Math.max(lastLiveAt, lastSharedLiveAt) < LIVE_GRACE_MS) {
          if (!snapshot.error) consecutivePollErrors = 0;
          return;
        }

        if (snapshot.error) {
          consecutivePollErrors += 1;
          if (consecutivePollErrors >= 3) {
            setConnectionStatus("error");
            setError(snapshot.error);
            publishLiveMarketMeta({ connectionStatus: "error", error: snapshot.error });
          }
          return;
        }

        consecutivePollErrors = 0;
        if (snapshot.ticks.length > 0) {
          lastLiveAt = Date.now();
          setConnectionStatus("live");
          publishLiveMarketMeta({ connectionStatus: "live", error: null });
        } else {
          setConnectionStatus("polling");
          publishLiveMarketMeta({ connectionStatus: "polling", error: null });
        }
        setError(null);
      });
    }

    function connectWebSocket() {
      const wsUrl = process.env.NEXT_PUBLIC_MARKET_WS_URL;

      if (!wsUrl || !token) {
        startPolling();
        return;
      }

      const url = new URL(wsUrl);
      url.searchParams.set("symbols", symbols.join(","));
      if (token) {
        url.searchParams.set("token", token);
      }
      setConnectionStatus("connecting");
      publishLiveMarketMeta({ connectionStatus: "connecting" });
      socket = new WebSocket(url.toString());

      socket.onopen = () => {
        reconnectAttempt = 0;
        lastLiveAt = Date.now();
        consecutivePollErrors = 0;
        setConnectionStatus("live");
        setError(null);
        publishLiveMarketMeta({ connectionStatus: "live", error: null });
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            type?: string;
            tick?: NormalizedTick;
            message?: string;
            signal?: FeaturedSignal;
            alert?: LiveAlert;
          };

          if (payload.type === "market.tick" && payload.tick) {
            mergeTick(normalizeTick(payload.tick));
            lastLiveAt = Date.now();
          }

          if (payload.type === "ai.signal" && payload.signal) {
            setSignal(payload.signal);
            publishLiveMarketMeta({ signal: payload.signal });
          }

          if (payload.type === "ai.alert" && payload.alert) {
            const alert = payload.alert;
            setAlerts((current) => [alert, ...current.slice(0, 9)]);
            publishLiveMarketMeta({ alerts: [alert, ...liveMarketStore.snapshot.alerts.slice(0, 9)] });
          }

          if (payload.type === "error") {
            setError(payload.message ?? "Market websocket error.");
            publishLiveMarketMeta({ error: payload.message ?? "Market websocket error." });
          }
        } catch {
          setError("Unable to parse market websocket message.");
          publishLiveMarketMeta({ error: "Unable to parse market websocket message." });
        }
      };

      socket.onerror = () => {
        startPolling();
        setConnectionStatus("polling");
        setError(null);
        publishLiveMarketMeta({ connectionStatus: "polling", error: null });
      };

      socket.onclose = () => {
        if (cancelled) {
          return;
        }
        startPolling();
        setConnectionStatus("polling");
        setError(null);
        publishLiveMarketMeta({ connectionStatus: "polling", error: null });
        const delay = Math.min(3000, 500 * 2 ** Math.min(reconnectAttempt, 3));
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connectWebSocket, delay);
      };
    }

    connectWebSocket();

    // ── Dhan SSE channel ───────────────────────────────────────────────────
    // Shared singleton — only one EventSource regardless of how many hook
    // instances are mounted. Each instance registers its own batch callback.
    liveConsumerCount += 1;
    ensureDhanSource();

    // ── Auto-subscribe curated dashboard universe (once per browser session)
    if (!dhanConnectInitialized) {
      dhanConnectInitialized = true;
      void fetch("/api/dhan/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestCode: 15, instruments: AUTO_SUBSCRIBE_INDICES })
      }).catch(() => { dhanConnectInitialized = false; });

      void fetch("/api/dhan/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestCode: 17, instruments: AUTO_SUBSCRIBE_EQUITIES })
      }).catch(() => { dhanConnectInitialized = false; });
    }

    return () => {
      cancelled = true;
      stopPolling?.();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();

      liveConsumerCount = Math.max(0, liveConsumerCount - 1);
      if (liveConsumerCount === 0) {
        dhanSharedSource?.close();
        dhanSharedSource = null;
      }
    };
  }, [symbolsKey, token]);

  // Stable array view — only changes when the state object changes.
  // With batch updates the state object changes ~4×/s (not 900×/s).
  return snapshot;
}
