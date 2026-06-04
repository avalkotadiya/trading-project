import type { CategoryId } from "@/lib/market-categories";
import { DHAN_DASHBOARD_INSTRUMENTS } from "@/lib/dhan-symbols";

export type PrioritizableMarketSymbol = {
  symbol: string;
  exchangeSegment?: string;
  instrument?: string;
  instrumentType?: string;
  expiry?: string | null;
  strikePrice?: number | null;
  securityId?: string;
};

const WELL_KNOWN_EXACT: Record<CategoryId, string[]> = {
  all: [
    "NIFTY",
    "BANKNIFTY",
    "SENSEX",
    "FINNIFTY",
    "MIDCPNIFTY",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "LT",
    "BHARTIARTL",
    "ITC",
    "TITAN",
    "MARUTI",
    "SUNPHARMA",
    "NIFTYBEES",
    "BANKBEES",
    "GOLDBEES",
    "USDINR",
    "EURINR",
    "GBPINR",
    "JPYINR",
    "GOLD",
    "SILVER",
    "CRUDEOIL",
    "NATURALGAS"
  ],
  indices: [
    "NIFTY",
    "BANKNIFTY",
    "SENSEX",
    "FINNIFTY",
    "MIDCPNIFTY",
    "NIFTYNXT50",
    "NIFTYIT",
    "NIFTYAUTO",
    "NIFTYPHARMA"
  ],
  "nse-eq": [
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "LT",
    "BHARTIARTL",
    "ITC",
    "TITAN",
    "MARUTI",
    "SUNPHARMA",
    "HINDUNILVR",
    "BAJFINANCE",
    "WIPRO",
    "HCLTECH",
    "TECHM",
    "TATASTEEL",
    "TATAMOTORS"
  ],
  "bse-eq": [
    "SENSEX",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK"
  ],
  futures: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "SENSEX",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "BHARTIARTL"
  ],
  options: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "SENSEX",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "BHARTIARTL"
  ],
  commodity: [
    "GOLD",
    "SILVER",
    "CRUDEOIL",
    "NATURALGAS",
    "COPPER",
    "ZINC",
    "ALUMINIUM",
    "LEAD",
    "NICKEL"
  ],
  currency: [
    "USDINR",
    "EURINR",
    "GBPINR",
    "JPYINR"
  ],
  etf: [
    "NIFTYBEES",
    "BANKBEES",
    "GOLDBEES",
    "SILVERBEES",
    "JUNIORBEES",
    "MON100",
    "SETFNIF50",
    "SETFNIFBK",
    "PSUBNKBEES",
    "CPSEETF"
  ]
};

const WELL_KNOWN_PREFIX: Record<CategoryId, string[]> = {
  all: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "SENSEX",
    "USDINR",
    "EURINR",
    "GBPINR",
    "JPYINR",
    "GOLD",
    "SILVER",
    "CRUDEOIL",
    "NATURALGAS"
  ],
  indices: ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY"],
  "nse-eq": [],
  "bse-eq": [],
  futures: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "SENSEX",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "BHARTIARTL"
  ],
  options: [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY",
    "SENSEX",
    "RELIANCE",
    "HDFCBANK",
    "ICICIBANK",
    "TCS",
    "INFY",
    "SBIN",
    "AXISBANK",
    "KOTAKBANK",
    "BHARTIARTL"
  ],
  commodity: ["GOLD", "SILVER", "CRUDEOIL", "NATURALGAS", "COPPER", "ZINC", "ALUMINIUM", "LEAD", "NICKEL"],
  currency: ["USDINR", "EURINR", "GBPINR", "JPYINR"],
  etf: ["NIFTYBEES", "BANKBEES", "GOLDBEES", "SILVERBEES", "JUNIORBEES", "MON100", "SETFNIF50", "SETFNIFBK"]
};

export const MAIN_SYMBOLS_EXACT: Record<CategoryId, readonly string[]> = {
  all: [...WELL_KNOWN_EXACT.all],
  indices: [...WELL_KNOWN_EXACT.indices],
  "nse-eq": [...WELL_KNOWN_EXACT["nse-eq"]],
  "bse-eq": [...WELL_KNOWN_EXACT["bse-eq"]],
  futures: [...WELL_KNOWN_EXACT.futures],
  options: [...WELL_KNOWN_EXACT.options],
  commodity: [...WELL_KNOWN_EXACT.commodity],
  currency: [...WELL_KNOWN_EXACT.currency],
  etf: [...WELL_KNOWN_EXACT.etf]
};

export const MAIN_SYMBOLS_PREFIX: Record<CategoryId, readonly string[]> = {
  all: [...WELL_KNOWN_PREFIX.all],
  indices: [...WELL_KNOWN_PREFIX.indices],
  "nse-eq": [...WELL_KNOWN_PREFIX["nse-eq"]],
  "bse-eq": [...WELL_KNOWN_PREFIX["bse-eq"]],
  futures: [...WELL_KNOWN_PREFIX.futures],
  options: [...WELL_KNOWN_PREFIX.options],
  commodity: [...WELL_KNOWN_PREFIX.commodity],
  currency: [...WELL_KNOWN_PREFIX.currency],
  etf: [...WELL_KNOWN_PREFIX.etf]
};

const EXACT_RANK: Record<CategoryId, Map<string, number>> = {
  all: new Map(),
  indices: new Map(),
  "nse-eq": new Map(),
  "bse-eq": new Map(),
  futures: new Map(),
  options: new Map(),
  commodity: new Map(),
  currency: new Map(),
  etf: new Map()
};

const PREFIX_RANK: Record<CategoryId, string[]> = {
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

function normalizeSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizePrioritySymbol(value: string) {
  return normalizeSymbol(value);
}

export function getMainSymbolBase(category: CategoryId, symbol: string) {
  const key = normalizeSymbol(symbol);
  const exact = EXACT_RANK[category].has(key);
  if (exact) return key;

  const prefixes = PREFIX_RANK[category];
  for (const prefix of prefixes) {
    if (prefix && key.startsWith(prefix)) return prefix;
  }

  return "";
}

const DISPLAY_NAME_BY_BASE: Record<string, string> = {
  BANKNIFTY: "Bank Nifty",
  FINNIFTY: "Fin Nifty",
  MIDCPNIFTY: "Midcap Nifty",
  NIFTY: "Nifty",
  SENSEX: "Sensex",
  USDINR: "USD/INR",
  EURINR: "EUR/INR",
  GBPINR: "GBP/INR",
  JPYINR: "JPY/INR",
  GOLD: "Gold",
  SILVER: "Silver",
  CRUDEOIL: "Crude Oil",
  NATURALGAS: "Natural Gas",
  COPPER: "Copper",
  ZINC: "Zinc",
  ALUMINIUM: "Aluminium",
  LEAD: "Lead",
  NICKEL: "Nickel"
};

export function getCanonicalDisplaySymbol(category: CategoryId, symbol: string) {
  const base = getMainSymbolBase(category, symbol);
  return base || normalizeSymbol(symbol);
}

export function getCanonicalDisplayName(category: CategoryId, symbol: string, fallbackName?: string | null) {
  const displaySymbol = getCanonicalDisplaySymbol(category, symbol);
  return DISPLAY_NAME_BY_BASE[displaySymbol] ?? fallbackName ?? displaySymbol;
}

export function isMainExactSymbol(category: CategoryId, symbol: string) {
  const key = normalizeSymbol(symbol);
  return EXACT_RANK[category].has(key);
}

export function isMainSymbolForCategory(category: CategoryId, symbol: string) {
  const key = normalizeSymbol(symbol);
  if (EXACT_RANK[category].has(key)) return true;
  return PREFIX_RANK[category].some((prefix) => prefix.length > 0 && key.startsWith(prefix));
}

for (const category of Object.keys(EXACT_RANK) as CategoryId[]) {
  for (const [index, symbol] of WELL_KNOWN_EXACT[category].entries()) {
    EXACT_RANK[category].set(normalizeSymbol(symbol), index);
  }
  PREFIX_RANK[category] = WELL_KNOWN_PREFIX[category].map(normalizeSymbol);
}

const CURATED_SYMBOL_RANK = new Map<string, number>();
for (const [index, instrument] of DHAN_DASHBOARD_INSTRUMENTS.entries()) {
  const key = normalizeSymbol(instrument.symbol);
  if (!CURATED_SYMBOL_RANK.has(key)) {
    CURATED_SYMBOL_RANK.set(key, index);
  }
}

function segmentOrder(category: CategoryId, exchangeSegment?: string) {
  if (!exchangeSegment) return 99;
  const segment = exchangeSegment.toUpperCase();
  if (category !== "all") {
    if (category === "indices") return segment === "IDX_I" ? 0 : 1;
    if (category === "nse-eq") return segment === "NSE_EQ" ? 0 : 1;
    if (category === "bse-eq") return segment === "BSE_EQ" ? 0 : 1;
    if (category === "commodity") return segment === "MCX_COMM" ? 0 : 1;
    if (category === "currency") return segment.endsWith("_CURRENCY") ? 0 : 1;
    if (category === "futures" || category === "options") return segment.includes("FNO") ? 0 : 1;
    return 0;
  }

  if (segment === "IDX_I") return 0;
  if (segment === "NSE_EQ") return 1;
  if (segment === "BSE_EQ") return 2;
  if (segment.includes("FNO")) return 3;
  if (segment === "MCX_COMM") return 4;
  if (segment.endsWith("_CURRENCY")) return 5;
  return 6;
}

function knownPriorityScore(category: CategoryId, row: PrioritizableMarketSymbol) {
  const symbol = normalizeSymbol(row.symbol || "");
  const exact = EXACT_RANK[category].get(symbol);
  if (exact !== undefined) return exact;

  const prefixes = PREFIX_RANK[category];
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index];
    if (prefix && symbol.startsWith(prefix)) {
      return 10_000 + index;
    }
  }

  const curated = CURATED_SYMBOL_RANK.get(symbol);
  if (curated !== undefined) {
    return 20_000 + curated;
  }

  return 90_000;
}

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function compareByKnownPriority(
  category: CategoryId,
  left: PrioritizableMarketSymbol,
  right: PrioritizableMarketSymbol
) {
  const leftPriority = knownPriorityScore(category, left);
  const rightPriority = knownPriorityScore(category, right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftSegmentRank = segmentOrder(category, left.exchangeSegment);
  const rightSegmentRank = segmentOrder(category, right.exchangeSegment);
  if (leftSegmentRank !== rightSegmentRank) return leftSegmentRank - rightSegmentRank;

  const leftSymbol = normalizeSymbol(left.symbol);
  const rightSymbol = normalizeSymbol(right.symbol);
  if (leftSymbol !== rightSymbol) return leftSymbol.localeCompare(rightSymbol);

  const leftExpiry = parseDateMs(left.expiry) ?? Number.MAX_SAFE_INTEGER;
  const rightExpiry = parseDateMs(right.expiry) ?? Number.MAX_SAFE_INTEGER;
  if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;

  const leftStrike = left.strikePrice ?? -1;
  const rightStrike = right.strikePrice ?? -1;
  if (leftStrike !== rightStrike) return leftStrike - rightStrike;

  const leftSecurity = left.securityId ?? "";
  const rightSecurity = right.securityId ?? "";
  return leftSecurity.localeCompare(rightSecurity);
}
