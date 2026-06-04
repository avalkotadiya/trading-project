import { DHAN_CHART_EXCHANGE_SEGMENTS } from "@/services/dhan/dhanChartValidation";

export type CategoryId =
  | "all"
  | "indices"
  | "nse-eq"
  | "bse-eq"
  | "futures"
  | "options"
  | "commodity"
  | "currency"
  | "etf";

export type MarketCategory = {
  id: CategoryId;
  label: string;
  description: string;
  segments: string[];
  instrumentTypes?: string[];
};

export const MARKET_CATEGORIES: MarketCategory[] = [
  {
    id: "all",
    label: "All",
    description: "All instruments across every segment",
    segments: [...DHAN_CHART_EXCHANGE_SEGMENTS]
  },
  {
    id: "indices",
    label: "Indices",
    description: "Indian market indices — Nifty, Sensex, Bank Nifty, Nifty IT, etc.",
    segments: ["IDX_I"]
  },
  {
    id: "nse-eq",
    label: "NSE Equity",
    description: "National Stock Exchange listed equities",
    segments: ["NSE_EQ"]
  },
  {
    id: "bse-eq",
    label: "BSE Equity",
    description: "Bombay Stock Exchange listed equities",
    segments: ["BSE_EQ"]
  },
  {
    id: "futures",
    label: "Futures",
    description: "NSE and BSE stock and index futures contracts",
    segments: ["NSE_FNO", "BSE_FNO"],
    instrumentTypes: ["FUTSTK", "FUTIDX", "FUTCOM", "FUTCUR"]
  },
  {
    id: "options",
    label: "Options",
    description: "NSE and BSE stock and index options contracts",
    segments: ["NSE_FNO", "BSE_FNO"],
    instrumentTypes: ["OPTSTK", "OPTIDX", "OPTFUT", "OPTCUR"]
  },
  {
    id: "commodity",
    label: "Commodity",
    description: "MCX commodity instruments — Gold, Silver, Crude Oil, Natural Gas, etc.",
    segments: ["MCX_COMM"]
  },
  {
    id: "currency",
    label: "Currency",
    description: "NSE and BSE currency derivatives — USD/INR, EUR/INR, GBP/INR, etc.",
    segments: ["NSE_CURRENCY", "BSE_CURRENCY"]
  },
  {
    id: "etf",
    label: "ETF",
    description: "Exchange Traded Funds listed on NSE and BSE",
    segments: ["NSE_EQ", "BSE_EQ"],
    instrumentTypes: ["ETF", "EQUITY"]
  }
];

export function getCategoryById(id: string): MarketCategory | undefined {
  return MARKET_CATEGORIES.find((c) => c.id === id);
}

export const SEGMENT_LABELS: Record<string, string> = {
  NSE_EQ: "NSE EQ",
  BSE_EQ: "BSE EQ",
  IDX_I: "INDEX",
  NSE_FNO: "NSE F&O",
  BSE_FNO: "BSE F&O",
  MCX_COMM: "MCX",
  NSE_CURRENCY: "NSE CUR",
  BSE_CURRENCY: "BSE CUR"
};

export const SEGMENT_COLORS: Record<string, string> = {
  NSE_EQ: "text-blue-400",
  BSE_EQ: "text-violet-400",
  IDX_I: "text-yellow-400",
  NSE_FNO: "text-orange-400",
  BSE_FNO: "text-amber-400",
  MCX_COMM: "text-emerald-400",
  NSE_CURRENCY: "text-pink-400",
  BSE_CURRENCY: "text-rose-400"
};

export const SEGMENT_BG: Record<string, string> = {
  NSE_EQ: "bg-blue-400/10",
  BSE_EQ: "bg-violet-400/10",
  IDX_I: "bg-yellow-400/10",
  NSE_FNO: "bg-orange-400/10",
  BSE_FNO: "bg-amber-400/10",
  MCX_COMM: "bg-emerald-400/10",
  NSE_CURRENCY: "bg-pink-400/10",
  BSE_CURRENCY: "bg-rose-400/10"
};

// Map an exchangeSegment to the TradingView exchange prefix used in chart URLs.
export function segmentToTvExchange(exchangeSegment: string, symbol: string): string {
  if (exchangeSegment === "BSE_EQ" || exchangeSegment === "BSE_FNO" || exchangeSegment === "BSE_CURRENCY") {
    return `BSE:${symbol}`;
  }
  if (exchangeSegment === "MCX_COMM") {
    return `MCX:${symbol}`;
  }
  return `NSE:${symbol}`;
}
