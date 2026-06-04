export type MarketExchange = "NSE" | "BSE" | "MCX";
export type MarketSegment = "EQ" | "FNO" | "INDEX" | "COMM" | "CURRENCY";
export type MarketOptionType = "CE" | "PE";
export type MarketDataProviderKey = "dhan";
export type ProviderConnectionStatus = "connected" | "connecting" | "disconnected" | "degraded" | "error";
export type MarketSessionState = "open" | "closed" | "preopen" | "postclose";

export type MarketSymbol = {
  exchange: MarketExchange;
  segment: MarketSegment;
  symbol: string;
  instrumentToken: string;
  exchangeSegment?: string | null;
  instrument?: string | null;
  instrumentType?: string | null;
  chartInstrument?: string | null;
  tradingSymbol?: string | null;
  bseScripCode?: string | null;
  isin?: string | null;
  companyName?: string | null;
  lotSize?: number | null;
  expiry?: string | null;
  strikePrice?: number | null;
  optionType?: MarketOptionType | null;
};

export type NormalizedTick = {
  exchange: MarketExchange;
  segment: MarketSegment;
  symbol: string;
  instrumentToken: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  averageTradedPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  lastTradedQuantity?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
  openInterest?: number;
  timestamp: string;
  source: string;
};

export type MarketSnapshot = NormalizedTick & {
  marketStatus: MarketSessionState;
  companyName?: string | null;
};

export type ProviderHealth = {
  provider: MarketDataProviderKey;
  status: ProviderConnectionStatus;
  checkedAt: string;
  latencyMs?: number;
  message?: string;
  marketStatus?: MarketSessionState;
  circuitBreakerOpen?: boolean;
};

export interface MarketDataProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: MarketSymbol[]): Promise<void>;
  unsubscribe(symbols: MarketSymbol[]): Promise<void>;
  onTick(callback: (tick: NormalizedTick) => void): void;
  getSnapshot(symbol: MarketSymbol): Promise<MarketSnapshot>;
  getSnapshots?(symbols: MarketSymbol[]): Promise<MarketSnapshot[]>;
  healthCheck(): Promise<ProviderHealth>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly code = "MARKET_DATA_ERROR",
    public readonly status = 500
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export class InvalidMarketSymbolError extends MarketDataError {
  constructor(symbol: string) {
    super(`Invalid or unsupported market symbol: ${symbol}`, "INVALID_SYMBOL", 422);
  }
}

export class MarketProviderUnavailableError extends MarketDataError {
  constructor(message = "Market data provider is unavailable.") {
    super(message, "PROVIDER_UNAVAILABLE", 503);
  }
}
