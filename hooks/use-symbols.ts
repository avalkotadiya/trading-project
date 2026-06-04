"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client-side hook for the symbol registry. Pulls India-only symbol lists
 * from /api/symbols and caches them in module-level memory so multiple
 * components sharing the same `(section, segment, q)` don't re-fetch.
 *
 * Usage:
 *   const { symbols, loading, error, refresh } = useSymbols("dashboard");
 *   const { symbols } = useSymbols("scanner", { segment: "NSE_EQ" });
 *   const { symbols } = useSymbols("all", { query: "tata", limit: 30 });
 *
 * SSR-friendly: pass `initial` for the first paint, the hook hydrates from
 * the cache, then refreshes from /api/symbols in the background. This is
 * what lets us migrate components without breaking their server-rendered
 * initial state.
 */

export type RegistrySymbol = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchange: "NSE" | "BSE" | "MCX";
  exchangeSegment: string;
  segmentLabel: "INDEX" | "NSE_EQ" | "BSE_EQ" | "ETF" | "FUTURES" | "OPTIONS" | "COMMODITY" | "CURRENCY";
  securityId: string;
  instrument: string;
  lotSize: number | null;
  expiry: string | null;
  strikePrice: number | null;
  optionType: string | null;
};

export type SectionId =
  | "all"
  | "dashboard"
  | "bot-universe"
  | "scanner"
  | "charts"
  | "watchlist"
  | "futures"
  | "options"
  | "commodity"
  | "currency"
  | "etf";

export type UseSymbolsOptions = {
  segment?: string;
  query?: string;
  limit?: number;
  offset?: number;
  initial?: RegistrySymbol[];     // SSR seed — used on first render before fetch resolves
  refreshIntervalMs?: number;     // optional periodic re-fetch (e.g. for the live picker)
};

type CacheEntry = {
  data: RegistrySymbol[];
  total: number;
  fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min client cache; backend caches 6 h
const clientCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

function buildCacheKey(section: SectionId, options: UseSymbolsOptions): string {
  return JSON.stringify({
    s: section,
    seg: options.segment ?? null,
    q: options.query ?? null,
    l: options.limit ?? null,
    o: options.offset ?? null
  });
}

function buildUrl(section: SectionId, options: UseSymbolsOptions): string {
  const params = new URLSearchParams({ section });
  if (options.segment) params.set("segment", options.segment);
  if (options.query) params.set("q", options.query);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  return `/api/symbols?${params.toString()}`;
}

async function fetchSymbols(section: SectionId, options: UseSymbolsOptions): Promise<CacheEntry> {
  const key = buildCacheKey(section, options);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(buildUrl(section, options));
    if (!res.ok) {
      throw new Error(`/api/symbols ${res.status}`);
    }
    const json = (await res.json()) as { ok: boolean; data: { symbols: RegistrySymbol[]; total: number } };
    if (!json.ok) throw new Error("registry returned ok=false");
    return {
      data: json.data.symbols,
      total: json.data.total,
      fetchedAt: Date.now()
    } satisfies CacheEntry;
  })();

  inFlight.set(key, promise);
  try {
    const entry = await promise;
    clientCache.set(key, entry);
    return entry;
  } finally {
    inFlight.delete(key);
  }
}

export function useSymbols(section: SectionId, options: UseSymbolsOptions = {}) {
  // Stable cache key for memo/effect deps. We hash options into a string so
  // callers that pass inline objects don't blow up the effect on every render.
  const optionsKey = buildCacheKey(section, options);

  const initialEntry = options.initial
    ? { data: options.initial, total: options.initial.length, fetchedAt: 0 }
    : null;
  const cached = clientCache.get(optionsKey) ?? initialEntry;

  const [data, setData] = useState<RegistrySymbol[]>(cached?.data ?? []);
  const [total, setTotal] = useState<number>(cached?.total ?? 0);
  const [loading, setLoading] = useState<boolean>(() => !cached || Date.now() - cached.fetchedAt > CACHE_TTL_MS);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    cancelled.current = false;
    setLoading(true);
    setError(null);
    try {
      const entry = await fetchSymbols(section, options);
      if (cancelled.current) return;
      setData(entry.data);
      setTotal(entry.total);
    } catch (e) {
      if (cancelled.current) return;
      setError(e instanceof Error ? e.message : "Failed to load symbols.");
    } finally {
      if (!cancelled.current) setLoading(false);
    }
    // load() depends on optionsKey indirectly via the captured `options` —
    // but the optionsKey effect below re-creates `load` whenever it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  useEffect(() => {
    // Hydrate from cache if fresh; otherwise refetch.
    const entry = clientCache.get(optionsKey);
    if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
      setData(entry.data);
      setTotal(entry.total);
      setLoading(false);
      return;
    }
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [optionsKey, load]);

  useEffect(() => {
    if (!options.refreshIntervalMs || options.refreshIntervalMs <= 0) return;
    const timer = setInterval(() => void load(), options.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [options.refreshIntervalMs, load]);

  return { symbols: data, total, loading, error, refresh: load };
}

/** Drop the entire client-side symbol cache. Useful after a manual refresh
 *  action in the UI (e.g. "rebuild scrip master"). */
export function clearSymbolCache() {
  clientCache.clear();
}
