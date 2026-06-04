export type AlertTone = "positive" | "negative" | "neutral";

export type WatchlistSummary = {
  id: string;
  name: string;
  symbols: string[];
  updatedAt: string;
};

export type AlertSummary = {
  id: string;
  symbol: string;
  title: string;
  message: string;
  tone: AlertTone;
  status: "ACTIVE" | "TRIGGERED" | "PAUSED";
  type: "PRICE" | "VOLUME" | "MOMENTUM";
  condition: string;
  createdAt: string;
  _rawCreatedAt?: Date;
};

export type UserSettingsProfile = {
  id: string;
  name: string;
  email: string;
  role?: "OWNER" | "ADMIN" | "ANALYST" | "TRADER" | "VIEWER";
  phoneNumber?: string | null;
  telegramChatId?: string | null;
  whatsappOptIn?: boolean;
  emailAlerts: boolean;
  pushAlerts: boolean;
  weeklyDigest: boolean;
};

export type FeaturedSignal = {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  strategy: string;
  entryPrice: number;
  stopLoss: number | null;
  targetPrice: number | null;
  timeframe: string;
  summary: string;
};

export type PortfolioHoldingSummary = {
  id: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number | null;
  broker: string | null;
  notes: string | null;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  updatedAt: string;
};

export type PortfolioAnalytics = {
  totalInvested: number;
  totalMarketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  holdingsCount: number;
  winners: number;
  losers: number;
};
