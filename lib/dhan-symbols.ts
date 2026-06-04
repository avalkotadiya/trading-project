/**
 * Dhan curated instrument master — TRIMMED to ~60 ultra-liquid symbols.
 *
 * Three tiers:
 *   TICKER_INSTRUMENTS         — ~40 symbols shown in the horizontal live ticker.
 *   DHAN_DASHBOARD_INSTRUMENTS — ~60 curated set auto-subscribed via WebSocket.
 *   DHAN_SYMBOL_BY_SECURITY_ID — O(1) reverse map for the browser hook.
 *
 * Memory budget: each tick object is ~400 B in browser memory. 60 symbols × 1
 * cached tick = ~24 KB resident — negligible. The old 90-symbol list was also
 * fine, but trimming to a strict liquid set means the SSE batch payload is
 * smaller, the bot's buildEdge candidate pool is sharper, and the UI table
 * stays sub-50 rows by default.
 */

import type { DhanChartExchangeSegment } from "@/services/dhan/dhanChartValidation";

export type DhanUiInstrument = {
  symbol: string;
  ExchangeSegment: DhanChartExchangeSegment;
  SecurityId: string;
  exchange: "NSE" | "BSE" | "MCX";
  segment: "INDEX" | "EQ" | "FNO" | "COMM" | "CURRENCY";
  /** Human-readable name shown in UI */
  name?: string;
  /** When true this symbol appears in the horizontal live ticker */
  ticker?: boolean;
};

// ─── Indices (5) ──────────────────────────────────────────────────────────
const INDICES: DhanUiInstrument[] = [
  { symbol: "NIFTY",      ExchangeSegment: "IDX_I", SecurityId: "13", exchange: "NSE", segment: "INDEX", name: "Nifty 50",                ticker: true },
  { symbol: "BANKNIFTY",  ExchangeSegment: "IDX_I", SecurityId: "25", exchange: "NSE", segment: "INDEX", name: "Nifty Bank",              ticker: true },
  { symbol: "SENSEX",     ExchangeSegment: "IDX_I", SecurityId: "51", exchange: "BSE", segment: "INDEX", name: "BSE Sensex",              ticker: true },
  { symbol: "FINNIFTY",   ExchangeSegment: "IDX_I", SecurityId: "27", exchange: "NSE", segment: "INDEX", name: "Nifty Financial Services",ticker: true },
  { symbol: "MIDCPNIFTY", ExchangeSegment: "IDX_I", SecurityId: "26", exchange: "NSE", segment: "INDEX", name: "Nifty Midcap Select",     ticker: true },
];

// ─── Nifty 50 (50, all NSE_EQ) ────────────────────────────────────────────
// Ordered roughly by index weight + sector representation. Every one ticker-visible.
const NIFTY50: DhanUiInstrument[] = [
  // Financials
  { symbol: "HDFCBANK",   ExchangeSegment: "NSE_EQ", SecurityId: "1333",   exchange: "NSE", segment: "EQ", name: "HDFC Bank",            ticker: true },
  { symbol: "ICICIBANK",  ExchangeSegment: "NSE_EQ", SecurityId: "4963",   exchange: "NSE", segment: "EQ", name: "ICICI Bank",           ticker: true },
  { symbol: "SBIN",       ExchangeSegment: "NSE_EQ", SecurityId: "3045",   exchange: "NSE", segment: "EQ", name: "State Bank of India",  ticker: true },
  { symbol: "AXISBANK",   ExchangeSegment: "NSE_EQ", SecurityId: "5900",   exchange: "NSE", segment: "EQ", name: "Axis Bank",            ticker: true },
  { symbol: "KOTAKBANK",  ExchangeSegment: "NSE_EQ", SecurityId: "1922",   exchange: "NSE", segment: "EQ", name: "Kotak Mahindra Bank",  ticker: true },
  { symbol: "BAJFINANCE", ExchangeSegment: "NSE_EQ", SecurityId: "317",    exchange: "NSE", segment: "EQ", name: "Bajaj Finance",        ticker: true },
  { symbol: "BAJAJFINSV", ExchangeSegment: "NSE_EQ", SecurityId: "16675",  exchange: "NSE", segment: "EQ", name: "Bajaj Finserv",        ticker: true },
  { symbol: "HDFCLIFE",   ExchangeSegment: "NSE_EQ", SecurityId: "119995", exchange: "NSE", segment: "EQ", name: "HDFC Life Insurance",  ticker: true },
  { symbol: "SBILIFE",    ExchangeSegment: "NSE_EQ", SecurityId: "21808",  exchange: "NSE", segment: "EQ", name: "SBI Life Insurance",   ticker: true },
  { symbol: "INDUSINDBK", ExchangeSegment: "NSE_EQ", SecurityId: "5258",   exchange: "NSE", segment: "EQ", name: "IndusInd Bank",        ticker: true },
  { symbol: "SHRIRAMFIN", ExchangeSegment: "NSE_EQ", SecurityId: "4306",   exchange: "NSE", segment: "EQ", name: "Shriram Finance",      ticker: false },
  // IT
  { symbol: "TCS",        ExchangeSegment: "NSE_EQ", SecurityId: "11536",  exchange: "NSE", segment: "EQ", name: "Tata Consultancy Svcs",ticker: true },
  { symbol: "INFY",       ExchangeSegment: "NSE_EQ", SecurityId: "1594",   exchange: "NSE", segment: "EQ", name: "Infosys",              ticker: true },
  { symbol: "HCLTECH",    ExchangeSegment: "NSE_EQ", SecurityId: "7229",   exchange: "NSE", segment: "EQ", name: "HCL Technologies",     ticker: true },
  { symbol: "WIPRO",      ExchangeSegment: "NSE_EQ", SecurityId: "3787",   exchange: "NSE", segment: "EQ", name: "Wipro",                ticker: true },
  { symbol: "TECHM",      ExchangeSegment: "NSE_EQ", SecurityId: "13538",  exchange: "NSE", segment: "EQ", name: "Tech Mahindra",        ticker: true },
  { symbol: "LTIM",       ExchangeSegment: "NSE_EQ", SecurityId: "17818",  exchange: "NSE", segment: "EQ", name: "LTIMindtree",          ticker: false },
  // Energy
  { symbol: "RELIANCE",   ExchangeSegment: "NSE_EQ", SecurityId: "2885",   exchange: "NSE", segment: "EQ", name: "Reliance Industries",  ticker: true },
  { symbol: "ONGC",       ExchangeSegment: "NSE_EQ", SecurityId: "2475",   exchange: "NSE", segment: "EQ", name: "ONGC",                 ticker: true },
  { symbol: "NTPC",       ExchangeSegment: "NSE_EQ", SecurityId: "11630",  exchange: "NSE", segment: "EQ", name: "NTPC",                 ticker: true },
  { symbol: "POWERGRID",  ExchangeSegment: "NSE_EQ", SecurityId: "14977",  exchange: "NSE", segment: "EQ", name: "Power Grid Corp",      ticker: true },
  { symbol: "COALINDIA",  ExchangeSegment: "NSE_EQ", SecurityId: "20374",  exchange: "NSE", segment: "EQ", name: "Coal India",           ticker: false },
  { symbol: "BPCL",       ExchangeSegment: "NSE_EQ", SecurityId: "526",    exchange: "NSE", segment: "EQ", name: "Bharat Petroleum",     ticker: false },
  // Metals
  { symbol: "TATASTEEL",  ExchangeSegment: "NSE_EQ", SecurityId: "3499",   exchange: "NSE", segment: "EQ", name: "Tata Steel",           ticker: true },
  { symbol: "HINDALCO",   ExchangeSegment: "NSE_EQ", SecurityId: "1363",   exchange: "NSE", segment: "EQ", name: "Hindalco Industries",  ticker: true },
  { symbol: "JSWSTEEL",   ExchangeSegment: "NSE_EQ", SecurityId: "11723",  exchange: "NSE", segment: "EQ", name: "JSW Steel",            ticker: true },
  // FMCG / Consumer
  { symbol: "ITC",        ExchangeSegment: "NSE_EQ", SecurityId: "1660",   exchange: "NSE", segment: "EQ", name: "ITC",                  ticker: true },
  { symbol: "HINDUNILVR", ExchangeSegment: "NSE_EQ", SecurityId: "1394",   exchange: "NSE", segment: "EQ", name: "Hindustan Unilever",   ticker: true },
  { symbol: "NESTLEIND",  ExchangeSegment: "NSE_EQ", SecurityId: "17963",  exchange: "NSE", segment: "EQ", name: "Nestle India",         ticker: true },
  { symbol: "BRITANNIA",  ExchangeSegment: "NSE_EQ", SecurityId: "547",    exchange: "NSE", segment: "EQ", name: "Britannia Industries", ticker: false },
  { symbol: "TATACONSUM", ExchangeSegment: "NSE_EQ", SecurityId: "3432",   exchange: "NSE", segment: "EQ", name: "Tata Consumer",        ticker: false },
  // Auto
  { symbol: "MARUTI",     ExchangeSegment: "NSE_EQ", SecurityId: "10999",  exchange: "NSE", segment: "EQ", name: "Maruti Suzuki",        ticker: true },
  { symbol: "TATAMOTORS", ExchangeSegment: "NSE_EQ", SecurityId: "3456",   exchange: "NSE", segment: "EQ", name: "Tata Motors",          ticker: true },
  { symbol: "M&M",        ExchangeSegment: "NSE_EQ", SecurityId: "2031",   exchange: "NSE", segment: "EQ", name: "Mahindra & Mahindra",  ticker: true },
  { symbol: "EICHERMOT",  ExchangeSegment: "NSE_EQ", SecurityId: "910",    exchange: "NSE", segment: "EQ", name: "Eicher Motors",        ticker: false },
  { symbol: "HEROMOTOCO", ExchangeSegment: "NSE_EQ", SecurityId: "1348",   exchange: "NSE", segment: "EQ", name: "Hero MotoCorp",        ticker: false },
  // Pharma
  { symbol: "SUNPHARMA",  ExchangeSegment: "NSE_EQ", SecurityId: "3351",   exchange: "NSE", segment: "EQ", name: "Sun Pharmaceutical",   ticker: true },
  { symbol: "DRREDDY",    ExchangeSegment: "NSE_EQ", SecurityId: "881",    exchange: "NSE", segment: "EQ", name: "Dr. Reddy's Labs",     ticker: true },
  { symbol: "CIPLA",      ExchangeSegment: "NSE_EQ", SecurityId: "694",    exchange: "NSE", segment: "EQ", name: "Cipla",                ticker: true },
  { symbol: "DIVISLAB",   ExchangeSegment: "NSE_EQ", SecurityId: "10940",  exchange: "NSE", segment: "EQ", name: "Divi's Laboratories",  ticker: false },
  { symbol: "APOLLOHOSP", ExchangeSegment: "NSE_EQ", SecurityId: "157",    exchange: "NSE", segment: "EQ", name: "Apollo Hospitals",     ticker: false },
  // Infra / Telecom
  { symbol: "LT",         ExchangeSegment: "NSE_EQ", SecurityId: "11483",  exchange: "NSE", segment: "EQ", name: "Larsen & Toubro",      ticker: true },
  { symbol: "BHARTIARTL", ExchangeSegment: "NSE_EQ", SecurityId: "10604",  exchange: "NSE", segment: "EQ", name: "Bharti Airtel",        ticker: true },
  // Cement
  { symbol: "ULTRACEMCO", ExchangeSegment: "NSE_EQ", SecurityId: "3812",   exchange: "NSE", segment: "EQ", name: "UltraTech Cement",     ticker: false },
  { symbol: "GRASIM",     ExchangeSegment: "NSE_EQ", SecurityId: "1232",   exchange: "NSE", segment: "EQ", name: "Grasim Industries",    ticker: false },
  // Conglomerate
  { symbol: "TITAN",      ExchangeSegment: "NSE_EQ", SecurityId: "3506",   exchange: "NSE", segment: "EQ", name: "Titan Company",        ticker: true },
  { symbol: "ADANIENT",   ExchangeSegment: "NSE_EQ", SecurityId: "25214",  exchange: "NSE", segment: "EQ", name: "Adani Enterprises",    ticker: true },
  { symbol: "ADANIPORTS", ExchangeSegment: "NSE_EQ", SecurityId: "15083",  exchange: "NSE", segment: "EQ", name: "Adani Ports",          ticker: false },
  { symbol: "ASIANPAINT", ExchangeSegment: "NSE_EQ", SecurityId: "236",    exchange: "NSE", segment: "EQ", name: "Asian Paints",         ticker: false },
  { symbol: "TRENT",      ExchangeSegment: "NSE_EQ", SecurityId: "3507",   exchange: "NSE", segment: "EQ", name: "Trent",                ticker: false },
];

// ─── ETFs (4) ─────────────────────────────────────────────────────────────
const ETFS: DhanUiInstrument[] = [
  { symbol: "NIFTYBEES",  ExchangeSegment: "NSE_EQ", SecurityId: "11915", exchange: "NSE", segment: "EQ", name: "Nippon Nifty BeES",  ticker: false },
  { symbol: "BANKBEES",   ExchangeSegment: "NSE_EQ", SecurityId: "7113",  exchange: "NSE", segment: "EQ", name: "Nippon Bank BeES",   ticker: false },
  { symbol: "GOLDBEES",   ExchangeSegment: "NSE_EQ", SecurityId: "11707", exchange: "NSE", segment: "EQ", name: "Nippon Gold BeES",   ticker: false },
  { symbol: "JUNIORBEES", ExchangeSegment: "NSE_EQ", SecurityId: "2177",  exchange: "NSE", segment: "EQ", name: "Nippon Junior BeES", ticker: false },
];

// ─── Combined curated master (~59 symbols) ────────────────────────────────
export const DHAN_DASHBOARD_INSTRUMENTS: DhanUiInstrument[] = [
  ...INDICES,
  ...NIFTY50,
  ...ETFS,
];

/** Live-ticker subset — `ticker: true` only. Stable, bounded DOM. */
export const TICKER_INSTRUMENTS: DhanUiInstrument[] = DHAN_DASHBOARD_INSTRUMENTS.filter(
  (inst) => inst.ticker === true
);

/** O(1) reverse map for the browser hook. */
export const DHAN_SYMBOL_BY_SECURITY_ID: Record<string, DhanUiInstrument> = Object.fromEntries(
  DHAN_DASHBOARD_INSTRUMENTS.map((item) => [item.SecurityId, item])
);

/**
 * Resolve the Dhan exchange-segment + security-id for any MarketSymbol.
 * Used by orders/portfolio flows that have a generic MarketSymbol shape.
 */
export function resolveDhanInstrumentForMarketSymbol(input: {
  exchange: "NSE" | "BSE" | "MCX";
  segment: "EQ" | "FNO" | "INDEX" | "COMM" | "CURRENCY";
  symbol: string;
  instrumentToken: string;
  exchangeSegment?: string | null;
  bseScripCode?: string | null;
}): { ExchangeSegment: string; SecurityId: string } | null {
  const known = DHAN_DASHBOARD_INSTRUMENTS.find(
    (item) => item.symbol === input.symbol && item.exchange === input.exchange
  );
  if (known) {
    return { ExchangeSegment: known.ExchangeSegment, SecurityId: known.SecurityId };
  }
  if (input.exchange === "BSE" && input.bseScripCode) {
    return { ExchangeSegment: "BSE_EQ" as const, SecurityId: input.bseScripCode };
  }
  const tokenLikeId = input.instrumentToken.match(/\d+/)?.[0];
  if (tokenLikeId) {
    if (input.exchangeSegment) {
      return { ExchangeSegment: input.exchangeSegment, SecurityId: tokenLikeId };
    }
    return {
      ExchangeSegment:
        input.segment === "INDEX"
          ? ("IDX_I" as const)
          : input.segment === "COMM"
            ? ("MCX_COMM" as const)
            : input.segment === "CURRENCY"
              ? (`${input.exchange}_CURRENCY` as const)
              : input.segment === "FNO"
                ? (`${input.exchange}_FNO` as const)
                : (`${input.exchange}_EQ` as const),
      SecurityId: tokenLikeId
    };
  }
  return null;
}
