"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type DhanInstrumentResult = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchangeSegment: string;
  securityId: string;
};

type SymbolSearchDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minQueryLength?: number;
};

export function SymbolSearchDropdown({
  value,
  onChange,
  placeholder = "Search symbol",
  className,
  minQueryLength = 2
}: SymbolSearchDropdownProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<DhanInstrumentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minQueryLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/dhan/instruments/search?q=${encodeURIComponent(trimmed)}&limit=10`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!controller.signal.aborted) {
          setResults(payload?.data?.instruments ?? []);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, minQueryLength]);

  function chooseSymbol(nextSymbol: string) {
    const normalized = nextSymbol.trim().toUpperCase();
    setQuery(normalized);
    onChange(normalized);
    setOpen(false);
    setResults([]);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        value={query}
        onChange={(event) => {
          const nextValue = event.target.value.toUpperCase();
          setQuery(nextValue);
          onChange(nextValue);
          setOpen(true);
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
        className="h-10 bg-white/5"
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
      </div>

      {open && results.length > 0 ? (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-md border border-white/10 bg-slate-950 shadow-xl">
          {results.map((instrument) => {
            const symbol = instrument.symbol || instrument.tradingSymbol;
            return (
              <button
                key={`${instrument.exchangeSegment}-${instrument.securityId}`}
                type="button"
                onClick={() => chooseSymbol(symbol)}
                className="flex w-full items-center justify-between gap-3 border-b border-white/5 px-3 py-2 text-left hover:bg-white/[0.06]"
              >
                <span>
                  <span className="block text-sm font-semibold text-white">{symbol}</span>
                  <span className="block text-xs text-slate-500">{instrument.name}</span>
                </span>
                <span className="text-right text-[10px] uppercase tracking-wider text-cyan-soft">{instrument.exchangeSegment}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

