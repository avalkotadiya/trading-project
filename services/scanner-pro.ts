import { buildMarketPulseSignals } from "./market-pulse";
import type { MarketPulseCategory, StockSignal } from "@/types/market-pulse";
import type { NormalizedTick } from "@/services/market-data/market-data.types";
import type { MarketTick } from "@/types/market";

// ─── Comprehensive NSE/BSE Symbol Universe ───────────────────────────────────

const FULL_SCANNER_SYMBOLS_BY_SECTOR: Record<string, string[]> = {
  Indices: [
    "NSE:NIFTY", "NSE:BANKNIFTY", "BSE:SENSEX", "NSE:FINNIFTY",
  ],
  Financials: [
    "NSE:HDFCBANK", "NSE:ICICIBANK", "NSE:SBIN", "NSE:AXISBANK", "NSE:KOTAKBANK",
    "NSE:INDUSINDBK", "NSE:BANKBARODA", "NSE:PNB", "NSE:CANBK", "NSE:UNIONBANK",
    "NSE:IDFCFIRSTB", "NSE:FEDERALBNK", "NSE:YESBANK", "NSE:RBLBANK", "NSE:BANDHANBNK",
    "NSE:BAJFINANCE", "NSE:BAJAJFINSV", "NSE:CHOLAFIN", "NSE:MUTHOOTFIN", "NSE:MANAPPURAM",
    "NSE:LICHSGFIN", "NSE:SHRIRAMFIN", "NSE:HDFCLIFE", "NSE:SBILIFE", "NSE:ICICIPRULI",
    "NSE:SBICARD", "NSE:HDFCAMC", "NSE:NIPPONLIF",
  ],
  IT: [
    "NSE:TCS", "NSE:INFY", "NSE:WIPRO", "NSE:HCLTECH", "NSE:TECHM",
    "NSE:LTIM", "NSE:MPHASIS", "NSE:PERSISTENT", "NSE:COFORGE", "NSE:TATAELXSI",
    "NSE:OFSS", "NSE:KPITTECH", "NSE:CYIENT", "NSE:MASTEK",
  ],
  Energy: [
    "NSE:RELIANCE", "NSE:ONGC", "NSE:BPCL", "NSE:IOC", "NSE:HINDPETRO",
    "NSE:GAIL", "NSE:OIL", "NSE:IGL", "NSE:ATGL",
    "NSE:NTPC", "NSE:POWERGRID", "NSE:TATAPOWER", "NSE:SUZLON", "NSE:TORNTPOWER",
    "NSE:NHPC", "NSE:ADANIGREEN",
  ],
  Metals: [
    "NSE:TATASTEEL", "NSE:HINDALCO", "NSE:JSWSTEEL", "NSE:SAIL", "NSE:VEDL",
    "NSE:NATIONALUM", "NSE:COALINDIA", "NSE:NMDC", "NSE:JINDALSTEL", "NSE:APLAPOLLO",
    "NSE:MOIL",
  ],
  Auto: [
    "NSE:MARUTI", "NSE:TATAMOTORS", "NSE:EICHERMOT", "NSE:HEROMOTOCO", "NSE:BAJAJ-AUTO",
    "NSE:M&M", "NSE:ASHOKLEY", "NSE:TVSMOTOR", "NSE:MOTHERSON",
    "NSE:BALKRISIND", "NSE:APOLLOTYRE", "NSE:MRF", "NSE:CEAT", "NSE:BOSCHLTD", "NSE:EXIDEIND",
  ],
  FMCG: [
    "NSE:HINDUNILVR", "NSE:ITC", "NSE:NESTLEIND", "NSE:BRITANNIA", "NSE:MARICO",
    "NSE:DABUR", "NSE:COLPAL", "NSE:GODREJCP", "NSE:TATACONSUM", "NSE:VBL",
    "NSE:EMAMILTD", "NSE:UBL",
  ],
  Pharma: [
    "NSE:SUNPHARMA", "NSE:DRREDDY", "NSE:CIPLA", "NSE:DIVISLAB", "NSE:APOLLOHOSP",
    "NSE:LUPIN", "NSE:ALKEM", "NSE:TORNTPHARM", "NSE:BIOCON", "NSE:GRANULES",
    "NSE:MAXHEALTH", "NSE:FORTIS", "NSE:KIMS", "NSE:IPCALAB", "NSE:GLENMARK",
    "NSE:NATCOPHARMA", "NSE:SYNGENE",
  ],
  "Cement & Infra": [
    "NSE:LT", "NSE:ULTRACEMCO", "NSE:GRASIM", "NSE:AMBUJACEM", "NSE:ACC",
    "NSE:SHREECEM", "NSE:DALBHARAT", "NSE:JKCEMENT", "NSE:RAMCOCEM",
    "NSE:IRFC", "NSE:NBCC", "NSE:NCC", "NSE:KNRCON",
  ],
  Chemicals: [
    "NSE:PIDILITIND", "NSE:ASIANPAINT", "NSE:BERGEPAINT", "NSE:KANSAINER",
    "NSE:DEEPAKNI", "NSE:AARTIIND", "NSE:SRF", "NSE:NAVINFLUOR", "NSE:TATACHEM", "NSE:PCBL",
    "NSE:GNFC",
  ],
  "Capital Goods": [
    "NSE:SIEMENS", "NSE:ABB", "NSE:HAVELLS", "NSE:DIXON", "NSE:POLYCAB",
    "NSE:KAYNES", "NSE:KEI", "NSE:BEL", "NSE:HAL", "NSE:BHEL",
    "NSE:THERMAX", "NSE:POWERINDIA", "NSE:UNOMINDA", "NSE:CUMMINSIND",
  ],
  "Real Estate": [
    "NSE:DLF", "NSE:GODREJPROP", "NSE:OBEROIRLTY", "NSE:PHOENIXLTD",
    "NSE:PRESTIGE", "NSE:LODHA", "NSE:BRIGADE",
  ],
  Discretionary: [
    "NSE:TITAN", "NSE:TRENT", "NSE:DMART", "NSE:NAUKRI", "NSE:BATAINDIA",
    "NSE:KALYANKJIL", "NSE:ZOMATO", "NSE:NUVAMA", "NSE:PVRINOX",
    "NSE:NYKAA", "NSE:PAGEIND",
  ],
  Telecom: [
    "NSE:BHARTIARTL", "NSE:INDUSTOWER",
  ],
  Diversified: [
    "NSE:ADANIENT", "NSE:ADANIPORTS",
  ],
};

const MAX_SCANNER_SYMBOLS_PER_SECTOR = Math.max(
  2,
  Number(process.env.SCANNER_MAIN_SYMBOLS_PER_SECTOR || "4")
);

export const SCANNER_SYMBOLS_BY_SECTOR: Record<string, string[]> = Object.fromEntries(
  Object.entries(FULL_SCANNER_SYMBOLS_BY_SECTOR).map(([sector, symbols]) => [
    sector,
    symbols.slice(0, MAX_SCANNER_SYMBOLS_PER_SECTOR)
  ])
) as Record<string, string[]>;

// Flat deduplicated list of all symbols for market data subscription
export const SCANNER_PRO_SYMBOLS: string[] = [
  ...new Set(Object.values(SCANNER_SYMBOLS_BY_SECTOR).flat()),
];

// ─── Nifty 50 & Bank Nifty symbol sets ───────────────────────────────────────

export const NIFTY50_SYMBOLS = new Set([
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK", "BAJAJ-AUTO",
  "BAJFINANCE", "BAJAJFINSV", "BHARTIARTL", "BPCL", "BRITANNIA", "CIPLA",
  "COALINDIA", "DIVISLAB", "DRREDDY", "EICHERMOT", "GRASIM", "HCLTECH",
  "HDFCBANK", "HDFCLIFE", "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK",
  "INDUSINDBK", "INFY", "ITC", "JSWSTEEL", "KOTAKBANK", "LT", "LTIM",
  "MARUTI", "NESTLEIND", "NTPC", "ONGC", "POWERGRID", "RELIANCE",
  "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA", "TATACONSUM", "TATAMOTORS",
  "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT", "ULTRACEMCO", "WIPRO",
]);

export const BANK_NIFTY_SYMBOLS = new Set([
  "HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK", "KOTAKBANK",
  "INDUSINDBK", "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB", "PNB", "BANKBARODA",
]);

// ─── Beta classification (approximate) ───────────────────────────────────────

export const HIGH_BETA_SYMBOLS = new Set([
  "YESBANK", "BANDHANBNK", "RBLBANK", "IDEA", "SUZLON", "ADANIENT",
  "TATAMOTORS", "SAIL", "VEDL", "NATIONALUM", "BANKBARODA", "PNB",
  "CANBK", "UNIONBANK", "ADANIGREEN", "ZOMATO", "NYKAA",
]);

export const LOW_BETA_SYMBOLS = new Set([
  "HINDUNILVR", "NESTLEIND", "BRITANNIA", "ITC", "DABUR", "COLPAL",
  "PIDILITIND", "HDFCLIFE", "SBILIFE", "ICICIPRULI", "TCS", "INFY",
  "MARICO", "GODREJCP", "PAGEIND",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScannerBeta = "All" | "High" | "Medium" | "Low";

export type ScannerSector =
  | "All"
  | "Nifty 50"
  | "Bank Nifty"
  | "Indices"
  | "Financials"
  | "IT"
  | "Energy"
  | "Metals"
  | "Auto"
  | "FMCG"
  | "Pharma"
  | "Cement & Infra"
  | "Chemicals"
  | "Capital Goods"
  | "Real Estate"
  | "Discretionary"
  | "Telecom"
  | "Diversified";

export interface ScannerOptions {
  sector?: ScannerSector;
  beta?: ScannerBeta;
  direction?: string;
  sortBy?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ─── Signal builder ───────────────────────────────────────────────────────────

export function buildScannerSignals(
  ticks: Array<MarketTick | NormalizedTick>,
  category: MarketPulseCategory,
  options: ScannerOptions = {}
): { data: StockSignal[]; total: number } {
  const {
    sector = "All",
    beta = "All",
    direction = "all",
    sortBy = "Strongest Signal %",
    search = "",
    page = 1,
    limit = 40,
  } = options;

  // Get all signals without pagination so sector/beta filters work on full set
  const { data: all } = buildMarketPulseSignals(ticks, category, {
    segment: "All",
    direction,
    sortBy,
    search,
    page: 1,
    limit: 999,
  });

  let filtered = all;

  // Sector / index filter
  if (sector !== "All") {
    if (sector === "Nifty 50") {
      filtered = filtered.filter((s) => NIFTY50_SYMBOLS.has(s.symbol));
    } else if (sector === "Bank Nifty") {
      filtered = filtered.filter((s) => BANK_NIFTY_SYMBOLS.has(s.symbol));
    } else if (sector === "Indices") {
      filtered = filtered.filter((s) =>
        ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY"].includes(s.symbol)
      );
    } else {
      const sectorList = SCANNER_SYMBOLS_BY_SECTOR[sector];
      if (sectorList) {
        const sectorSet = new Set(sectorList.map((sym) => sym.split(":")[1]));
        filtered = filtered.filter((s) => sectorSet.has(s.symbol));
      }
    }
  }

  // Beta filter
  if (beta !== "All") {
    if (beta === "High") {
      filtered = filtered.filter((s) => HIGH_BETA_SYMBOLS.has(s.symbol));
    } else if (beta === "Low") {
      filtered = filtered.filter((s) => LOW_BETA_SYMBOLS.has(s.symbol));
    } else if (beta === "Medium") {
      filtered = filtered.filter(
        (s) => !HIGH_BETA_SYMBOLS.has(s.symbol) && !LOW_BETA_SYMBOLS.has(s.symbol)
      );
    }
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  return { data: filtered.slice(start, start + limit), total };
}
