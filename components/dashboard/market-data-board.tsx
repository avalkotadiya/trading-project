"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Activity, AlertTriangle, RadioTower, Search, X } from "lucide-react";
import {
  MARKET_CATEGORIES,
  SEGMENT_COLORS,
  SEGMENT_LABELS,
  type CategoryId
} from "@/lib/market-categories";
import { compareByKnownPriority } from "@/lib/live-market-priority";
import { MarketSymbolSelector, type MarketInstrument } from "@/components/shared/market-symbol-selector";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveMarket } from "@/hooks/use-live-market";
import type { MarketConnectionStatus, MarketTick } from "@/types/market";
import { cn } from "@/utils/cn";
import { formatCompact, formatPercent, formatPrice } from "@/utils/format";

const PAGE_SIZE = 120;
const SUBSCRIBE_BATCH_SIZE = 100;
const VIRTUALIZE_AFTER_ROWS = 80;
const VIRTUAL_ROW_HEIGHT = 46;
const VIRTUAL_OVERSCAN = 12;

type MarketDataBoardProps = {
  initialTicks: MarketTick[];
  token?: string;
  providerStatus?: string;
  providerMessage?: string;
  fallbackSymbols?: string[];
};

type LiveMarketCategoryMeta = {
  id: CategoryId;
  label: string;
  description: string;
  count: number;
};

type LiveMarketSymbolRow = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchange: "NSE" | "BSE" | "MCX";
  segment: string;
  exchangeSegment: string;
  securityId: string;
  instrument: string;
  instrumentType: string;
  requestCode: 15 | 17 | 21;
  isin?: string | null;
  lotSize?: number | null;
  expiry?: string | null;
  strikePrice?: number | null;
  optionType?: string | null;
};

type LiveTableResponse = {
  category: CategoryId;
  categories: LiveMarketCategoryMeta[];
  total: number;
  offset: number;
  limit: number;
  symbols: LiveMarketSymbolRow[];
};

type RowWithTick = {
  row: LiveMarketSymbolRow;
  tick: MarketTick | null;
};

const indexSymbols = new Set(["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY", "NIFTY50"]);

const DEFAULT_CATEGORY_META: LiveMarketCategoryMeta[] = MARKET_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  description: category.description,
  count: 0
}));

const CATEGORY_IDS: CategoryId[] = [
  "all",
  "indices",
  "nse-eq",
  "bse-eq",
  "futures",
  "options",
  "commodity",
  "currency",
  "etf"
];

function getStatusTone(status: MarketConnectionStatus) {
  if (status === "live" || status === "polling") return "green" as const;
  if (status === "error") return "red" as const;
  return "amber" as const;
}

function getStatusLabel(status: MarketConnectionStatus) {
  if (status === "live") return "WebSocket live";
  if (status === "polling") return "API polling";
  if (status === "error") return "Provider issue";
  if (status === "closed") return "Reconnecting";
  return "Connecting";
}

function toMetaSegment(exchangeSegment: string): "EQ" | "INDEX" | "FNO" {
  if (exchangeSegment === "IDX_I") return "INDEX";
  if (
    exchangeSegment === "NSE_FNO" ||
    exchangeSegment === "BSE_FNO" ||
    exchangeSegment === "NSE_CURRENCY" ||
    exchangeSegment === "BSE_CURRENCY" ||
    exchangeSegment === "MCX_COMM"
  ) {
    return "FNO";
  }
  return "EQ";
}

function formatMaybePrice(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return formatPrice(value);
}

function formatMaybePercent(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return formatPercent(value);
}

function formatMaybeCompact(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return formatCompact(value);
}

function normalizeSearchInput(value: string) {
  return value.toUpperCase().trim();
}

function rowBelongsToCategory(row: LiveMarketSymbolRow, category: CategoryId) {
  if (category === "all") return true;
  if (category === "indices") {
    return row.exchangeSegment === "IDX_I" || row.instrumentType === "IDX" || row.instrument === "INDEX";
  }
  if (category === "nse-eq") return row.exchangeSegment === "NSE_EQ";
  if (category === "bse-eq") return row.exchangeSegment === "BSE_EQ";
  if (category === "futures") return row.instrumentType.startsWith("FUT") || row.instrument.startsWith("FUT");
  if (category === "options") return row.instrumentType.startsWith("OPT") || row.instrument.startsWith("OPT");
  if (category === "commodity") return row.exchangeSegment === "MCX_COMM";
  if (category === "currency") return row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY";
  if (category === "etf") return row.instrumentType === "ETF" || row.instrument === "ETF";
  return true;
}

function rowMatchesQuery(row: LiveMarketSymbolRow, query: string) {
  const q = query.trim().toUpperCase();
  if (!q) return true;
  return [
    row.symbol,
    row.tradingSymbol,
    row.name,
    row.securityId,
    row.exchangeSegment,
    row.instrumentType,
    row.isin
  ]
    .filter(Boolean)
    .some((value) => String(value).toUpperCase().includes(q));
}

function toFallbackRowFromTick(tick: MarketTick): LiveMarketSymbolRow {
  const exchange = tick.exchange ?? "NSE";
  const segment = tick.segment ?? "EQ";
  const exchangeSegment =
    segment === "INDEX" ? "IDX_I" : segment === "FNO" ? `${exchange}_FNO` : `${exchange}_EQ`;

  return {
    symbol: tick.symbol,
    tradingSymbol: tick.symbol,
    name: tick.name || tick.symbol,
    exchange,
    segment,
    exchangeSegment,
    securityId: tick.instrumentToken || `${exchangeSegment}:${tick.symbol}`,
    instrument: segment === "INDEX" ? "INDEX" : segment === "FNO" ? "FUTURES" : "EQUITY",
    instrumentType: segment === "INDEX" ? "IDX" : segment === "FNO" ? "FUT" : "ES",
    requestCode: segment === "INDEX" ? 15 : 17
  };
}

function buildFallbackSnapshot(
  ticks: MarketTick[],
  category: CategoryId,
  query: string,
  offset: number,
  limit: number
) {
  const byKey = new Map<string, LiveMarketSymbolRow>();
  for (const tick of ticks) {
    const row = toFallbackRowFromTick(tick);
    byKey.set(`${row.exchange}:${row.symbol}`, row);
  }

  const allRows = Array.from(byKey.values());
  const counts: Record<CategoryId, number> = {
    all: 0,
    indices: 0,
    "nse-eq": 0,
    "bse-eq": 0,
    futures: 0,
    options: 0,
    commodity: 0,
    currency: 0,
    etf: 0
  };

  for (const row of allRows) {
    counts.all += 1;
    for (const id of CATEGORY_IDS) {
      if (id === "all") continue;
      if (rowBelongsToCategory(row, id)) counts[id] += 1;
    }
  }

  const categories: LiveMarketCategoryMeta[] = MARKET_CATEGORIES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    count: counts[entry.id]
  }));

  const filtered = allRows
    .filter((row) => rowBelongsToCategory(row, category))
    .filter((row) => rowMatchesQuery(row, query))
    .sort((left, right) => compareByKnownPriority(category, left, right));

  return {
    categories,
    total: filtered.length,
    rows: filtered.slice(offset, offset + limit)
  };
}

export function MarketDataBoard({
  initialTicks,
  token,
  providerStatus,
  providerMessage,
  fallbackSymbols = []
}: MarketDataBoardProps) {
  const { ticks, connectionStatus, error } = useLiveMarket(initialTicks, token, fallbackSymbols);
  const deferredTicks = useDeferredValue(ticks);

  const [selected, setSelected] = useState<MarketInstrument[]>([]);
  const [excludedSymbols, setExcludedSymbols] = useState<Set<string>>(new Set());
  const [statusMsg, setStatusMsg] = useState("");

  const [activeSegment, setActiveSegment] = useState<CategoryId>("all");
  const [categoryRows, setCategoryRows] = useState<LiveMarketSymbolRow[]>([]);
  const [categoryMeta, setCategoryMeta] = useState<LiveMarketCategoryMeta[]>(DEFAULT_CATEGORY_META);
  const [categoryTotal, setCategoryTotal] = useState(0);
  const [categoryOffset, setCategoryOffset] = useState(0);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [useFallbackUniverse, setUseFallbackUniverse] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const deferredQuery = useDeferredValue(normalizeSearchInput(searchInput));

  const prevPricesRef = useRef<Record<string, number>>({});
  const subscribedKeysRef = useRef<Set<string>>(new Set());
  const combinedTicksRef = useRef<MarketTick[]>([]);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [flashMap, setFlashMap] = useState<Record<string, "up" | "down">>({});
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(420);

  const combinedTicks = useMemo(() => {
    if (excludedSymbols.size === 0) return deferredTicks;
    return deferredTicks.filter((tick) => !excludedSymbols.has(`${tick.exchange}:${tick.symbol}`));
  }, [deferredTicks, excludedSymbols]);

  useEffect(() => {
    combinedTicksRef.current = combinedTicks;
  }, [combinedTicks]);

  const requiredRowKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of categoryRows) {
      if (excludedSymbols.has(`${row.exchange}:${row.symbol}`)) continue;
      keys.add(`${row.exchange}:${row.symbol}`);
    }
    return keys;
  }, [categoryRows, excludedSymbols]);

  const ticksBySymbol = useMemo(() => {
    const map = new Map<string, MarketTick>();
    if (requiredRowKeys.size === 0) return map;

    for (const tick of combinedTicks) {
      const exchange = tick.exchange ?? "NSE";
      const key = `${exchange}:${tick.symbol}`;
      if (requiredRowKeys.has(key)) {
        map.set(key, tick);
      }
    }
    return map;
  }, [combinedTicks, requiredRowKeys]);

  const tableRows = useMemo<RowWithTick[]>(() => {
    return categoryRows
      .filter((row) => !excludedSymbols.has(`${row.exchange}:${row.symbol}`))
      .map((row) => ({
        row,
        tick: ticksBySymbol.get(`${row.exchange}:${row.symbol}`) ?? null
      }));
  }, [categoryRows, excludedSymbols, ticksBySymbol]);

  const virtualizationEnabled = tableRows.length > VIRTUALIZE_AFTER_ROWS;

  const virtualWindow = useMemo(() => {
    if (!virtualizationEnabled) {
      return {
        start: 0,
        end: tableRows.length,
        topSpacer: 0,
        bottomSpacer: 0,
        rows: tableRows
      };
    }

    const visibleCount = Math.max(
      1,
      Math.ceil(tableViewportHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2
    );
    const start = Math.max(0, Math.floor(tableScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(tableRows.length, start + visibleCount);
    const topSpacer = start * VIRTUAL_ROW_HEIGHT;
    const bottomSpacer = Math.max(0, (tableRows.length - end) * VIRTUAL_ROW_HEIGHT);

    return {
      start,
      end,
      topSpacer,
      bottomSpacer,
      rows: tableRows.slice(start, end)
    };
  }, [virtualizationEnabled, tableRows, tableViewportHeight, tableScrollTop]);

  const priceSignature = useMemo(() => {
    const parts: string[] = [];
    for (const entry of tableRows) {
      parts.push(`${entry.row.exchange}:${entry.row.symbol}=${entry.tick?.price ?? "na"}`);
    }
    return parts.sort().join("|");
  }, [tableRows]);

  useEffect(() => {
    const element = tableViewportRef.current;
    if (!element) return;

    const update = () => setTableViewportHeight(element.clientHeight || 420);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tableViewportRef]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const newFlash: Record<string, "up" | "down"> = {};
    for (const entry of tableRows) {
      if (!entry.tick) continue;
      const key = `${entry.row.exchange}:${entry.row.symbol}`;
      const prev = prevPricesRef.current[key];
      if (prev !== undefined && entry.tick.price !== prev) {
        newFlash[key] = entry.tick.price > prev ? "up" : "down";
      }
      prevPricesRef.current[key] = entry.tick.price;
    }

    if (Object.keys(newFlash).length === 0) return;

    setFlashMap((current) => ({ ...current, ...newFlash }));
    const timer = setTimeout(() => {
      setFlashMap((current) => {
        const next = { ...current };
        for (const key of Object.keys(newFlash)) delete next[key];
        return next;
      });
    }, 750);

    return () => clearTimeout(timer);
  }, [priceSignature, tableRows]);

  useEffect(() => {
    setCategoryOffset(0);
  }, [activeSegment, deferredQuery]);

  useEffect(() => {
    setTableScrollTop(0);
    tableViewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeSegment, categoryOffset, deferredQuery]);

  const subscribeCategoryRows = useCallback(async (rows: LiveMarketSymbolRow[]) => {
    const grouped = new Map<15 | 17 | 21, LiveMarketSymbolRow[]>();

    for (const row of rows) {
      const list = grouped.get(row.requestCode) ?? [];
      const key = `${row.requestCode}:${row.exchangeSegment}:${row.securityId}`;
      if (!subscribedKeysRef.current.has(key)) {
        list.push(row);
      }
      grouped.set(row.requestCode, list);
    }

    for (const [requestCode, group] of grouped.entries()) {
      if (group.length === 0) continue;
      for (let index = 0; index < group.length; index += SUBSCRIBE_BATCH_SIZE) {
        const chunk = group.slice(index, index + SUBSCRIBE_BATCH_SIZE);

        try {
          const response = await fetch("/api/dhan/market/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestCode,
              instruments: chunk.map((item) => ({
                ExchangeSegment: item.exchangeSegment,
                SecurityId: item.securityId
              })),
              meta: chunk.map((item) => ({
                SecurityId: item.securityId,
                symbol: item.symbol,
                name: item.name,
                exchange: item.exchange,
                segment: toMetaSegment(item.exchangeSegment),
                exchangeSegment: item.exchangeSegment,
                instrument: item.instrument,
                instrumentType: item.instrumentType,
                optionType: item.optionType ?? undefined
              }))
            })
          });

          if (!response.ok) continue;

          for (const item of chunk) {
            subscribedKeysRef.current.add(
              `${item.requestCode}:${item.exchangeSegment}:${item.securityId}`
            );
          }
        } catch {
          // no-op: UI should continue rendering even if a subscription call fails
        }
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadCategoryRows() {
      const applyFallback = () => {
        const fallback = buildFallbackSnapshot(
          combinedTicksRef.current,
          activeSegment,
          deferredQuery,
          categoryOffset,
          PAGE_SIZE
        );
        setCategoryMeta(fallback.categories);
        setCategoryTotal(fallback.total);
        setCategoryRows(fallback.rows);
        setUseFallbackUniverse(true);
      };

      setCategoryLoading(true);
      try {
        const params = new URLSearchParams({
          category: activeSegment,
          limit: String(PAGE_SIZE),
          offset: String(categoryOffset)
        });
        if (deferredQuery) {
          params.set("q", deferredQuery);
        }

        const response = await fetch(`/api/market/live-table?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });

        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          data?: LiveTableResponse;
          error?: { message?: string };
        } | null;

        if (cancelled) return;

        if (!response.ok || !payload?.ok || !payload.data) {
          applyFallback();
          setStatusMsg(payload?.error?.message ?? "Live table API unavailable; showing stream fallback symbols.");
          return;
        }

        setUseFallbackUniverse(false);
        setCategoryMeta(payload.data.categories);
        setCategoryRows(payload.data.symbols);
        setCategoryTotal(payload.data.total);
        setStatusMsg("");

        if (payload.data.symbols.length > 0) {
          void subscribeCategoryRows(payload.data.symbols);
        }
      } catch {
        if (!cancelled) {
          applyFallback();
          setStatusMsg("Live table API unavailable; showing stream fallback symbols.");
        }
      } finally {
        if (!cancelled) {
          setCategoryLoading(false);
        }
      }
    }

    void loadCategoryRows();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeSegment, categoryOffset, deferredQuery, subscribeCategoryRows]);

  useEffect(() => {
    if (!useFallbackUniverse) return;
    const fallback = buildFallbackSnapshot(
      combinedTicks,
      activeSegment,
      deferredQuery,
      categoryOffset,
      PAGE_SIZE
    );

    setCategoryMeta(fallback.categories);
    setCategoryTotal(fallback.total);
    setCategoryRows(fallback.rows);
  }, [useFallbackUniverse, combinedTicks, activeSegment, deferredQuery, categoryOffset]);

  const addInstrument = useCallback(async (instrument: MarketInstrument) => {
    setSelected((current) => {
      if (
        current.some(
          (item) =>
            item.securityId === instrument.securityId &&
            item.exchangeSegment === instrument.exchangeSegment
        )
      ) {
        return current;
      }
      return [...current, instrument].slice(0, 100);
    });

    const sym = instrument.symbol || instrument.tradingSymbol;
    const exchange = instrument.exchange === "BSE" ? "BSE" : instrument.exchange === "MCX" ? "MCX" : "NSE";
    const exchKey = `${exchange}:${sym}`;

    setExcludedSymbols((current) => {
      if (!current.has(exchKey)) return current;
      const next = new Set(current);
      next.delete(exchKey);
      return next;
    });

    setStatusMsg(`Subscribed ${sym}.`);

    await fetch("/api/dhan/market/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestCode: 17,
        instruments: [{ ExchangeSegment: instrument.exchangeSegment, SecurityId: instrument.securityId }],
        meta: [{
          SecurityId: instrument.securityId,
          symbol: sym,
          name: instrument.name || instrument.tradingSymbol,
          exchange,
          segment: instrument.segment.includes("FNO")
            ? "FNO"
            : instrument.segment.includes("IDX") || instrument.exchangeSegment === "IDX_I"
              ? "INDEX"
              : "EQ",
          exchangeSegment: instrument.exchangeSegment,
          instrument: instrument.instrument,
          instrumentType: instrument.instrument
        }]
      })
    }).catch(() => {
      setStatusMsg("Added locally but Dhan subscription failed.");
    });
  }, []);

  const removeInstrument = useCallback((instrument: MarketInstrument) => {
    setSelected((current) =>
      current.filter(
        (item) =>
          !(
            item.securityId === instrument.securityId &&
            item.exchangeSegment === instrument.exchangeSegment
          )
      )
    );

    const sym = instrument.symbol || instrument.tradingSymbol;
    const exchange = instrument.exchange === "BSE" ? "BSE" : instrument.exchange === "MCX" ? "MCX" : "NSE";
    const exchKey = `${exchange}:${sym}`;

    setExcludedSymbols((current) => new Set([...current, exchKey]));
    delete prevPricesRef.current[exchKey];
  }, []);

  const handleTableScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!virtualizationEnabled) return;
    const nextTop = event.currentTarget.scrollTop;

    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      setTableScrollTop(nextTop);
      scrollRafRef.current = null;
    });
  }, [virtualizationEnabled]);

  const latestTimestamp = tableRows
    .map((entry) => entry.tick?.updatedAt)
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];

  const hasLiveData = tableRows.some((entry) => entry.tick !== null) &&
    (connectionStatus === "live" || connectionStatus === "polling");

  const providerNotice = !hasLiveData ? providerMessage : undefined;
  const connectionNotice = error ?? providerNotice;

  const indices = combinedTicks.filter((tick) => indexSymbols.has(tick.symbol));

  const pageStart = categoryTotal === 0 ? 0 : categoryOffset + 1;
  const pageEnd = Math.min(categoryTotal, categoryOffset + categoryRows.length);
  const canPrev = categoryOffset > 0;
  const canNext = categoryOffset + categoryRows.length < categoryTotal;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower className="h-4 w-4 text-cyan-soft" />
            Market Data
          </CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            NSE - BSE - MCX - Currency - Dhan WebSocket, 250 ms batched.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={getStatusTone(connectionStatus)}>{getStatusLabel(connectionStatus)}</Badge>
          {providerStatus ? (
            <Badge tone={providerStatus === "connected" ? "green" : "amber"}>{providerStatus}</Badge>
          ) : null}
          {useFallbackUniverse ? <Badge tone="amber">Fallback list</Badge> : null}
          <Badge tone="cyan">{categoryTotal} symbols</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <MarketSymbolSelector
            placeholder="Add symbol - Equity, F&O, Commodity, Currency, ETF..."
            onSelect={(inst) => void addInstrument(inst)}
            className="flex-1"
          />
          {statusMsg ? (
            <p className="text-xs text-slate-400">{statusMsg}</p>
          ) : null}
        </div>

        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((instrument) => {
              const sym = instrument.symbol || instrument.tradingSymbol;
              const segColor = SEGMENT_COLORS[instrument.exchangeSegment] ?? "text-slate-400";
              const segLabel = SEGMENT_LABELS[instrument.exchangeSegment] ?? instrument.exchangeSegment;
              return (
                <button
                  type="button"
                  key={`${instrument.exchangeSegment}-${instrument.securityId}`}
                  onClick={() => removeInstrument(instrument)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cyan-glow/20 bg-cyan-glow/10 px-2.5 py-1.5 text-xs font-semibold text-cyan-soft"
                >
                  <span>{sym}</span>
                  <span className={cn("text-[9px]", segColor)}>{segLabel}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {categoryMeta.map((seg) => (
            <button
              key={seg.id}
              type="button"
              onClick={() => setActiveSegment(seg.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                activeSegment === seg.id
                  ? "bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/30"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
              )}
              title={seg.description}
            >
              {seg.label} ({seg.count.toLocaleString("en-IN")})
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Filter symbols, name, security id, ISIN..."
            className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
          />
        </div>

        {connectionNotice ? (
          <div className="flex items-start gap-2 rounded-md border border-trade-amber/20 bg-trade-amber/[0.08] px-3 py-2 text-xs text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{connectionNotice}</span>
          </div>
        ) : null}

        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-5">
          {indices.length === 0 ? (
            <div className="col-span-full rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-slate-500">
              Waiting for index ticks...
            </div>
          ) : null}
          {indices.map((tick) => {
            const positive = tick.changePercent >= 0;
            return (
              <div
                key={`${tick.exchange}-${tick.symbol}`}
                className={cn(
                  "rounded-md border bg-white/[0.03] px-3 py-2.5 transition-colors",
                  positive ? "border-trade-green/20 hover:border-trade-green/40" : "border-trade-red/20 hover:border-trade-red/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-200">{tick.symbol}</span>
                  <Activity className={cn("h-3.5 w-3.5", positive ? "text-trade-green" : "text-trade-red")} />
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-base font-semibold text-white tabular-nums">{formatPrice(tick.price)}</span>
                  <span className={cn("text-[11px] font-medium tabular-nums", positive ? "text-trade-green" : "text-trade-red")}>
                    {formatPercent(tick.changePercent)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div
          ref={tableViewportRef}
          onScroll={handleTableScroll}
          className="max-h-[60vh] min-h-[240px] overflow-auto rounded-md border border-white/10 bg-white/[0.015]"
        >
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-950/95 text-[10px] uppercase tracking-[0.14em] text-slate-500 backdrop-blur">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-medium">Symbol</th>
                <th className="px-2 py-2 font-medium">Seg</th>
                <th className="px-2 py-2 text-right font-medium">LTP</th>
                <th className="px-2 py-2 text-right font-medium">Chg %</th>
                <th className="px-2 py-2 text-right font-medium">Volume</th>
                <th className="px-2 py-2 text-right font-medium">Open</th>
                <th className="px-2 py-2 text-right font-medium">High</th>
                <th className="px-2 py-2 text-right font-medium">Low</th>
                <th className="px-2 py-2 text-right font-medium">Bid</th>
                <th className="px-2 py-2 text-right font-medium">Ask</th>
                <th className="px-2 py-2 text-right font-medium">OI</th>
                <th className="px-2 py-2 text-right font-medium">LTT</th>
              </tr>
            </thead>
            <tbody>
              {categoryLoading && tableRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500">
                    Loading symbols...
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500">
                    No symbols found for this category.
                  </td>
                </tr>
              ) : (
                <>
                  {virtualizationEnabled && virtualWindow.topSpacer > 0 ? (
                    <tr aria-hidden className="border-0">
                      <td colSpan={12} className="p-0" style={{ height: `${virtualWindow.topSpacer}px` }} />
                    </tr>
                  ) : null}

                  {virtualWindow.rows.map(({ row, tick }) => {
                    const flashKey = `${row.exchange}:${row.symbol}`;
                    const flash = flashMap[flashKey];
                    const changePercent = tick?.changePercent;
                    const positive = typeof changePercent === "number" ? changePercent >= 0 : null;

                    return (
                      <tr
                        key={`${row.exchangeSegment}-${row.securityId}`}
                        style={virtualizationEnabled ? { height: `${VIRTUAL_ROW_HEIGHT}px` } : undefined}
                        className={cn(
                          "border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors",
                          flash === "up" && "tick-flash-up",
                          flash === "down" && "tick-flash-down"
                        )}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-white">{row.symbol}</div>
                          <div className="text-[10px] text-slate-600 truncate max-w-[220px]">
                            {row.name}
                            {row.expiry ? ` - ${row.expiry}` : ""}
                            {typeof row.strikePrice === "number" ? ` - ${row.strikePrice} ${row.optionType ?? ""}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[11px] text-slate-400">
                          {SEGMENT_LABELS[row.exchangeSegment] ?? row.exchangeSegment}
                        </td>
                        <td className="px-2 py-2 text-right text-white tabular-nums">{formatMaybePrice(tick?.price)}</td>
                        <td
                          className={cn(
                            "px-2 py-2 text-right font-medium tabular-nums",
                            positive === null ? "text-slate-500" : positive ? "text-trade-green" : "text-trade-red"
                          )}
                        >
                          {formatMaybePercent(changePercent)}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-300 tabular-nums">{formatMaybeCompact(tick?.volume)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybePrice(tick?.open)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybePrice(tick?.high)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybePrice(tick?.low)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybePrice(tick?.bidPrice)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybePrice(tick?.askPrice)}</td>
                        <td className="px-2 py-2 text-right text-slate-400 tabular-nums">{formatMaybeCompact(tick?.openInterest)}</td>
                        <td className="px-2 py-2 text-right text-[10px] text-slate-600 tabular-nums">
                          {tick?.ltt
                            ? new Date(tick.ltt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                            : tick?.updatedAt
                              ? new Date(tick.updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                              : "--"}
                        </td>
                      </tr>
                    );
                  })}

                  {virtualizationEnabled && virtualWindow.bottomSpacer > 0 ? (
                    <tr aria-hidden className="border-0">
                      <td colSpan={12} className="p-0" style={{ height: `${virtualWindow.bottomSpacer}px` }} />
                    </tr>
                  ) : null}
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            {categoryTotal > 0
              ? `Showing ${pageStart}-${pageEnd} of ${categoryTotal.toLocaleString("en-IN")} symbols`
              : "No symbols"}
            {latestTimestamp ? ` - Latest tick: ${new Date(latestTimestamp).toLocaleString("en-IN")}` : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setCategoryOffset((current) => Math.max(0, current - PAGE_SIZE))}
              className="rounded-md border border-white/10 px-3 py-1 text-xs text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setCategoryOffset((current) => current + PAGE_SIZE)}
              className="rounded-md border border-white/10 px-3 py-1 text-xs text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
