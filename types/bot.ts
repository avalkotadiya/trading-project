export type BotTradeMode = "PAPER" | "LIVE";

export type BotConfig = {
  autoTradeEnabled: boolean;
  botTradeMode: BotTradeMode;
  // Total ₹ the bot may have deployed across all open positions at any time.
  // Once cumulative entry × qty exposure hits this cap, no new entries open;
  // existing positions still run their exits.
  maxDeployedCapital: number;
  botMaxOpenPositions: number;
  botMaxDailyLoss: number;
  botMinEdgePct: number; // min expected value % per trade
  botRiskPctPerTrade: number; // max equity % risked per trade (ATR stop)
  botKellyCap: number; // fractional-Kelly ceiling (0-1)
  botMinCompositeScore: number; // 0-100 indicator composite gate
  // Trailing stop-loss — once a trade is up by `botTrailStartPct`%, the stop
  // is ratcheted up to `botTrailDistancePct`% below the latest peak.
  // Either 0 = disabled.
  botTrailStartPct: number;
  botTrailDistancePct: number;
  // Max fraction of total deployed capital allowed in any single sector.
  // 0 = uncapped; 0.4 = 40 %.
  botMaxSectorExposurePct: number;
  // Entry window — HH:MM IST inclusive; null = no restriction. Exits run all
  // session regardless.
  botEntryWindowStart: string | null;
  botEntryWindowEnd: string | null;
  // Surfaced by /api/bot/state so the UI can hide LIVE while paper-only flag is on
  liveModeLocked: boolean;
};

export type BotPosition = {
  orderId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: string;
};

export type BotCandidate = {
  symbol: string;
  sector?: string | null;
  price: number;
  inSetup: boolean;
  edgePct: number;
  winProb: number;
  payoff: number;
  kelly: number;
  sampleSize: number;
  stopPrice: number;
  targetPrice: number;
  zScore: number;
  trendUp: boolean;
  intradayMomentum: number;
  intradayTrendUp: boolean;
  intradayPullback: boolean;
  rvol: number;
  // Advanced indicator readouts (new in bot v2)
  rsi14: number;          // 0-100, momentum / overbought-oversold
  macdHist: number;       // MACD histogram, sign = momentum direction
  adx14: number;          // 0-100, trend strength (>20 trending, >40 strong)
  bbPctB: number;         // %B in Bollinger Bands (0=lower, 0.5=mid, 1=upper)
  obvSlope: number;       // normalized slope of OBV over 20 bars
  compositeScore: number; // 0-100 blended quality score driving sizing
  eligible: boolean;
  reason: string;
  reasons: string[];
};

export type BotGuardrail = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type BotEventDto = {
  id: string;
  level: "INFO" | "TRADE" | "RISK" | "ERROR";
  symbol: string | null;
  message: string;
  createdAt: string;
};

// Live Scanner-Pro confluence read for a single symbol (see
// services/ai/scanner-strategy.service.ts).
export type ScannerAlpha = {
  symbol: string;
  sector: string;
  signal: "bullish" | "bearish" | "neutral";
  signalPercent: number; // 0-100 scanner conviction
  rFactor: number;
  relativeStrength: number; // 0-100 percentile vs scanned universe
  relativeVolume: number; // x normal participation
  moneyFlux: number; // -100..100 order-flow bias
  score: number; // 0-100 blended confluence score
};

// Universe-level scanner summary surfaced to the bot UI.
export type BotScannerSummary = {
  breadth: number; // -100..100 (bullish - bearish) / total
  avgRvol: number;
  bullish: number;
  bearish: number;
  analyzed: number;
  leaders: Array<{ symbol: string; score: number; signal: string }>;
};

// AI-recommended bot settings derived from wallet + edge + scanner data.
// The user can accept these as-is or override any field.
export type BotRecommendation = {
  maxDeployedCapital: number;
  botTrailStartPct: number;
  botTrailDistancePct: number;
  botMaxSectorExposurePct: number;
  botEntryWindowStart: string | null;
  botEntryWindowEnd: string | null;
  basis: {
    walletBalance: number;
    candidatesAnalyzed: number;
    medianAtrPct: number;
    avgCompositeScore: number;
    distinctSectors: number;
    scannerBreadth: number;
    deployFraction: number;
  };
  rationale: {
    maxDeployedCapital: string;
    trailing: string;
    sectorCap: string;
    entryWindow: string;
  };
};

export type BotKpis = {
  realizedPnlToday: number;
  unrealizedPnl: number;
  totalPnlToday: number;
  tradesToday: number;
  winRateToday: number;
  openPositionsCount: number;
  openExposure: number;
  dailyLossBudget: number;
  dailyLossUsed: number;
  balance: number;
};

export type BotState = {
  config: BotConfig;
  status: "ACTIVE" | "PAUSED";
  kpis: BotKpis;
  guardrails: BotGuardrail[];
  positions: BotPosition[];
  candidates: BotCandidate[];
  events: BotEventDto[];
  lastRunAt: string | null;
  // AI-recommended settings (data-driven defaults the user can accept/override).
  recommendation: BotRecommendation | null;
  // Live Scanner-Pro confluence summary feeding the bot's entry algorithm.
  scanner: BotScannerSummary | null;
};

export type BotRunResult = {
  ran: boolean;
  reason?: string;
  entries: number;
  exits: number;
  events: BotEventDto[];
};

