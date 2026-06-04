import type { MarketSymbol, NormalizedTick } from "@/services/market-data/market-data.types";
import { normalizeTick } from "@/services/market-data/tick-normalizer.service";
import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";
import { resolveDhanInstrumentForMarketSymbol } from "@/lib/dhan-symbols";

type DhanQuoteInstrument = {
  average_price?: number;
  buy_quantity?: number;
  last_price?: number;
  last_quantity?: number;
  last_trade_time?: string;
  net_change?: number;
  ohlc?: {
    open?: number;
    close?: number;
    high?: number;
    low?: number;
  };
  oi?: number;
  sell_quantity?: number;
  volume?: number;
  depth?: {
    buy?: Array<{ quantity?: number; price?: number }>;
    sell?: Array<{ quantity?: number; price?: number }>;
  };
};

type DhanQuoteResponse = {
  data?: Record<string, Record<string, DhanQuoteInstrument>>;
  status?: string;
};

type DhanQuoteRequest = Record<string, number[]>;

const MIN_QUOTE_INTERVAL_MS = 1050;

function toDhanQuoteRequest(symbols: MarketSymbol[]) {
  const request: DhanQuoteRequest = {};
  const symbolByKey = new Map<string, MarketSymbol>();

  for (const symbol of symbols) {
    const instrument = resolveDhanInstrumentForMarketSymbol(symbol);
    if (!instrument) continue;
    const securityId = Number(instrument.SecurityId);
    if (!Number.isFinite(securityId)) continue;
    request[instrument.ExchangeSegment] = request[instrument.ExchangeSegment] ?? [];
    request[instrument.ExchangeSegment].push(securityId);
    symbolByKey.set(`${instrument.ExchangeSegment}:${instrument.SecurityId}`, symbol);
  }

  return { request, symbolByKey };
}

function parseDhanDate(value: string | undefined) {
  if (!value || value === "01/01/1980 00:00:00") return new Date().toISOString();
  const [datePart, timePart = "00:00:00"] = value.split(" ");
  const [day, month, year] = datePart.split("/").map(Number);
  if (!day || !month || !year) return new Date().toISOString();
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${timePart}+05:30`).toISOString();
}

class DhanMarketQuoteService {
  private readonly client = new DhanClient(resolveDhanAccessToken);
  private lastRequestAt = 0;
  private requestChain = Promise.resolve();

  async getQuoteTicks(symbols: MarketSymbol[]): Promise<NormalizedTick[]> {
    const { request, symbolByKey } = toDhanQuoteRequest(symbols);
    if (Object.keys(request).length === 0) return [];

    const response = await this.throttledQuoteRequest(request);
    const ticks: NormalizedTick[] = [];

    for (const [exchangeSegment, instruments] of Object.entries(response.data ?? {})) {
      for (const [securityId, quote] of Object.entries(instruments)) {
        const symbol = symbolByKey.get(`${exchangeSegment}:${securityId}`);
        if (!symbol || typeof quote.last_price !== "number") continue;

        const close = quote.ohlc?.close && quote.ohlc.close > 0 ? quote.ohlc.close : quote.last_price - (quote.net_change ?? 0);
        ticks.push(
          normalizeTick(
            symbol,
            {
              lastPrice: quote.last_price,
              close,
              change: quote.last_price - close,
              changePercent: close > 0 ? ((quote.last_price - close) / close) * 100 : 0,
              volume: quote.volume ?? 0,
              averageTradedPrice: quote.average_price ?? quote.last_price,
              lastTradedQuantity: quote.last_quantity,
              totalBuyQty: quote.buy_quantity,
              totalSellQty: quote.sell_quantity,
              bidPrice: quote.depth?.buy?.[0]?.price,
              askPrice: quote.depth?.sell?.[0]?.price,
              bidQty: quote.depth?.buy?.[0]?.quantity,
              askQty: quote.depth?.sell?.[0]?.quantity,
              open: quote.ohlc?.open ?? close,
              high: quote.ohlc?.high ?? quote.last_price,
              low: quote.ohlc?.low ?? quote.last_price,
              openInterest: quote.oi,
              timestamp: parseDhanDate(quote.last_trade_time)
            },
            "dhan:quote-api"
          )
        );
      }
    }

    return ticks;
  }

  private async throttledQuoteRequest(request: DhanQuoteRequest) {
    const run = async () => {
      const waitMs = Math.max(0, MIN_QUOTE_INTERVAL_MS - (Date.now() - this.lastRequestAt));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      this.lastRequestAt = Date.now();
      return this.client.post<DhanQuoteResponse>("/marketfeed/quote", request);
    };

    const result = this.requestChain.then(run, run);
    this.requestChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

export const dhanMarketQuoteService = new DhanMarketQuoteService();
