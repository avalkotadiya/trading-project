import { MARKET_CATEGORIES, type CategoryId } from "@/lib/market-categories";
import {
  MAIN_SYMBOLS_PREFIX,
  compareByKnownPriority,
  getCanonicalDisplayName,
  getCanonicalDisplaySymbol,
  isMainSymbolForCategory,
  normalizePrioritySymbol
} from "@/lib/live-market-priority";
import { getDhanInstrumentMaster, type DhanInstrumentSearchResult } from "@/services/dhan/dhanInstruments";
import { normalizeDhanChartInstrument } from "@/services/dhan/dhanChartValidation";

export type LiveMarketCategoryMeta = {
  id: CategoryId;
  label: string;
  description: string;
  count: number;
};

export type LiveMarketCategoryRow = {
  symbol: string;
  tradingSymbol: string;
  name: string;
  exchange: "NSE" | "BSE" | "MCX";
  segment: string;
  exchangeSegment: string;
  securityId: string;
  instrument: string;
  instrumentType: string;
  chartInstrument: string;
  requestCode: 15 | 17 | 21;
  isin?: string | null;
  lotSize?: number | null;
  expiry?: string | null;
  strikePrice?: number | null;
  optionType?: string | null;
  series?: string | null;
};

export type LiveMarketCategoryQuery = {
  category: CategoryId;
  query?: string;
  limit: number;
  offset: number;
};

export type LiveMarketCategoryResult = {
  category: CategoryId;
  categories: LiveMarketCategoryMeta[];
  total: number;
  offset: number;
  limit: number;
  symbols: LiveMarketCategoryRow[];
};

type UniverseIndexes = {
  builtAt: number;
  categories: LiveMarketCategoryMeta[];
  byCategory: Record<CategoryId, LiveMarketCategoryRow[]>;
};

const SUPPORTED_SEGMENTS = new Set(
  MARKET_CATEGORIES.flatMap((category) => category.segments)
);

const DERIVATIVE_GRACE_MS = 24 * 60 * 60 * 1000;
const UNIVERSE_TTL_MS = Math.max(
  60_000,
  Number(process.env.DHAN_LIVE_UNIVERSE_TTL_MS || "900000")
);

let universeCache: UniverseIndexes | null = null;
let universePromise: Promise<UniverseIndexes> | null = null;

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toInstrumentType(row: DhanInstrumentSearchResult) {
  return (row.exchInstrumentType || row.instrument || "").toUpperCase();
}

function isIndexRow(row: DhanInstrumentSearchResult) {
  const instType = toInstrumentType(row);
  const inst = row.instrument.toUpperCase();
  return row.exchangeSegment === "IDX_I" || instType === "IDX" || inst === "INDEX";
}

function isFutureRow(row: DhanInstrumentSearchResult) {
  const instType = toInstrumentType(row);
  const inst = row.instrument.toUpperCase();
  return instType.startsWith("FUT") || inst.startsWith("FUT");
}

function isOptionRow(row: DhanInstrumentSearchResult) {
  const instType = toInstrumentType(row);
  const inst = row.instrument.toUpperCase();
  return instType.startsWith("OPT") || inst.startsWith("OPT");
}

function isEtfRow(row: DhanInstrumentSearchResult) {
  const instType = toInstrumentType(row);
  const inst = row.instrument.toUpperCase();
  return instType === "ETF" || inst === "ETF";
}

function isExpiredDerivative(row: DhanInstrumentSearchResult) {
  if (!isFutureRow(row) && !isOptionRow(row)) return false;
  const expiryMs = parseDateMs(row.expiry);
  if (expiryMs === null) return false;
  return expiryMs < Date.now() - DERIVATIVE_GRACE_MS;
}

function toRequestCode(row: DhanInstrumentSearchResult): 15 | 17 | 21 {
  // DhanHQ feed docs:
  // 15 = Ticker packet, 17 = Quote packet, 21 = Full packet.
  // We use 15 for index rows and 17 for all others to keep throughput high.
  return isIndexRow(row) ? 15 : 17;
}

function displayCategoryOf(row: DhanInstrumentSearchResult): CategoryId | null {
  if (row.exchangeSegment === "MCX_COMM") return "commodity";
  if (row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY") return "currency";
  if (isOptionRow(row)) return "options";
  if (isFutureRow(row)) return "futures";
  if (isIndexRow(row)) return "indices";
  return null;
}

function normalizeSymbol(row: DhanInstrumentSearchResult) {
  const base = row.symbol || row.tradingSymbol || row.name || "";
  return base.replace(/\s+/g, "").toUpperCase();
}

function toCategoryIds(row: DhanInstrumentSearchResult): CategoryId[] {
  const categories: CategoryId[] = ["all"];
  if (isIndexRow(row)) categories.push("indices");
  if (row.exchangeSegment === "NSE_EQ") categories.push("nse-eq");
  if (row.exchangeSegment === "BSE_EQ") categories.push("bse-eq");
  if (isFutureRow(row)) categories.push("futures");
  if (isOptionRow(row)) categories.push("options");
  if (row.exchangeSegment === "MCX_COMM") categories.push("commodity");
  if (row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY") {
    categories.push("currency");
  }
  if (isEtfRow(row)) categories.push("etf");
  return Array.from(new Set(categories));
}

function buildRow(row: DhanInstrumentSearchResult): LiveMarketCategoryRow {
  const rawSymbol = normalizeSymbol(row);
  const displayCategory = displayCategoryOf(row);

  // Display rule:
  //   - Indices: keep each variant distinct ("NIFTY", "NIFTYBANK", "NIFTYIT", ...).
  //     getCanonicalDisplaySymbol("indices", "NIFTYBANK") greedy-prefix-matches to
  //     "NIFTY" and would make every Nifty-prefixed index render as "NIFTY".
  //   - Options: append strike + side ("NIFTY 18500 CE") — trimContractRows keeps
  //     one CE + one PE per base; if both displayed as just "NIFTY" the rows look
  //     duplicated. Strike/side disambiguates them.
  //   - ETFs: displayCategoryOf returns null for NSE_EQ/BSE_EQ so rawSymbol is
  //     already used; no change needed.
  //   - Futures/commodity/currency: canonical collapse + trimContractRows leaves
  //     exactly one row per underlying, so the canonical name is fine.
  let displaySymbol: string;
  let displayName: string;

  if (displayCategory === "options") {
    const base = getCanonicalDisplaySymbol("options", rawSymbol);
    const strike =
      typeof row.strikePrice === "number" && Number.isFinite(row.strikePrice) && row.strikePrice > 0
        ? String(Math.round(row.strikePrice))
        : "";
    const side = (row.optionType ?? "").toUpperCase()
      .replace(/^CALL$/, "CE")
      .replace(/^PUT$/, "PE");
    displaySymbol = [base, strike, side].filter(Boolean).join(" ") || rawSymbol;
    displayName = getCanonicalDisplayName("options", rawSymbol, row.name || row.tradingSymbol || rawSymbol);
  } else if (displayCategory === "indices") {
    displaySymbol = rawSymbol;
    displayName = row.name || row.tradingSymbol || rawSymbol;
  } else if (displayCategory) {
    displaySymbol = getCanonicalDisplaySymbol(displayCategory, rawSymbol);
    displayName = getCanonicalDisplayName(displayCategory, rawSymbol, row.name || row.tradingSymbol || rawSymbol);
  } else {
    displaySymbol = rawSymbol;
    displayName = row.name || row.tradingSymbol || rawSymbol;
  }

  return {
    symbol: displaySymbol,
    tradingSymbol: row.tradingSymbol,
    name: displayName,
    exchange: row.exchange,
    segment: row.segment,
    exchangeSegment: row.exchangeSegment,
    securityId: row.securityId,
    instrument: row.instrument.toUpperCase(),
    instrumentType: toInstrumentType(row),
    chartInstrument: normalizeDhanChartInstrument(row.instrument, row.exchangeSegment),
    requestCode: toRequestCode(row),
    isin: row.isin,
    lotSize: row.lotSize,
    expiry: row.expiry,
    strikePrice: row.strikePrice,
    optionType: row.optionType,
    series: row.series
  };
}

function matchesQuery(row: LiveMarketCategoryRow, query: string) {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return true;
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
    .some((field) => String(field).toUpperCase().includes(normalized));
}

function detectOptionSide(row: LiveMarketCategoryRow) {
  const direct = (row.optionType ?? "").toUpperCase();
  if (direct === "CE" || direct === "CALL") return "CE";
  if (direct === "PE" || direct === "PUT") return "PE";
  const symbol = row.symbol.toUpperCase();
  if (symbol.endsWith("CE") || symbol.endsWith("CALL")) return "CE";
  if (symbol.endsWith("PE") || symbol.endsWith("PUT")) return "PE";
  return "";
}

function extractMainBase(category: CategoryId, symbol: string) {
  const normalized = normalizePrioritySymbol(symbol);
  const prefixes = MAIN_SYMBOLS_PREFIX[category].map((item) => normalizePrioritySymbol(item));
  for (const prefix of prefixes) {
    if (prefix && normalized.startsWith(prefix)) return prefix;
  }
  return "";
}

function trimContractRows(category: CategoryId, rows: LiveMarketCategoryRow[]) {
  if (!["all", "futures", "options", "commodity", "currency"].includes(category)) {
    return rows;
  }

  const kept: LiveMarketCategoryRow[] = [];
  const seenFutures = new Set<string>();
  const seenCommodityCurrency = new Set<string>();
  const optionSides = new Map<string, Set<string>>();

  for (const row of rows) {
    const instrument = `${row.instrumentType}|${row.instrument}`.toUpperCase();
    const isOption = instrument.includes("OPT");
    const isFuture = instrument.includes("FUT");
    const isCommodity = row.exchangeSegment === "MCX_COMM";
    const isCurrency = row.exchangeSegment === "NSE_CURRENCY" || row.exchangeSegment === "BSE_CURRENCY";

    if (category === "all" && !(isOption || isFuture || isCommodity || isCurrency)) {
      kept.push(row);
      continue;
    }

    const baseCategory: CategoryId =
      category === "all"
        ? isCommodity
          ? "commodity"
          : isCurrency
            ? "currency"
            : isOption
              ? "options"
              : "futures"
        : category;

    const base = extractMainBase(baseCategory, row.symbol);
    if (!base) {
      if (category === "all") kept.push(row);
      continue;
    }

    if (baseCategory === "options") {
      const side = detectOptionSide(row);
      const set = optionSides.get(base) ?? new Set<string>();
      if (side && set.has(side)) continue;
      if (!side && set.size >= 2) continue;
      if (side) set.add(side);
      optionSides.set(base, set);
      kept.push(row);
      continue;
    }

    if (baseCategory === "futures") {
      if (seenFutures.has(base)) continue;
      seenFutures.add(base);
      kept.push(row);
      continue;
    }

    // commodity / currency: keep one nearest contract per underlying base.
    if (seenCommodityCurrency.has(base)) continue;
    seenCommodityCurrency.add(base);
    kept.push(row);
  }

  return kept;
}

async function buildUniverse(): Promise<UniverseIndexes> {
  const master = await getDhanInstrumentMaster();
  const byCategory: Record<CategoryId, LiveMarketCategoryRow[]> = {
    all: [],
    indices: [],
    "nse-eq": [],
    "bse-eq": [],
    futures: [],
    options: [],
    commodity: [],
    currency: [],
    etf: []
  };

  const seenByCategory = new Map<CategoryId, Set<string>>();
  (Object.keys(byCategory) as CategoryId[]).forEach((category) => {
    seenByCategory.set(category, new Set<string>());
  });

  for (const row of master) {
    if (!SUPPORTED_SEGMENTS.has(row.exchangeSegment)) continue;
    if (!row.securityId || !row.tradingSymbol) continue;
    if (isExpiredDerivative(row)) continue;

    const normalizedSymbol = normalizeSymbol(row);
    if (!normalizedSymbol) continue;

    const built = buildRow(row);
    const categories = toCategoryIds(row);
    const mainCategories = categories
      .filter((category) => category !== "all")
      .filter((category) => isMainSymbolForCategory(category, built.symbol));
    if (mainCategories.length === 0) continue;
    const dedupeKey = `${built.exchangeSegment}:${built.securityId}`;

    for (const category of ["all", ...mainCategories] as CategoryId[]) {
      const seen = seenByCategory.get(category);
      if (!seen || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      byCategory[category].push(built);
    }
  }

  (Object.keys(byCategory) as CategoryId[]).forEach((category) => {
    byCategory[category].sort((left, right) => compareByKnownPriority(category, left, right));
    // Defensive: two distinct securityIds can still produce identical visible
    // labels (master quality issues, dual listings, prefix collisions we missed).
    // Sort already placed the higher-priority row first, so keep that one.
    const seenDisplay = new Set<string>();
    byCategory[category] = byCategory[category].filter((row) => {
      const key = `${row.exchangeSegment}:${row.symbol}`;
      if (seenDisplay.has(key)) return false;
      seenDisplay.add(key);
      return true;
    });
    byCategory[category] = trimContractRows(category, byCategory[category]);
  });

  const categories: LiveMarketCategoryMeta[] = MARKET_CATEGORIES.map((meta) => ({
    id: meta.id,
    label: meta.label,
    description: meta.description,
    count: byCategory[meta.id].length
  }));

  return {
    builtAt: Date.now(),
    categories,
    byCategory
  };
}

async function getUniverseIndexes() {
  if (universeCache && Date.now() - universeCache.builtAt < UNIVERSE_TTL_MS) {
    return universeCache;
  }

  if (!universePromise) {
    universePromise = buildUniverse()
      .then((indexes) => {
        universeCache = indexes;
        return indexes;
      })
      .finally(() => {
        universePromise = null;
      });
  }

  return universePromise;
}

export async function queryLiveMarketCategory(params: LiveMarketCategoryQuery): Promise<LiveMarketCategoryResult> {
  const indexes = await getUniverseIndexes();
  const rows = indexes.byCategory[params.category] ?? [];
  const filtered = params.query ? rows.filter((row) => matchesQuery(row, params.query ?? "")) : rows;
  const offset = Math.max(0, params.offset);
  const limit = Math.max(1, params.limit);
  return {
    category: params.category,
    categories: indexes.categories,
    total: filtered.length,
    offset,
    limit,
    symbols: filtered.slice(offset, offset + limit)
  };
}
