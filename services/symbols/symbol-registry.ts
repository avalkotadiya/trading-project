/**
 * Symbol Registry — the single source of truth for "what symbols this app
 * knows about", India-only by construction.
 *
 * Why this exists:
 *  Symbol lists used to be scattered across hardcoded constants
 *  (DASHBOARD_SYMBOLS, DHAN_DASHBOARD_INSTRUMENTS, SCANNER_PRO_SYMBOLS,
 *  per-page filters). Adding or removing a symbol meant touching 5 files
 *  and praying nothing else cached the old list. The bot universe, watchlist
 *  suggestions, chart picker, and scanner all needed slightly different
 *  views of the same data.
 *
 *  This module:
 *    1. Pulls the full Dhan scrip master once, India-only by guard.
 *    2. Exposes typed *section views* — pre-filtered lists each page in
 *       the app can query without re-implementing the filter logic.
 *    3. Caches everything in Redis (TTL 6 h, same as the master itself)
 *       so the dashboard, scanner, bot, etc. share one fetch.
 *    4. Stays additive — the legacy DASHBOARD_SYMBOLS / DHAN_DASHBOARD_INSTRUMENTS
 *       exports remain so SSR and existing components don't break.
 *
 *  India enforcement is at the source: every row passes through
 *  `isIndianInstrument()` before entering ANY view. There is no path that
 *  returns a non-Indian symbol from this module.
 */

import { cacheGetOrSet } from "@/lib/cache";
import { logger } from "@/lib/logger";
import type { CategoryId } from "@/lib/market-categories";
import {
  getCanonicalDisplayName,
  getCanonicalDisplaySymbol,
  MAIN_SYMBOLS_PREFIX,
  isMainSymbolForCategory,
  normalizePrioritySymbol
} from "@/lib/live-market-priority";
import {
  getDhanInstrumentMaster,
  type DhanInstrumentSearchResult
} from "@/services/dhan/dhanInstruments";
import { DHAN_CHART_EXCHANGE_SEGMENTS, normalizeDhanChartInstrument } from "@/services/dhan/dhanChartValidation";

// ---------------------------------------------------------------------------
//  India enforcement — applied to EVERY row, in every view.
// ---------------------------------------------------------------------------

/** Indian exchange identifiers Dhan reports in the master. */
export const INDIA_EXCHANGES = new Set<string>(["NSE", "BSE", "MCX"]);

/** Indian exchange-segment codes used everywhere downstream. */
export const INDIA_EXCHANGE_SEGMENTS = new Set<string>(DHAN_CHART_EXCHANGE_SEGMENTS);

export function isIndianInstrument(row: DhanInstrumentSearchResult): boolean {
  return (
    INDIA_EXCHANGES.has(row.exchange) && INDIA_EXCHANGE_SEGMENTS.has(row.exchangeSegment)
  );
}

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

/** What every section of the app gets back. Compact on purpose — the master
 *  has 100k+ rows and we don't want to ship needless fields over the wire. */
export type RegistrySymbol = {
  symbol: string;          // display symbol e.g. "RELIANCE"
  tradingSymbol: string;   // broker trading symbol (may differ for F&O)
  name: string;            // human name e.g. "Reliance Industries"
  exchange: "NSE" | "BSE" | "MCX";
  exchangeSegment: string; // NSE_EQ / IDX_I / MCX_COMM / etc.
  segmentLabel: SegmentLabel; // ui-friendly bucket
  securityId: string;      // Dhan SecurityId
  instrument: string;      // EQUITY / INDEX / FUTSTK / OPTSTK / ETF / ...
  chartInstrument: string; // Dhan /charts enum after docs-backed normalization
  isin: string | null;
  series: string | null;   // EQ / BE / BZ / T / SM / ST / null
  lotSize: number | null;
  expiry: string | null;
  strikePrice: number | null;
  optionType: string | null;
};

export type SegmentLabel =
  | "INDEX"
  | "NSE_EQ"
  | "BSE_EQ"
  | "ETF"
  | "FUTURES"
  | "OPTIONS"
  | "COMMODITY"
  | "CURRENCY";

/** Sections of the app. Each gets a deterministic, India-only filtered view. */
export type SectionId =
  | "all"              // every Indian symbol the master knows about
  | "dashboard"        // home dashboard: indices + curated large caps
  | "bot-universe"     // AI bot trading universe (cash equities + indices)
  | "scanner"          // scanner-pro: NSE + BSE equities
  | "charts"           // charts page: equities + indices, tradeable
  | "watchlist"        // watchlist picker: equities + indices + ETFs
  | "futures"          // futures front-month only
  | "options"          // options chain symbols (underlyings only)
  | "commodity"        // MCX commodity front-month
  | "currency"         // currency derivatives spot
  | "etf";             // ETFs only

export type SectionView = {
  id: SectionId;
  label: string;
  description: string;
  count: number;
  symbols: RegistrySymbol[];
};

// ---------------------------------------------------------------------------
//  Internal: build one normalised registry row from a master row
// ---------------------------------------------------------------------------

function segmentLabelOf(row: DhanInstrumentSearchResult): SegmentLabel {
  const inst = row.instrument.toUpperCase();
  const eit = (row.exchInstrumentType ?? "").toUpperCase();
  // exchInstrumentType is more reliable than SEM_INSTRUMENT_NAME because debt
  // rows are mis-classified as EQUITY in the master.
  if (inst === "INDEX" || eit === "IDX") return "INDEX";
  if (inst === "ETF" || eit === "ETF") return "ETF";
  if (inst.startsWith("FUT")) return "FUTURES";
  if (inst.startsWith("OPT")) return "OPTIONS";
  if (row.exchangeSegment === "MCX_COMM") return "COMMODITY";
  if (row.exchangeSegment.endsWith("_CURRENCY")) return "CURRENCY";
  if (row.exchangeSegment === "BSE_EQ") return "BSE_EQ";
  return "NSE_EQ";
}

function displayCategoryOf(row: DhanInstrumentSearchResult): CategoryId | null {
  const inst = row.instrument.toUpperCase();
  if (row.exchangeSegment === "MCX_COMM") return "commodity";
  if (row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY") return "currency";
  if (inst.startsWith("OPT")) return "options";
  if (inst.startsWith("FUT")) return "futures";
  if (row.exchangeSegment === "IDX_I" || inst === "INDEX") return "indices";
  return null;
}

function toRegistrySymbol(row: DhanInstrumentSearchResult): RegistrySymbol {
  const displayCategory = displayCategoryOf(row);
  const displaySymbol = displayCategory
    ? getCanonicalDisplaySymbol(displayCategory, row.symbol)
    : row.symbol;
  const displayName = displayCategory
    ? getCanonicalDisplayName(displayCategory, row.symbol, row.name)
    : row.name;

  return {
    symbol: displaySymbol,
    tradingSymbol: row.tradingSymbol,
    name: displayName,
    exchange: row.exchange,
    exchangeSegment: row.exchangeSegment,
    segmentLabel: segmentLabelOf(row),
    securityId: row.securityId,
    instrument: row.instrument.toUpperCase(),
    chartInstrument: normalizeDhanChartInstrument(row.instrument, row.exchangeSegment),
    isin: row.isin ?? null,
    series: (row.series ?? null) && row.series ? row.series.toUpperCase() : null,
    lotSize: row.lotSize ?? null,
    expiry: row.expiry ?? null,
    strikePrice: row.strikePrice ?? null,
    optionType: row.optionType ?? null
  };
}

// -- Quality / liquidity filters --------------------------------------------
//
// What "unwanted" means in this codebase:
//
//   1. Expired derivatives. The Dhan master keeps months of historical contracts
//      around. Anything with SEM_EXPIRY_DATE in the past is unusable.
//
//   2. Penalty/trade-to-trade series (NSE: BE, BZ, T; BSE: T, Z). These are
//      surveillance segments — illiquid, no MIS/CO/BO products, often 5%
//      price bands. Bots that don't model these constraints lose money on
//      them. SME segments (SM, ST, M, MT) are similar — micro-caps with
//      tiny liquidity that the strategy isn't tuned for.
//
//   3. Suspended rows (lot size 0 for derivatives; missing securityId).
//
//   4. Junk display rows where the symbol or trading symbol is empty after
//      normalisation.
//
// These filters are applied INSIDE the registry — every section view sees
// the cleaned universe. No downstream code has to repeat them.

/** NSE/BSE equity series codes we want to ACTUALLY trade.
 *  - EQ: normal rolling settlement (the default for liquid equities)
 *  - A:  BSE Group A (large/liquid)
 *  - B:  BSE Group B (mid-cap, still liquid enough)
 *  - BL: block deals window (still tradeable normally)
 *  Anything else (BE/BZ/T/SM/ST/Z/...) is surveillance or microcap. */
const TRADEABLE_EQUITY_SERIES = new Set(["EQ", "A", "B", "BL"]);

/** Exchange instrument types the bot/UI should surface. Excludes debt
 *  (DBT/DEB/SGB/...), mutual funds, sovereign gilts, etc. */
const TRADEABLE_EXCH_TYPES = new Set([
  "ES",       // equity stock
  "ETF",      // exchange-traded fund
  "IDX",      // index (some master rows use IDX)
  "INDEX",    // index (most master rows use INDEX literal)
  "FUTSTK",   // stock futures
  "FUTIDX",   // index futures
  "FUTCOM",   // commodity futures
  "FUTCUR",   // currency futures
  "OPTSTK",   // stock options
  "OPTIDX",   // index options
  "OPTCUR",   // currency options
  "OPTCOM",   // commodity options in master; /charts uses OPTFUT
  "OPTFUT"    // commodity options in Dhan chart API
]);

const PARSE_DATE = (input: string | null | undefined): number | null => {
  if (!input) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
};

type RejectionReason =
  | "non_india"
  | "missing_fields"
  | "expired"
  | "bad_series"
  | "no_lot_size"
  | "sme"
  | "junk_name"
  | "debt_or_mf"        // SDL bonds, debentures, mutual funds, sovereign gilts
  | "untradeable_type"  // exchInstrumentType not in TRADEABLE_EXCH_TYPES
  | "not_main";         // outside curated main-symbol universe

function isCleanRow(
  row: DhanInstrumentSearchResult,
  rejections: Map<RejectionReason, number>
): boolean {
  // 1. India guard (already enforced earlier, repeated as the cheapest check
  //    so this function is self-contained / unit-testable).
  if (!isIndianInstrument(row)) {
    rejections.set("non_india", (rejections.get("non_india") ?? 0) + 1);
    return false;
  }

  // 2. Bare-minimum fields. Without these the row can't be ordered or charted.
  if (!row.symbol || !row.securityId || !row.tradingSymbol) {
    rejections.set("missing_fields", (rejections.get("missing_fields") ?? 0) + 1);
    return false;
  }

  // 3. Drop garbled display symbols (whitespace-only, all punctuation, etc.)
  //    Allow letters / digits / a small set of punctuation found in real
  //    Indian symbols (e.g. "M&M", "L&TFH", "ARE&M", "BAJAJ-AUTO").
  if (!/^[A-Z0-9._&-]+$/.test(row.symbol)) {
    rejections.set("junk_name", (rejections.get("junk_name") ?? 0) + 1);
    return false;
  }

  const inst = row.instrument.toUpperCase();
  const eit = (row.exchInstrumentType ?? "").toUpperCase();

  // 3b. Exchange-instrument-type guard. This is the REAL discriminator —
  //     debt instruments come through with instrument=EQUITY but
  //     exchInstrumentType=DBT/DEB/SGB. Drop them before any other check.
  if (eit && !TRADEABLE_EXCH_TYPES.has(eit)) {
    const isDebtLike = /^(DBT|DEB|SGB|MF|TB|GS|GSC|SLB|WAR|RR|PP)/.test(eit);
    rejections.set(isDebtLike ? "debt_or_mf" : "untradeable_type", (rejections.get(isDebtLike ? "debt_or_mf" : "untradeable_type") ?? 0) + 1);
    return false;
  }

  // 4. Expired derivatives. Allow a 1-day grace window for timezone slop.
  if (inst.startsWith("FUT") || inst.startsWith("OPT")) {
    const expiryMs = PARSE_DATE(row.expiry);
    if (expiryMs === null) {
      rejections.set("expired", (rejections.get("expired") ?? 0) + 1);
      return false;
    }
    if (expiryMs < Date.now() - 86_400_000) {
      rejections.set("expired", (rejections.get("expired") ?? 0) + 1);
      return false;
    }
    // Derivatives must have a positive lot size.
    if (!row.lotSize || row.lotSize <= 0) {
      rejections.set("no_lot_size", (rejections.get("no_lot_size") ?? 0) + 1);
      return false;
    }
  }

  // 5. Equity series filter. Only applies to NSE_EQ / BSE_EQ.
  if (row.exchangeSegment === "NSE_EQ" || row.exchangeSegment === "BSE_EQ") {
    const series = (row.series ?? "").toUpperCase();
    if (!series) {
      // Master row missing a series field — could be ETF, could be junk.
      // Allow if the instrument is explicitly ETF; otherwise drop to be safe.
      if (inst !== "ETF") {
        rejections.set("bad_series", (rejections.get("bad_series") ?? 0) + 1);
        return false;
      }
    } else if (!TRADEABLE_EQUITY_SERIES.has(series)) {
      // SME segments use SM, ST, M, MT. T2T uses BE, BZ, T, Z. Drop all.
      const isSme = /^(SM|ST|MT|M)$/.test(series);
      rejections.set(isSme ? "sme" : "bad_series", (rejections.get(isSme ? "sme" : "bad_series") ?? 0) + 1);
      return false;
    }
  }

  return true;
}

function isMainRegistrySymbol(row: RegistrySymbol): boolean {
  if (row.exchangeSegment === "IDX_I") {
    return isMainSymbolForCategory("indices", row.symbol);
  }
  if (row.exchangeSegment === "MCX_COMM") {
    return isMainSymbolForCategory("commodity", row.symbol);
  }
  if (row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY") {
    return isMainSymbolForCategory("currency", row.symbol);
  }
  if (row.segmentLabel === "ETF") {
    return isMainSymbolForCategory("etf", row.symbol);
  }
  if (row.segmentLabel === "OPTIONS") {
    return isMainSymbolForCategory("options", row.symbol);
  }
  if (row.segmentLabel === "FUTURES") {
    return isMainSymbolForCategory("futures", row.symbol);
  }
  if (row.exchangeSegment === "BSE_EQ") {
    return isMainSymbolForCategory("bse-eq", row.symbol);
  }
  if (row.exchangeSegment === "NSE_EQ") {
    return isMainSymbolForCategory("nse-eq", row.symbol) || isMainSymbolForCategory("etf", row.symbol);
  }
  return isMainSymbolForCategory("all", row.symbol);
}

// ---------------------------------------------------------------------------
//  Internal: full India-only registry, cached (Redis 6h + in-proc SWR fallback)
// ---------------------------------------------------------------------------

type RegistryIndexes = {
  rows: RegistrySymbol[];
  bySecurityId: Map<string, RegistrySymbol>;
  byExchangeAndSymbol: Map<string, RegistrySymbol>; // "NSE:RELIANCE"
  bySymbol: Map<string, RegistrySymbol[]>;          // "RELIANCE" -> [NSE, BSE]
  builtAt: number;
  rejectionsBreakdown: Record<RejectionReason, number>;
};

// In-process memory of the last good build. Survives Redis cache eviction so
// resolveSymbol() / getSectionSymbols() can still answer immediately even if
// Redis is cold AND Dhan is unreachable.
let inProcRegistry: RegistryIndexes | null = null;
const REGISTRY_CACHE_KEY = "symbol-registry:india:v6";

function buildIndexes(rows: RegistrySymbol[], rejections: Map<RejectionReason, number>): RegistryIndexes {
  const bySecurityId = new Map<string, RegistrySymbol>();
  const byExchangeAndSymbol = new Map<string, RegistrySymbol>();
  const bySymbol = new Map<string, RegistrySymbol[]>();
  for (const row of rows) {
    bySecurityId.set(row.securityId, row);
    byExchangeAndSymbol.set(`${row.exchange}:${row.symbol}`, row);
    const existing = bySymbol.get(row.symbol);
    if (existing) {
      existing.push(row);
    } else {
      bySymbol.set(row.symbol, [row]);
    }
  }
  return {
    rows,
    bySecurityId,
    byExchangeAndSymbol,
    bySymbol,
    builtAt: Date.now(),
    rejectionsBreakdown: {
      non_india: rejections.get("non_india") ?? 0,
      missing_fields: rejections.get("missing_fields") ?? 0,
      expired: rejections.get("expired") ?? 0,
      bad_series: rejections.get("bad_series") ?? 0,
      no_lot_size: rejections.get("no_lot_size") ?? 0,
      sme: rejections.get("sme") ?? 0,
      junk_name: rejections.get("junk_name") ?? 0,
      debt_or_mf: rejections.get("debt_or_mf") ?? 0,
      untradeable_type: rejections.get("untradeable_type") ?? 0,
      not_main: rejections.get("not_main") ?? 0
    }
  };
}

async function buildRegistryFromMaster(): Promise<RegistryIndexes> {
  const master = await getDhanInstrumentMaster();
  const rejections = new Map<RejectionReason, number>();
  const out: RegistrySymbol[] = [];
  for (const row of master) {
    if (!isCleanRow(row, rejections)) continue;
    const built = toRegistrySymbol(row);
    if (!isMainRegistrySymbol(built)) {
      rejections.set("not_main", (rejections.get("not_main") ?? 0) + 1);
      continue;
    }
    out.push(built);
  }
  const indexes = buildIndexes(out, rejections);
  inProcRegistry = indexes;
  const breakdown = Object.entries(indexes.rejectionsBreakdown)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(" · ");
  logger.info(
    `[SymbolRegistry] built: ${out.length} clean symbols from ${master.length} master rows` +
      (breakdown ? ` · rejected: ${breakdown}` : "")
  );
  return indexes;
}

async function getRegistryIndexes(): Promise<RegistryIndexes> {
  try {
    // Redis cache is keyed on the registry version. Bumped to v2 because the
    // schema added series + indexes — old cached v1 entries won't deserialize.
    // We cache only the rows array (Maps don't survive JSON round-trip) and
    // re-build indexes per process.
    const rows = await cacheGetOrSet<RegistrySymbol[]>(REGISTRY_CACHE_KEY, 60 * 60 * 6, async () => {
      const built = await buildRegistryFromMaster();
      return built.rows;
    });
    // Reuse in-proc indexes if they describe the same row count (cheap heuristic).
    if (inProcRegistry && inProcRegistry.rows.length === rows.length) {
      return inProcRegistry;
    }
    // Rebuild indexes from the cached rows. No master fetch needed.
    const indexes = buildIndexes(rows, new Map());
    inProcRegistry = indexes;
    return indexes;
  } catch (error) {
    // Stale-while-revalidate: if the cache/master path failed but we have a
    // previous good copy in this process, keep serving it.
    if (inProcRegistry) {
      logger.warn(
        `[SymbolRegistry] live build failed, serving stale in-proc copy (${inProcRegistry.rows.length} rows): ${error instanceof Error ? error.message : "unknown"}`
      );
      return inProcRegistry;
    }
    throw error;
  }
}

async function getIndianRegistry(): Promise<RegistrySymbol[]> {
  return (await getRegistryIndexes()).rows;
}

// ---------------------------------------------------------------------------
//  Section filters — each is a pure function over the India registry.
// ---------------------------------------------------------------------------

function isFrontMonth(row: RegistrySymbol): boolean {
  if (!row.expiry) return false;
  const ms = Date.parse(row.expiry);
  if (!Number.isFinite(ms)) return false;
  const daysToExpiry = (ms - Date.now()) / 86_400_000;
  return daysToExpiry >= 0 && daysToExpiry <= 45;
}

function dedupeBy<T, K>(rows: T[], key: (row: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

function extractMainBase(category: CategoryId, symbol: string) {
  const normalized = normalizePrioritySymbol(symbol);
  const prefixes = MAIN_SYMBOLS_PREFIX[category].map((item) => normalizePrioritySymbol(item));
  for (const prefix of prefixes) {
    if (prefix && normalized.startsWith(prefix)) return prefix;
  }
  return "";
}

function detectOptionSide(symbol: RegistrySymbol) {
  const optionType = (symbol.optionType ?? "").toUpperCase();
  if (optionType === "CE" || optionType === "CALL") return "CE";
  if (optionType === "PE" || optionType === "PUT") return "PE";
  const normalized = normalizePrioritySymbol(symbol.symbol);
  if (normalized.endsWith("CE") || normalized.endsWith("CALL")) return "CE";
  if (normalized.endsWith("PE") || normalized.endsWith("PUT")) return "PE";
  return "";
}

function trimMainContracts(category: CategoryId, rows: RegistrySymbol[]) {
  if (!["futures", "options", "commodity", "currency"].includes(category)) {
    return rows;
  }

  const kept: RegistrySymbol[] = [];
  const seenBase = new Set<string>();
  const optionSides = new Map<string, Set<string>>();

  for (const row of rows) {
    const base = extractMainBase(category, row.symbol);
    if (!base) continue;

    if (category === "options") {
      const side = detectOptionSide(row);
      const set = optionSides.get(base) ?? new Set<string>();
      if (side && set.has(side)) continue;
      if (!side && set.size >= 2) continue;
      if (side) set.add(side);
      optionSides.set(base, set);
      kept.push(row);
      continue;
    }

    if (seenBase.has(base)) continue;
    seenBase.add(base);
    kept.push(row);
  }

  return kept;
}

// The 30-or-so symbols the dashboard surfaces by default. Each entry lists
// candidate symbol forms — the master uses variants like "NIFTY 50" /
// "NIFTY BANK" for indices and stripped-whitespace forms for some equities,
// so we try each candidate in order and take the first that the cleaned
// registry actually contains.
const DASHBOARD_CURATED: ReadonlyArray<{ exchange: "NSE" | "BSE"; candidates: string[] }> = [
  { exchange: "NSE", candidates: ["NIFTY", "NIFTY50", "NIFTY 50"] },
  { exchange: "NSE", candidates: ["BANKNIFTY", "NIFTYBANK", "NIFTY BANK"] },
  { exchange: "BSE", candidates: ["SENSEX", "BSESENSEX", "BSE SENSEX"] },
  { exchange: "NSE", candidates: ["RELIANCE"] },
  { exchange: "NSE", candidates: ["TCS"] },
  { exchange: "NSE", candidates: ["INFY"] },
  { exchange: "NSE", candidates: ["HDFCBANK"] },
  { exchange: "NSE", candidates: ["ICICIBANK"] },
  { exchange: "NSE", candidates: ["SBIN"] },
  { exchange: "NSE", candidates: ["AXISBANK"] },
  { exchange: "NSE", candidates: ["KOTAKBANK"] },
  { exchange: "NSE", candidates: ["BAJFINANCE"] },
  { exchange: "NSE", candidates: ["BAJAJFINSV"] },
  { exchange: "NSE", candidates: ["LT"] },
  { exchange: "NSE", candidates: ["TITAN"] },
  { exchange: "NSE", candidates: ["MARUTI"] },
  { exchange: "NSE", candidates: ["SUNPHARMA"] },
  { exchange: "NSE", candidates: ["DRREDDY"] },
  { exchange: "NSE", candidates: ["BHARTIARTL"] },
  { exchange: "NSE", candidates: ["WIPRO"] },
  { exchange: "NSE", candidates: ["HCLTECH"] },
  { exchange: "NSE", candidates: ["TECHM"] },
  // Tata Motors split into TMCV (commercial vehicles) and TMPV (passenger
  // vehicles) — there is no plain "TATAMOTORS" listing anymore. Use TMCV
  // (the main commercial-vehicle business carrying the legacy listing).
  { exchange: "NSE", candidates: ["TMCV", "TATAMOTORS"] },
  { exchange: "NSE", candidates: ["TATASTEEL"] },
  { exchange: "NSE", candidates: ["HINDALCO"] },
  { exchange: "NSE", candidates: ["JSWSTEEL"] },
  { exchange: "NSE", candidates: ["ITC"] },
  { exchange: "NSE", candidates: ["NESTLEIND"] },
  { exchange: "NSE", candidates: ["ONGC"] },
  { exchange: "NSE", candidates: ["POWERGRID"] }
];

function dashboardView(all: RegistrySymbol[]): RegistrySymbol[] {
  // Index `all` by exchange+symbol once for O(1) candidate resolution.
  const byKey = new Map<string, RegistrySymbol>();
  for (const row of all) {
    byKey.set(`${row.exchange}:${row.symbol}`, row);
  }
  // For each curated entry, try the candidates in order; first hit wins.
  // Preserve curated order so the UI is stable across deploys.
  const out: RegistrySymbol[] = [];
  for (const entry of DASHBOARD_CURATED) {
    for (const candidate of entry.candidates) {
      const found = byKey.get(`${entry.exchange}:${candidate}`);
      if (found) {
        out.push(found);
        break;
      }
    }
  }
  return out;
}

function botUniverseView(all: RegistrySymbol[]): RegistrySymbol[] {
  // Broad universe — everything tradeable the quant-edge engine can pull
  // Dhan history for: NSE/BSE equities, ETFs, front-month futures, trimmed
  // front-month options, MCX commodity, NSE/BSE currency. Indices are
  // omitted (broker rejects buys on indices, so spending a Dhan history
  // call on them is wasted budget). quant-edge.service.ts skips per-symbol
  // 404s gracefully (expired contracts, illiquid options).
  return dedupeBy(
    [
      ...all.filter((r) => r.segmentLabel === "NSE_EQ" || r.segmentLabel === "BSE_EQ"),
      ...etfView(all),
      ...futuresView(all),
      ...optionsView(all),
      ...commodityView(all),
      ...currencyView(all)
    ],
    (r) => `${r.exchangeSegment}:${r.securityId}`
  );
}

function scannerView(all: RegistrySymbol[]): RegistrySymbol[] {
  return all.filter((r) => r.segmentLabel === "NSE_EQ" || r.segmentLabel === "BSE_EQ");
}

function chartsView(all: RegistrySymbol[]): RegistrySymbol[] {
  return all.filter(
    (r) =>
      r.segmentLabel === "NSE_EQ" ||
      r.segmentLabel === "BSE_EQ" ||
      r.segmentLabel === "INDEX" ||
      r.segmentLabel === "ETF"
  );
}

function watchlistView(all: RegistrySymbol[]): RegistrySymbol[] {
  return chartsView(all); // same surface — charts + watchlist are aligned
}

function futuresView(all: RegistrySymbol[]): RegistrySymbol[] {
  return trimMainContracts(
    "futures",
    all.filter((r) => r.segmentLabel === "FUTURES" && isFrontMonth(r))
  );
}

function optionsView(all: RegistrySymbol[]): RegistrySymbol[] {
  return trimMainContracts(
    "options",
    all.filter((r) => r.segmentLabel === "OPTIONS" && isFrontMonth(r))
  );
}

function commodityView(all: RegistrySymbol[]): RegistrySymbol[] {
  // MCX rows arrive as FUTCOM (front-month futures), so segmentLabel is
  // "FUTURES" rather than "COMMODITY". Filter by exchangeSegment instead.
  return trimMainContracts(
    "commodity",
    all.filter((r) => r.exchangeSegment === "MCX_COMM" && isFrontMonth(r))
  );
}

function currencyView(all: RegistrySymbol[]): RegistrySymbol[] {
  // Same shape as commodities — currency derivatives are FUTCUR/OPTCUR rows.
  return trimMainContracts(
    "currency",
    all.filter((r) => (r.exchangeSegment === "NSE_CURRENCY" || r.exchangeSegment === "BSE_CURRENCY") && isFrontMonth(r))
  );
}

function etfView(all: RegistrySymbol[]): RegistrySymbol[] {
  return all.filter((r) => r.segmentLabel === "ETF");
}

function allView(all: RegistrySymbol[]): RegistrySymbol[] {
  return dedupeBy(
    [
      ...chartsView(all),
      ...futuresView(all),
      ...optionsView(all),
      ...commodityView(all),
      ...currencyView(all)
    ],
    (r) => `${r.exchangeSegment}:${r.securityId}`
  );
}

const SECTION_LABEL: Record<SectionId, { label: string; description: string }> = {
  all: { label: "All Indian symbols", description: "Main Indian live-market symbols from the Dhan scrip master." },
  dashboard: { label: "Dashboard", description: "Indices and Nifty 50 majors shown on the home dashboard." },
  "bot-universe": { label: "AI Bot universe", description: "All tradeable Indian symbols the quant bot scans — equities, ETFs, front-month futures/options, commodity, currency." },
  scanner: { label: "Scanner Pro", description: "NSE and BSE cash equities for technical scanning." },
  charts: { label: "Charts", description: "Tradeable equities, indices, and ETFs." },
  watchlist: { label: "Watchlist picker", description: "Symbols users can add to a watchlist." },
  futures: { label: "Futures", description: "Stock and index futures, front-month only." },
  options: { label: "Options", description: "Options underlyings, current expiry only." },
  commodity: { label: "Commodity", description: "MCX commodity contracts, front-month only." },
  currency: { label: "Currency", description: "NSE/BSE currency derivatives, current expiry." },
  etf: { label: "ETF", description: "Indian ETFs listed on NSE/BSE." }
};

const SECTION_FILTER: Record<SectionId, (all: RegistrySymbol[]) => RegistrySymbol[]> = {
  all: allView,
  dashboard: dashboardView,
  "bot-universe": botUniverseView,
  scanner: scannerView,
  charts: chartsView,
  watchlist: watchlistView,
  futures: futuresView,
  options: optionsView,
  commodity: commodityView,
  currency: currencyView,
  etf: etfView
};

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

/** All sections, with metadata, no rows. Useful for the UI to render a picker. */
export function listSections(): Array<{ id: SectionId; label: string; description: string }> {
  return (Object.keys(SECTION_LABEL) as SectionId[]).map((id) => ({
    id,
    label: SECTION_LABEL[id].label,
    description: SECTION_LABEL[id].description
  }));
}

/** Return the full filtered list for one section. India-only by construction. */
export async function getSectionSymbols(section: SectionId): Promise<SectionView> {
  const all = await getIndianRegistry();
  const filter = SECTION_FILTER[section];
  const rows = filter(all);
  return {
    id: section,
    label: SECTION_LABEL[section].label,
    description: SECTION_LABEL[section].description,
    count: rows.length,
    symbols: rows
  };
}

export type QueryOptions = {
  section?: SectionId;
  segment?: string;           // e.g. NSE_EQ
  query?: string;             // free-text search across symbol / name / ISIN
  limit?: number;             // page size, default 50, max 500
  offset?: number;            // for pagination
};

/** Search/list within a section. India enforcement runs first; section filter
 *  second; segment filter third; query last. */
export async function querySymbols(opts: QueryOptions = {}): Promise<{
  total: number;
  offset: number;
  limit: number;
  symbols: RegistrySymbol[];
}> {
  const section = opts.section ?? "all";
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const all = await getIndianRegistry();
  let rows = SECTION_FILTER[section](all);
  if (opts.segment) {
    const segment = opts.segment.toUpperCase();
    rows = rows.filter((r) => r.exchangeSegment === segment);
  }
  if (opts.query) {
    const q = opts.query.trim().toUpperCase();
    if (q) {
      rows = rows.filter((r) => {
        const fields: Array<string | null> = [r.symbol, r.tradingSymbol, r.name, r.securityId];
        return fields.some((f) => f && f.toUpperCase().includes(q));
      });
    }
  }
  const total = rows.length;
  return {
    total,
    offset,
    limit,
    symbols: rows.slice(offset, offset + limit)
  };
}

/** Resolve a single symbol (e.g. "NSE:RELIANCE" or "RELIANCE") to a full row.
 *  O(1) lookup via pre-built indexes — used on every broker order, so this
 *  matters for hot-path latency. */
export async function resolveSymbol(input: string): Promise<RegistrySymbol | null> {
  const { byExchangeAndSymbol, bySymbol } = await getRegistryIndexes();
  let exchange: string | null = null;
  let symbol = input;
  if (input.includes(":")) {
    const [ex, sym] = input.split(":");
    exchange = ex.trim().toUpperCase();
    symbol = sym;
  }
  const upper = symbol.trim().toUpperCase();
  if (exchange) {
    return byExchangeAndSymbol.get(`${exchange}:${upper}`) ?? null;
  }
  // Bare symbol — prefer NSE > BSE > MCX so we don't accidentally land on a
  // BSE penny-stock listing of the same name.
  const candidates = bySymbol.get(upper);
  if (!candidates || candidates.length === 0) return null;
  const order = { NSE: 0, BSE: 1, MCX: 2 } as const;
  return [...candidates].sort((a, b) => order[a.exchange] - order[b.exchange])[0];
}

/** Resolve by Dhan SecurityId. Also O(1). */
export async function resolveBySecurityId(securityId: string): Promise<RegistrySymbol | null> {
  const { bySecurityId } = await getRegistryIndexes();
  return bySecurityId.get(securityId) ?? null;
}

// ---------------------------------------------------------------------------
//  Health / diagnostics
// ---------------------------------------------------------------------------

export type RegistryHealth = {
  ok: boolean;
  totalSymbols: number;
  bySection: Record<SectionId, number>;
  bySegment: Record<string, number>;
  rejections: Record<RejectionReason, number>;
  builtAt: string | null;
  ageSeconds: number | null;
  india_only: true;
};

/** Operator-facing snapshot: how many clean symbols per section/segment, what
 *  was rejected and why, and how stale the in-proc registry is. Cheap — pulls
 *  from already-built indexes. */
export async function getRegistryHealth(): Promise<RegistryHealth> {
  const indexes = await getRegistryIndexes();
  const bySegment = indexes.rows.reduce((acc, r) => {
    acc[r.exchangeSegment] = (acc[r.exchangeSegment] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const bySection = {} as Record<SectionId, number>;
  for (const id of Object.keys(SECTION_FILTER) as SectionId[]) {
    bySection[id] = SECTION_FILTER[id](indexes.rows).length;
  }
  return {
    ok: indexes.rows.length > 0,
    totalSymbols: indexes.rows.length,
    bySection,
    bySegment,
    rejections: indexes.rejectionsBreakdown,
    builtAt: indexes.builtAt ? new Date(indexes.builtAt).toISOString() : null,
    ageSeconds: indexes.builtAt ? Math.round((Date.now() - indexes.builtAt) / 1000) : null,
    india_only: true
  };
}

/** Force the registry to expire on the next read. We don't have a true delete
 *  on the cache layer, so write an empty array with a 1-second TTL — the next
 *  `getSectionSymbols` call sees the stale empty result, the factory runs,
 *  and the registry rebuilds from Dhan. Useful after a manual master update. */
export async function invalidateRegistryCache(): Promise<void> {
  const { setCache } = await import("@/lib/cache");
  await setCache(REGISTRY_CACHE_KEY, [], 1);
}
