import type { MarketTick } from "@/types/market";
import type { PortfolioHoldingSummary } from "@/types/platform";

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type AiDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type Reliability = "high" | "medium" | "low";

export type TechnicalFeatureSet = {
  rsi: number;
  macd: number;
  macdSignal: number;
  bollingerUpper: number;
  bollingerMiddle: number;
  bollingerLower: number;
  emaFast: number;
  emaSlow: number;
  atr: number;
  vwap: number;
  volumeSpike: number;
  trendStrength: number;
  volatilityPercent: number;
  support: number;
  resistance: number;
  gapPercent: number;
  candlePattern: "bullish_engulfing" | "bearish_engulfing" | "doji" | "none";
  marketDepthImbalance: number;
};

export type SentimentInsight = {
  score: number;
  trend: "improving" | "deteriorating" | "stable";
  impact: "high" | "medium" | "low";
  confidence: number;
  expiresAt: string;
  headlines: string[];
};

export type PortfolioRiskInsight = {
  exposureScore: number;
  concentrationRisk: number;
  diversificationScore: number;
  drawdownRisk: number;
  riskPosture: "aggressive" | "balanced" | "defensive";
  correlationWarnings: string[];
  recommendations: string[];
};

export type SmartOrderPreview = {
  transactionType: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity: number;
  entry: number;
  stopLoss: number | null;
  targets: number[];
  riskRewardRatio: number;
  estimatedMaxLoss: number;
  accountRiskPercent: number;
  requiresConfirmation: boolean;
  guardrails: string[];
  dhan: {
    exchangeSegment: string;
    securityId: string | null;
    correlationId: string;
    marginCheck: "configured" | "unavailable";
    staticIpReminder: boolean;
  };
};

export type ModelHealth = {
  reliability: Reliability;
  accuracyWindow: number;
  precision: number;
  recall: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  calibrationError: number;
  drift: "none" | "watch" | "elevated";
  warnings: string[];
  lastValidatedAt: string;
};

export type BacktestSummary = {
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  averageRiskReward: number;
  falsePositiveRate: number;
};

export type AiTradingPrediction = {
  symbol: string;
  direction: AiDirection;
  timeHorizon: "scalping" | "intraday" | "swing";
  confidence: number;
  riskScore: number;
  reliability: Reliability;
  expectedRange: {
    low: number;
    high: number;
  };
  entryZone: {
    low: number;
    high: number;
  };
  stopLoss: number | null;
  targets: number[];
  positionSize: number;
  riskRewardRatio: number;
  factors: string[];
  technicals: TechnicalFeatureSet;
  sentiment: SentimentInsight;
  portfolioRisk: PortfolioRiskInsight;
  orderPreview: SmartOrderPreview;
  modelHealth: ModelHealth;
  backtest: BacktestSummary;
  generatedAt: string;
};

export type AiTradingRequest = {
  symbol?: string;
  candles?: Candle[];
  tick?: MarketTick;
  holdings?: PortfolioHoldingSummary[];
  accountEquity?: number;
  accountRiskPercent?: number;
  securityId?: string;
  exchangeSegment?: string;
};
