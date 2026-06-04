import { randomUUID } from "node:crypto";
import { dhanOrdersService } from "@/services/dhan/dhanOrders";
import { DHAN_DASHBOARD_INSTRUMENTS } from "@/lib/dhan-symbols";
import { resolveSymbol } from "@/services/symbols/symbol-registry";

/**
 * Broker Client Abstraction.
 *
 * DhanHQ is the production broker path. The mock client remains available for
 * local development only when BROKER_PROVIDER is not set to DHAN.
 */

export type OrderParams = {
  symbol: string;
  direction: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT" | "SL-M";
  price?: number;
  strategy?: string;
};

export class BrokerClient {
  private apiKey: string;
  private accessToken: string;

  constructor(apiKey: string, accessToken: string) {
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  async placeOrder(params: OrderParams) {
    console.log(`[BROKER] Placing ${params.direction} order for ${params.symbol} x ${params.quantity}`);
    
    // Simulate broker response
    return {
      status: "success",
      order_id: `BRK-${Math.random().toString(36).substring(7).toUpperCase()}`,
      timestamp: new Date().toISOString()
    };
  }

  async getOrderHistory() {
    return [];
  }
}

function normalizeSymbol(symbol: string) {
  return symbol.includes(":") ? symbol.split(":").at(-1) ?? symbol : symbol;
}

function dhanOrderType(orderType: OrderParams["orderType"]) {
  if (orderType === "LIMIT") return "LIMIT" as const;
  if (orderType === "SL-M") return "STOP_LOSS_MARKET" as const;
  return "MARKET" as const;
}

export class DhanBrokerClient {
  async placeOrder(params: OrderParams) {
    if (process.env.DHAN_BOT_LIVE_TRADING_ENABLED !== "true") {
      throw new Error("DHAN_LIVE_DISABLED: Set DHAN_BOT_LIVE_TRADING_ENABLED=true only after Dhan static IP and risk controls are ready.");
    }

    const dhanClientId = process.env.DHAN_CLIENT_ID?.trim();
    if (!dhanClientId) {
      throw new Error("DHAN_CLIENT_ID_MISSING: Configure DHAN_CLIENT_ID before live Dhan orders.");
    }

    const symbol = normalizeSymbol(params.symbol).toUpperCase();

    // First try the curated dashboard list (fast, in-memory). Falls back to
    // the full Dhan instrument master so the bot can order any symbol it
    // generated a signal for, not just the 30-odd hardcoded names.
    let exchangeSegment: string | undefined;
    let securityId: string | undefined;
    const curated = DHAN_DASHBOARD_INSTRUMENTS.find(
      (item) => item.symbol === symbol && item.segment === "EQ"
    );
    if (curated) {
      exchangeSegment = curated.ExchangeSegment;
      securityId = curated.SecurityId;
    } else {
      // Fall through to the central symbol registry. India enforcement and
      // segment preference live there — broker-client just consumes the
      // resolved row. resolveSymbol() takes "NSE:RELIANCE" or "RELIANCE"
      // (we already normalised to the bare symbol above).
      const resolved = await resolveSymbol(symbol);
      if (resolved) {
        exchangeSegment = resolved.exchangeSegment;
        securityId = resolved.securityId;
      }
    }

    if (!exchangeSegment || !securityId) {
      throw new Error(`DHAN_SYMBOL_UNSUPPORTED: ${params.symbol} not found in the Dhan instrument master.`);
    }

    const order = await dhanOrdersService.placeOrder({
      dhanClientId,
      transactionType: params.direction,
      // The Dhan SDK types this as a literal union, but the master can
      // legitimately produce any of those segments (we filtered options
      // out upstream). The cast is safe — Dhan validates server-side.
      exchangeSegment: exchangeSegment as "NSE_EQ" | "NSE_FNO" | "NSE_CURRENCY" | "BSE_EQ" | "BSE_FNO" | "BSE_CURRENCY" | "MCX_COMM" | "IDX_I",
      productType: (process.env.DHAN_BOT_PRODUCT_TYPE || "INTRADAY") as "CNC" | "INTRADAY" | "MARGIN" | "MTF" | "CO" | "BO",
      orderType: dhanOrderType(params.orderType),
      validity: "DAY",
      securityId,
      quantity: params.quantity,
      price: params.orderType === "LIMIT" ? Math.max(0, Number(params.price ?? 0)) : 0,
      correlationId: `BOT-${randomUUID()}`.slice(0, 64),
      confirmOrder: true
    });

    const brokerOrderId =
      typeof order === "object" && order !== null && "orderId" in order
        ? String((order as { orderId?: unknown }).orderId)
        : `DHAN-${Date.now()}`;

    return {
      status: "success",
      order_id: brokerOrderId,
      raw: order,
      timestamp: new Date().toISOString()
    };
  }

  async getOrderHistory() {
    return dhanOrdersService.listOrders();
  }
}

export const createBrokerClient = (apiKey: string, accessToken: string) => {
  if (process.env.BROKER_PROVIDER?.toUpperCase() === "DHAN" || process.env.DHAN_BOT_LIVE_TRADING_ENABLED === "true") {
    return new DhanBrokerClient();
  }
  return new BrokerClient(apiKey, accessToken);
};
