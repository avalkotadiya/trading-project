import { prisma } from "@/lib/prisma";
import { createBrokerClient, type OrderParams } from "./broker-client";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { WalletManager } from "./wallet-manager";

export class OrderManager {
  /**
   * High-security order placement with rate limiting, balance check, and audit logging.
   */
  static async executeOrder(userId: string, params: OrderParams, request?: unknown) {
    // 1. Rate Limit Check (5 orders per minute per user)
    const limit = await rateLimit(`order:${userId}`, 5, 60);
    if (!limit.allowed) {
      throw new Error("RATE_LIMIT_EXCEEDED: Maximum 5 orders per minute allowed.");
    }

    // 2. Fetch User & Broker Credentials & Balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        balance: true,
        brokerApiKey: true, 
        brokerAccessToken: true 
      }
    });

    const useDhan = process.env.BROKER_PROVIDER?.toUpperCase() === "DHAN" || process.env.DHAN_BOT_LIVE_TRADING_ENABLED === "true";
    if (!user || (!useDhan && (!user.brokerApiKey || !user.brokerAccessToken))) {
      throw new Error("BROKER_NOT_CONNECTED: Please link your broker in settings or enable DhanHQ live execution.");
    }

    // 3. Balance Check (Simplified for MVP: using current price if provided, else assuming)
    const price = params.price ? Number(params.price) : 1000; // Default price if not provided
    const totalAmount = price * params.quantity;

    if (params.direction === "BUY" && Number(user.balance) < totalAmount) {
      throw new Error(`INSUFFICIENT_FUNDS: Required ${totalAmount.toFixed(2)}, Available ${Number(user.balance).toFixed(2)}`);
    }

    // 4. Initialize Broker Client
    const broker = createBrokerClient(user.brokerApiKey ?? "", user.brokerAccessToken ?? "");

    // 5. Place Order via Broker
    const brokerRes = await broker.placeOrder(params);

    // 6. Atomically Process Wallet & Portfolio (since we treat as FILLED for MVP)
    const { newBalance } = await WalletManager.processTrade(
      user.id,
      params.direction,
      totalAmount,
      params.symbol,
      params.quantity,
      price
    );

    // 7. Persist Order to Sahara Database
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        symbol: params.symbol,
        direction: params.direction,
        quantity: params.quantity,
        orderType: params.orderType,
        status: "FILLED",
        brokerOrderId: brokerRes.order_id,
        strategy: params.strategy,
        entryPrice: price,
      },
    });

    // 8. Audit Logging
    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "order.place",
      entity: "Order",
      entityId: order.id,
      metadata: { brokerRes, params, newBalance },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: request as any
    });

    return { order, newBalance };
  }
}
