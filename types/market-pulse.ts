export type MarketPulseCategory = 'breakout-beacon' | 'intraday-boost' | 'top-level' | 'low-level';
export type MarketPulseSignal = 'bullish' | 'bearish' | 'neutral';
export type MarketPulseSegment =
  | 'All'
  | 'NSE'
  | 'BSE'
  | 'F&O'
  | 'Futures'
  | 'Options'
  | 'Commodity'
  | 'Currency'
  | 'ETF'
  | 'Nifty 50'
  | 'Bank Nifty'
  | 'Indices';
export type MarketPulseSortBy = 'percentChange' | 'signalPercent' | 'time' | 'rFactor';

export interface StockSignal {
  symbol: string;
  companyName: string;
  exchange: string;
  logoUrl: string;
  price: number;
  volume: number;
  volumeMultiplier: number;
  percentChange: number;
  signalPercent: number;
  time: string;
  signal: MarketPulseSignal;
  signalIcon: 'bull' | 'bear' | 'neutral';
  rFactor: number;
  rFactorChange: number;
  pattern: string;
  isBookmarked: boolean;
  category: MarketPulseCategory;
  source?: string;
  // ── Derived analytics (TradeFinder-style calculations) ──────────────
  relativeVolume?: number;   // cross-sectional volume z-score → x-multiple proxy
  relativeStrength?: number; // 0-100 percentile rank of % change in the universe
  moneyFlux?: number;        // -100..100 net order-flow weighted by participation
  rangePct?: number;         // intraday (high-low)/price as %
  coiled?: boolean;          // NR-style range compression (low volatility coil)
  nearDayHigh?: boolean;     // trading in the top 8% of the day's range
  nearDayLow?: boolean;      // trading in the bottom 8% of the day's range
}

export interface MarketPulseResponse {
  ok: boolean;
  data: StockSignal[];
  meta?: {
    source: "live" | "unavailable";
    updatedAt: string;
  };
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
