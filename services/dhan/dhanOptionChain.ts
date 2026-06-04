/**
 * Dhan Option Chain Service
 *
 * Full subscription features used:
 *   ✅  Option Chain on APIs     – /optionchain
 *   ✅  Expired Options Data     – /optionchain/expirylist (includes past expiries)
 *
 * Supported underlyings:
 *   Indices  : NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCPNIFTY
 *   Equities : any NSE FNO stock (resolved via scrip master)
 *
 * Architecture:
 *   - All requests go through a serialised throttle queue (3.1 s min gap) so
 *     concurrent callers don't race the Dhan rate limiter.
 *   - Results are cached: expiry list 60 s, chain data 3 s (live near-expiry).
 *   - `buildAnalytics` is pure and unit-testable.
 */

import { cacheGetOrSet } from "@/lib/cache";
import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";
import type { OptionChainRow, PutCallRatio } from "@/types/market";

// ---------------------------------------------------------------------------
//  Supported underlyings
// ---------------------------------------------------------------------------

type IndexUnderlying = {
  kind: "index";
  label: string;
  UnderlyingScrip: number;
  UnderlyingSeg: "IDX_I";
};

type EquityUnderlying = {
  kind: "equity";
  label: string;
  UnderlyingScrip: number;
  UnderlyingSeg: "NSE_EQ";
};

type Underlying = IndexUnderlying | EquityUnderlying;

/** Built-in well-known index underlyings. */
const INDEX_UNDERLYINGS: Record<string, IndexUnderlying> = {
  NIFTY:      { kind: "index", label: "NIFTY",      UnderlyingScrip: 13,  UnderlyingSeg: "IDX_I" },
  BANKNIFTY:  { kind: "index", label: "BANKNIFTY",  UnderlyingScrip: 25,  UnderlyingSeg: "IDX_I" },
  SENSEX:     { kind: "index", label: "SENSEX",     UnderlyingScrip: 51,  UnderlyingSeg: "IDX_I" },
  FINNIFTY:   { kind: "index", label: "FINNIFTY",   UnderlyingScrip: 27,  UnderlyingSeg: "IDX_I" },
  MIDCPNIFTY: { kind: "index", label: "MIDCPNIFTY", UnderlyingScrip: 26,  UnderlyingSeg: "IDX_I" },
};

/** All symbol aliases for the UI → canonical key mapping. */
const SYMBOL_ALIASES: Record<string, string> = {
  // NIFTY variants
  NIFTY50: "NIFTY", NIFTY: "NIFTY",
  // BANKNIFTY variants
  BANKNIFTY: "BANKNIFTY", NIFTYBANK: "BANKNIFTY", BANKNIFTYINDEX: "BANKNIFTY",
  // SENSEX
  SENSEX: "SENSEX", BSESENSEX: "SENSEX",
  // FINNIFTY
  FINNIFTY: "FINNIFTY", NIFTYFINSERVICE: "FINNIFTY",
  // MIDCAP
  MIDCPNIFTY: "MIDCPNIFTY", NIFTYMIDCAPSELECT: "MIDCPNIFTY"
};

// ---------------------------------------------------------------------------
//  Dhan API types
// ---------------------------------------------------------------------------

type DhanOptionSide = {
  average_price?: number;
  greeks?: { delta?: number; theta?: number; gamma?: number; vega?: number };
  implied_volatility?: number;
  last_price?: number;
  oi?: number;
  previous_close_price?: number;
  previous_oi?: number;
  previous_volume?: number;
  security_id?: number;
  top_ask_price?: number;
  top_ask_quantity?: number;
  top_bid_price?: number;
  top_bid_quantity?: number;
  volume?: number;
};

type DhanOptionChainResponse = {
  data?: {
    last_price?: number;
    oc?: Record<string, { ce?: DhanOptionSide; pe?: DhanOptionSide }>;
  };
  status?: string;
};

type DhanExpiryListResponse = {
  data?: string[];
  status?: string;
};

// ---------------------------------------------------------------------------
//  Analytics types (re-exported)
// ---------------------------------------------------------------------------

export type DhanOptionChainAnalytics = {
  pcr: PutCallRatio[];
  optionChain: OptionChainRow[];
  overview: {
    totalCallOi: number;
    totalPutOi: number;
    maxPain: number;
    maxOi: number;
    sentiment: string;
    symbol: string;
    spotPrice: number;
    expiry: string;
    expiries: string[];
    source: "dhan" | "unavailable";
    updatedAt: string;
  };
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

const OPTION_CHAIN_MIN_INTERVAL_MS = 3100;

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSymbol(raw?: string | null): string {
  const upper = (raw ?? "NIFTY").trim().toUpperCase().replace(/\s+/g, "");
  return SYMBOL_ALIASES[upper] ?? upper; // unknown symbols pass through for equity lookup
}

function calculateMaxPain(rows: OptionChainRow[]) {
  if (!rows.length) return 0;
  let bestStrike = rows[0].strike;
  let lowestPain = Number.POSITIVE_INFINITY;
  for (const candidate of rows) {
    const pain = rows.reduce(
      (sum, row) =>
        sum +
        Math.max(0, candidate.strike - row.strike) * row.callOi +
        Math.max(0, row.strike - candidate.strike) * row.putOi,
      0
    );
    if (pain < lowestPain) {
      lowestPain = pain;
      bestStrike = candidate.strike;
    }
  }
  return bestStrike;
}

function buildAnalytics(
  symbol: string,
  expiry: string,
  expiries: string[],
  response: DhanOptionChainResponse
): DhanOptionChainAnalytics {
  const spotPrice = numberOrZero(response.data?.last_price);

  const rows = Object.entries(response.data?.oc ?? {})
    .map(([strike, value]) => {
      const strikeValue = Number(strike);
      const callOi = numberOrZero(value.ce?.oi);
      const putOi = numberOrZero(value.pe?.oi);
      return {
        strike: Number(strikeValue.toFixed(2)),
        callOi,
        callChangeOi: callOi - numberOrZero(value.ce?.previous_oi),
        callLtp: numberOrZero(value.ce?.last_price),
        callIv: numberOrZero(value.ce?.implied_volatility),
        callVolume: numberOrZero(value.ce?.volume),
        putLtp: numberOrZero(value.pe?.last_price),
        putIv: numberOrZero(value.pe?.implied_volatility),
        putVolume: numberOrZero(value.pe?.volume),
        putChangeOi: putOi - numberOrZero(value.pe?.previous_oi),
        putOi
      };
    })
    .filter((row) => Number.isFinite(row.strike))
    .sort((a, b) => a.strike - b.strike);

  // Show the 20 strikes closest to spot; fall back to first 24 when spot is zero.
  const visibleRows = spotPrice
    ? rows
        .map((row) => ({ row, distance: Math.abs(row.strike - spotPrice) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 20)
        .map(({ row }) => row)
        .sort((a, b) => a.strike - b.strike)
    : rows.slice(0, 24);

  const totalCallOi = rows.reduce((sum, row) => sum + row.callOi, 0);
  const totalPutOi = rows.reduce((sum, row) => sum + row.putOi, 0);
  const pcrValue = totalCallOi > 0 ? totalPutOi / totalCallOi : 0;
  const maxOi = Math.max(0, ...rows.flatMap((row) => [row.callOi, row.putOi]));

  return {
    pcr: [
      {
        symbol,
        value: Number(pcrValue.toFixed(2)),
        previous: Number(pcrValue.toFixed(2)),
        sentiment: pcrValue > 1.05 ? "bullish" : pcrValue < 0.95 ? "bearish" : "neutral"
      }
    ],
    optionChain: visibleRows as unknown as OptionChainRow[],
    overview: {
      totalCallOi,
      totalPutOi,
      maxPain: calculateMaxPain(rows as unknown as OptionChainRow[]),
      maxOi,
      sentiment:
        pcrValue > 1.05
          ? "Bullish put writing"
          : pcrValue < 0.95
            ? "Call writing pressure"
            : "Balanced option positioning",
      symbol,
      spotPrice,
      expiry,
      expiries,
      source: "dhan",
      updatedAt: new Date().toISOString()
    }
  };
}

// ---------------------------------------------------------------------------
//  Service
// ---------------------------------------------------------------------------

class DhanOptionChainService {
  private readonly client = new DhanClient(resolveDhanAccessToken);
  private lastRequestAt = 0;
  private requestChain = Promise.resolve();

  /**
   * Resolve a symbol string to its Dhan underlying definition.
   * For well-known indices this is a local lookup.
   * For equities (NSE FNO stocks) we derive the underlying from the securityId
   * provided by the caller — e.g. RELIANCE has SecurityId 2885 in NSE_EQ.
   */
  private resolveUnderlying(
    symbol: string,
    securityId?: string | null
  ): Underlying {
    const indexUnderlying = INDEX_UNDERLYINGS[symbol];
    if (indexUnderlying) return indexUnderlying;

    // Equity option chain — caller must supply the NSE_EQ SecurityId.
    if (securityId) {
      return {
        kind: "equity",
        label: symbol,
        UnderlyingScrip: Number(securityId),
        UnderlyingSeg: "NSE_EQ"
      };
    }

    // Default to NIFTY if completely unknown
    return INDEX_UNDERLYINGS.NIFTY;
  }

  /** Fetch the list of active (and recently expired) expiry dates. */
  async getExpiryList(symbolInput?: string | null, securityId?: string | null) {
    const symbol = normalizeSymbol(symbolInput);
    const underlying = this.resolveUnderlying(symbol, securityId);
    return cacheGetOrSet(`dhan:option-expiries:${symbol}`, 60, () =>
      this.throttledRequest<DhanExpiryListResponse>("/optionchain/expirylist", {
        UnderlyingScrip: underlying.UnderlyingScrip,
        UnderlyingSeg: underlying.UnderlyingSeg
      }).then((response) => (response.data ?? []).filter(Boolean).sort())
    );
  }

  /** Fetch and compute option chain analytics for a symbol + optional expiry. */
  async getOptionChainAnalytics(
    symbolInput?: string | null,
    expiryInput?: string | null,
    securityId?: string | null
  ): Promise<DhanOptionChainAnalytics> {
    const symbol = normalizeSymbol(symbolInput);
    const underlying = this.resolveUnderlying(symbol, securityId);
    const expiries = await this.getExpiryList(symbol, securityId);
    const expiry = expiryInput && expiries.includes(expiryInput) ? expiryInput : expiries[0];

    if (!expiry) {
      throw new Error(`No active Dhan option expiries found for ${symbol}.`);
    }

    return cacheGetOrSet(`dhan:option-chain:${symbol}:${expiry}`, 3, async () => {
      const response = await this.throttledRequest<DhanOptionChainResponse>("/optionchain", {
        UnderlyingScrip: underlying.UnderlyingScrip,
        UnderlyingSeg: underlying.UnderlyingSeg,
        Expiry: expiry
      });
      return buildAnalytics(symbol, expiry, expiries, response);
    });
  }

  /**
   * Get all available expiry dates for a symbol, including historical/expired ones.
   * Dhan's /optionchain/expirylist returns the full list — expired dates are included
   * and can be used to query historical option chain snapshots.
   */
  async getExpiredExpiries(symbolInput?: string | null, securityId?: string | null) {
    const symbol = normalizeSymbol(symbolInput);
    const allExpiries = await this.getExpiryList(symbol, securityId);
    const now = Date.now();
    return allExpiries.filter((exp) => {
      const ms = Date.parse(exp);
      return Number.isFinite(ms) && ms < now;
    });
  }

  private async throttledRequest<T>(path: string, body: unknown) {
    const run = async () => {
      const waitMs = Math.max(0, OPTION_CHAIN_MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestAt = Date.now();
      return this.client.post<T>(path, body);
    };
    const result = this.requestChain.then(run, run);
    this.requestChain = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const dhanOptionChainService = new DhanOptionChainService();
