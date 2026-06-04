/**
 * Symbol → NSE sector mapping for the curated DHAN_DASHBOARD_INSTRUMENTS
 * universe. Used by the bot's sector-exposure cap so it doesn't concentrate
 * the wallet in a single industry.
 *
 * Keep this in sync with DHAN_DASHBOARD_INSTRUMENTS in lib/dhan-symbols.ts.
 * Anything not in the map is treated as "Misc" so it neither inflates nor
 * deflates a sector's exposure count.
 */

export type Sector =
  | "Financials"
  | "IT"
  | "Energy"
  | "Metals"
  | "FMCG"
  | "Auto"
  | "Pharma"
  | "Infra"
  | "Telecom"
  | "Materials"
  | "Consumer"
  | "ETF"
  | "Index"
  | "Misc";

const SECTOR_BY_SYMBOL: Record<string, Sector> = {
  // Banking & Financial Services
  HDFCBANK: "Financials",
  ICICIBANK: "Financials",
  SBIN: "Financials",
  AXISBANK: "Financials",
  KOTAKBANK: "Financials",
  BAJFINANCE: "Financials",
  BAJAJFINSV: "Financials",
  HDFCLIFE: "Financials",
  SBILIFE: "Financials",
  INDUSINDBK: "Financials",
  SHRIRAMFIN: "Financials",

  // IT
  TCS: "IT",
  INFY: "IT",
  HCLTECH: "IT",
  WIPRO: "IT",
  TECHM: "IT",
  LTIM: "IT",

  // Energy / Oil & Gas / Power
  RELIANCE: "Energy",
  ONGC: "Energy",
  NTPC: "Energy",
  POWERGRID: "Energy",
  COALINDIA: "Energy",
  BPCL: "Energy",

  // Metals & Mining
  TATASTEEL: "Metals",
  HINDALCO: "Metals",
  JSWSTEEL: "Metals",

  // FMCG / Consumer Staples
  ITC: "FMCG",
  HINDUNILVR: "FMCG",
  NESTLEIND: "FMCG",
  BRITANNIA: "FMCG",
  TATACONSUM: "FMCG",

  // Auto
  MARUTI: "Auto",
  TATAMOTORS: "Auto",
  "M&M": "Auto",
  EICHERMOT: "Auto",
  HEROMOTOCO: "Auto",

  // Pharma & Healthcare
  SUNPHARMA: "Pharma",
  DRREDDY: "Pharma",
  CIPLA: "Pharma",
  DIVISLAB: "Pharma",
  APOLLOHOSP: "Pharma",

  // Infra / Construction
  LT: "Infra",

  // Telecom
  BHARTIARTL: "Telecom",

  // Materials / Cement
  ULTRACEMCO: "Materials",
  GRASIM: "Materials",

  // Consumer / Retail / Misc
  TITAN: "Consumer",
  ADANIENT: "Consumer",
  ADANIPORTS: "Consumer",
  ASIANPAINT: "Consumer",
  TRENT: "Consumer",

  // ETFs
  NIFTYBEES: "ETF",
  BANKBEES: "ETF",
  GOLDBEES: "ETF",
  JUNIORBEES: "ETF",

  // Indices (the bot never trades these but include for completeness)
  NIFTY: "Index",
  BANKNIFTY: "Index",
  SENSEX: "Index",
  FINNIFTY: "Index",
  MIDCPNIFTY: "Index"
};

export function getSector(symbol: string): Sector {
  return SECTOR_BY_SYMBOL[symbol.toUpperCase()] ?? "Misc";
}
