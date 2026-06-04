/**
 * Dhan Market Depth Service
 *
 * Wraps two Dhan v2 REST endpoints:
 *   POST /marketfeed/depth20  →  20-level bid/ask depth for up to 100 instruments
 *   POST /marketfeed/quote    →  Top-of-book (5-level) quote; used as fallback
 *
 * The Dhan WebSocket feed (dhanMarketFeed.ts) also streams "full" packets
 * (response-code 8) with 5-level depth when subscribed with requestCode=21.
 * Use this REST service for on-demand snapshot requests and the WS feed for
 * continuous full-depth streaming.
 *
 * Dhan rate-limit guidance (unlimited plan): no hard cap, but 1 request/sec
 * per endpoint type is the documented recommendation. We enforce a 350 ms
 * minimum gap so burst callers don't hammer the endpoint.
 */

import { DhanClient } from "@/services/dhan/dhanClient";
import { resolveDhanAccessToken } from "@/services/dhan/dhanAuth";

const MIN_GAP_MS = 350;

// ---------------------------------------------------------------------------
//  Types that mirror the Dhan v2 /marketfeed/depth20 response schema
// ---------------------------------------------------------------------------

export type DepthLevel = {
  price: number;
  quantity: number;
  orders: number;
};

export type InstrumentDepth = {
  exchangeSegment: string;
  securityId: string;
  buy: DepthLevel[];
  sell: DepthLevel[];
  lastPrice: number;
  lastQuantity: number;
  totalBuyQty: number;
  totalSellQty: number;
  volume: number;
  averageTradePrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type DhanDepth20Response = {
  status?: string;
  data?: Record<string, Record<string, {
    buy?: Array<{ quantity?: number; price?: number; orders?: number }>;
    sell?: Array<{ quantity?: number; price?: number; orders?: number }>;
    last_price?: number;
    last_quantity?: number;
    buy_quantity?: number;
    sell_quantity?: number;
    volume?: number;
    average_price?: number;
    ohlc?: { open?: number; high?: number; low?: number; close?: number };
  }>>;
};

export type DepthRequest = {
  ExchangeSegment: string;
  SecurityId: string;
}[];

// ---------------------------------------------------------------------------
//  Service
// ---------------------------------------------------------------------------

class DhanMarketDepthService {
  private readonly client = new DhanClient(resolveDhanAccessToken);
  private lastRequestAt = 0;
  private requestChain = Promise.resolve();

  /**
   * Fetch 20-level bid/ask depth for up to 100 instruments.
   * Returns a map keyed by "ExchangeSegment:SecurityId".
   */
  async getDepth20(instruments: DepthRequest): Promise<Map<string, InstrumentDepth>> {
    if (instruments.length === 0) return new Map();

    // Dhan depth20 accepts instruments grouped by segment
    const bySegment: Record<string, string[]> = {};
    for (const { ExchangeSegment, SecurityId } of instruments) {
      bySegment[ExchangeSegment] = bySegment[ExchangeSegment] ?? [];
      bySegment[ExchangeSegment].push(SecurityId);
    }
    // Limit to 100 total (Dhan constraint)
    const trimmed: Record<string, number[]> = {};
    let total = 0;
    for (const [seg, ids] of Object.entries(bySegment)) {
      if (total >= 100) break;
      const slice = ids.slice(0, 100 - total).map(Number);
      trimmed[seg] = slice;
      total += slice.length;
    }

    const response = await this.throttled(() =>
      this.client.post<DhanDepth20Response>("/marketfeed/depth20", trimmed)
    );

    const result = new Map<string, InstrumentDepth>();
    for (const [seg, secMap] of Object.entries(response.data ?? {})) {
      for (const [sid, raw] of Object.entries(secMap)) {
        const toLevel = (entry: { quantity?: number; price?: number; orders?: number }): DepthLevel => ({
          price: entry.price ?? 0,
          quantity: entry.quantity ?? 0,
          orders: entry.orders ?? 0
        });
        result.set(`${seg}:${sid}`, {
          exchangeSegment: seg,
          securityId: sid,
          buy: (raw.buy ?? []).map(toLevel),
          sell: (raw.sell ?? []).map(toLevel),
          lastPrice: raw.last_price ?? 0,
          lastQuantity: raw.last_quantity ?? 0,
          totalBuyQty: raw.buy_quantity ?? 0,
          totalSellQty: raw.sell_quantity ?? 0,
          volume: raw.volume ?? 0,
          averageTradePrice: raw.average_price ?? 0,
          open: raw.ohlc?.open ?? 0,
          high: raw.ohlc?.high ?? 0,
          low: raw.ohlc?.low ?? 0,
          close: raw.ohlc?.close ?? 0
        });
      }
    }
    return result;
  }

  /**
   * Fetch a single instrument's 20-level depth snapshot.
   */
  async getDepthForOne(
    exchangeSegment: string,
    securityId: string
  ): Promise<InstrumentDepth | null> {
    const map = await this.getDepth20([{ ExchangeSegment: exchangeSegment, SecurityId: securityId }]);
    return map.get(`${exchangeSegment}:${securityId}`) ?? null;
  }

  // Throttle requests to respect Dhan's rate guidance.
  private throttled<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - this.lastRequestAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return task();
    };
    const result = this.requestChain.then(run, run);
    this.requestChain = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const dhanMarketDepthService = new DhanMarketDepthService();
