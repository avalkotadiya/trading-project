export type MarketDirection = "up" | "down" | "flat";
export type MarketConnectionStatus = "connecting" | "live" | "polling" | "error" | "closed";
export type ScannerSignal = "bullish" | "bearish" | "neutral";

export interface MarketTick {
  exchange?: "NSE" | "BSE" | "MCX";
  segment?: "EQ" | "INDEX" | "FNO" | "COMM" | "CURRENCY";
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open?: number;
  close?: number;
  direction: MarketDirection;
  updatedAt: string;
  instrumentToken?: string;
  source?: string;
  ltt?: string;
  lastTradedQuantity?: number;
  averageTradedPrice?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  openInterest?: number;
  bidPrice?: number;
  askPrice?: number;
  bidQty?: number;
  askQty?: number;
}

export interface MarketOverviewCard {
  label: string;
  value: string;
  change: string;
  tone: "positive" | "negative" | "neutral";
}

export interface ScannerResult {
  symbol: string;
  company: string;
  price: number;
  changePercent: number;
  volume: number;
  relativeVolume: number;
  momentumScore: number;
  signal: ScannerSignal;
  setup: string;
  sector: string;
}

export interface PutCallRatio {
  symbol: string;
  value: number;
  previous: number;
  sentiment: ScannerSignal;
}

export interface OptionChainRow {
  strike: number;
  callOi: number;
  callChangeOi: number;
  callLtp: number;
  callIv: number;
  callVolume: number;
  putLtp: number;
  putIv: number;
  putVolume: number;
  putChangeOi: number;
  putOi: number;
}
