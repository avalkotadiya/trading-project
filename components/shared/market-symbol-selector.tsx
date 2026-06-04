"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import {
  MARKET_CATEGORIES,
  SEGMENT_BG,
  SEGMENT_COLORS,
  SEGMENT_LABELS,
  type CategoryId,
  type MarketCategory
} from "@/lib/market-categories";
import { UI_SYMBOL_LIMITS } from "@/lib/dhan-api-limits";
import { cn } from "@/utils/cn";

export type MarketInstrument = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchange: "NSE" | "BSE" | "MCX";
  segment: string;
  exchangeSegment: string;
  securityId: string;
  instrument: string;
  isin?: string | null;
  lotSize?: number | null;
  expiry?: string | null;
  strikePrice?: number | null;
  optionType?: string | null;
};

type MarketSymbolSelectorProps = {
  value?: string;
  onSelect: (instrument: MarketInstrument) => void;
  placeholder?: string;
  className?: string;
  defaultCategory?: CategoryId;
  // Restrict which exchange segments are available. Omit to allow all.
  filterSegments?: string[];
};

// Map a UI category to the central Symbol Registry section. The registry
// guarantees India-only and applies the same filters that backend services
// use, so the picker and the bot universe never disagree on what's in scope.
function categoryToSection(catId: string): string {
  switch (catId) {
    case "indices":
      return "all"; // segment filter narrows to IDX_I
    case "nse-eq":
    case "bse-eq":
      return "scanner";
    case "futures":
      return "futures";
    case "options":
      return "options";
    case "commodity":
      return "commodity";
    case "currency":
      return "currency";
    case "etf":
      return "etf";
    default:
      return "all";
  }
}

function toDisplaySegment(exchangeSegment: string, instrument: string) {
  if (exchangeSegment === "IDX_I") return "INDEX";
  if (
    exchangeSegment === "NSE_FNO" ||
    exchangeSegment === "BSE_FNO" ||
    exchangeSegment === "NSE_CURRENCY" ||
    exchangeSegment === "BSE_CURRENCY" ||
    exchangeSegment === "MCX_COMM" ||
    instrument.startsWith("FUT") ||
    instrument.startsWith("OPT")
  ) {
    return "FNO";
  }
  return "EQ";
}

function normalizeInstrument(row: MarketInstrument): MarketInstrument {
  return {
    ...row,
    segment: row.segment ?? toDisplaySegment(row.exchangeSegment, row.instrument)
  };
}

async function fetchBySegment(
  cat: MarketCategory,
  q: string,
  effectiveSegments: string[],
  signal: AbortSignal
): Promise<MarketInstrument[]> {
  // Primary path: hit the central registry API. India-only by construction.
  const section = categoryToSection(cat.id);
  const params = new URLSearchParams({ section, limit: String(UI_SYMBOL_LIMITS.symbolPickerResults) });
  if (q) params.set("q", q);
  // The registry doesn't yet support multi-segment OR, so we narrow to the
  // first effective segment if the category targets multiple (e.g. F&O on
  // both NSE and BSE). Most categories only have one segment anyway.
  if (effectiveSegments.length === 1) params.set("segment", effectiveSegments[0]);

  try {
    const res = await fetch(`/api/symbols?${params.toString()}`, { signal });
    if (res.ok) {
      const payload = (await res.json()) as { data?: { symbols?: MarketInstrument[] } };
      const rows = payload?.data?.symbols ?? [];
      // Belt-and-braces: also narrow to any segments the caller asked for.
      const narrowed = effectiveSegments.length > 1
        ? rows.filter((r) => effectiveSegments.includes(r.exchangeSegment))
        : rows;
      if (narrowed.length > 0) return narrowed.map(normalizeInstrument);
    }
  } catch {
    // Fall through to the legacy endpoint below.
  }

  // Fallback: the older by-segment endpoint. Kept so a stale cache or transient
  // registry failure doesn't blank the picker.
  const legacyParams = new URLSearchParams();
  if (effectiveSegments.length) legacyParams.set("segments", effectiveSegments.join(","));
  if (q) legacyParams.set("q", q);
  if (cat.instrumentTypes?.length) legacyParams.set("instrument", cat.instrumentTypes[0]);
  legacyParams.set("limit", String(UI_SYMBOL_LIMITS.symbolPickerResults));
  const res = await fetch(`/api/dhan/instruments/by-segment?${legacyParams.toString()}`, { signal });
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: { instruments?: MarketInstrument[] } };
  return (payload?.data?.instruments ?? []).map(normalizeInstrument);
}

export function MarketSymbolSelector({
  value,
  onSelect,
  placeholder = "Search any symbol, name, ISIN…",
  className,
  defaultCategory = "all",
  filterSegments
}: MarketSymbolSelectorProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CategoryId>(defaultCategory);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketInstrument[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleCategories = filterSegments
    ? MARKET_CATEGORIES.filter((cat) => cat.segments.some((s) => filterSegments.includes(s)))
    : MARKET_CATEGORIES;

  const activeCat = MARKET_CATEGORIES.find((c) => c.id === category) ?? MARKET_CATEGORIES[0];

  const effectiveSegments = filterSegments
    ? activeCat.segments.filter((s) => filterSegments.includes(s))
    : activeCat.segments;

  const load = useCallback(
    async (q: string, cat: MarketCategory, segs: string[], signal: AbortSignal) => {
      setLoading(true);
      try {
        const instruments = await fetchBySegment(cat, q, segs, signal);
        if (!signal.aborted) setResults(instruments);
      } catch {
        if (!signal.aborted) setResults([]);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const delay = query.length >= 1 ? 180 : 0;
    const timer = setTimeout(() => {
      void load(query, activeCat, effectiveSegments, controller.signal);
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, category]);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function openDropdown() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function handleSelect(inst: MarketInstrument) {
    onSelect(inst);
    setOpen(false);
    setQuery("");
  }

  function changeCategory(id: CategoryId) {
    setCategory(id);
    setQuery("");
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={openDropdown}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.05] px-3 text-sm transition hover:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-sapphire-glow/30"
      >
        <span className={value ? "font-semibold text-white" : "text-slate-500"}>
          {value || placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full min-w-[340px] overflow-hidden rounded-xl border border-white/10 bg-[#07111f] shadow-2xl">
          {/* Category tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-white/[0.06] p-2 scrollbar-hide">
            {visibleCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => changeCategory(cat.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  category === cat.id
                    ? "bg-sapphire-glow/20 text-sapphire-soft ring-1 ring-sapphire-glow/30"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder={`Search ${activeCat.label}…`}
              className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.04] pl-8 pr-8 text-sm text-white placeholder:text-slate-500 focus:border-sapphire-glow/40 focus:outline-none focus:ring-1 focus:ring-sapphire-glow/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : loading ? (
              <Loader2 className="absolute right-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-500" />
            ) : null}
          </div>

          {/* Category description */}
          <p className="px-3 pb-1 text-[10px] text-slate-600">{activeCat.description}</p>

          {/* Results list */}
          <div className="max-h-72 overflow-y-auto">
            {loading && results.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading instruments…
              </div>
            ) : results.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No instruments found
              </div>
            ) : (
              results.map((inst) => {
                const sym = inst.symbol || inst.tradingSymbol;
                const segColor = SEGMENT_COLORS[inst.exchangeSegment] ?? "text-slate-400";
                const segBg = SEGMENT_BG[inst.exchangeSegment] ?? "bg-slate-400/10";
                const segLabel = SEGMENT_LABELS[inst.exchangeSegment] ?? inst.exchangeSegment;

                return (
                  <button
                    key={`${inst.exchangeSegment}-${inst.securityId}`}
                    type="button"
                    onClick={() => handleSelect(inst)}
                    className="flex w-full items-center justify-between gap-3 border-b border-white/[0.04] px-3 py-2.5 text-left last:border-0 hover:bg-white/[0.05]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">
                        {sym}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {inst.name}
                        {inst.expiry ? ` · ${inst.expiry}` : ""}
                        {inst.strikePrice ? ` · ${inst.strikePrice} ${inst.optionType ?? ""}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                          segColor,
                          segBg
                        )}
                      >
                        {segLabel}
                      </span>
                      <span className="text-[9px] text-slate-600">ID {inst.securityId}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-slate-600">
            <span>
              {results.length > 0 ? `${results.length} shown` : "0 results"}
              {query ? ` for "${query}"` : ""}
            </span>
            <span>DhanHQ Scrip Master</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
