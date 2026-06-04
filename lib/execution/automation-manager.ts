import { prisma } from "@/lib/prisma";
import { OrderManager } from "./order-manager";
import { logger } from "@/lib/logger";

export type AISignal = {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  strategy: string;
  entryPrice: number;
  stopLoss?: number;
  targetPrice?: number;
  timeframe: string;
  summary: string;
};

export class AutomationManager {
  /**
   * Processes incoming AI signals and executes trades for users with auto-trade enabled.
   */
  static async handleSignal(signal: AISignal) {
    if (signal.direction === "NEUTRAL") return;

    try {
      // 1. Find all users with auto-trade enabled for this specific strategy
      const autoTraders = await prisma.user.findMany({
        where: {
          autoTradeEnabled: true,
          autoTradeStrategy: { in: [signal.strategy, "AI_SIGNAL_LAB"] },
          // Ensure they have valid broker credentials
          brokerApiKey: { not: null },
          brokerAccessToken: { not: null }
        },
        select: {
          id: true,
          email: true,
          maxAutoTradeAmount: true,
          balance: true
        }
      });

      if (autoTraders.length === 0) return;

      logger.info(`Automation: Processing signal ${signal.symbol} for ${autoTraders.length} users.`);

      // 2. Execute trades for each user (respecting their risk limits)
      for (const user of autoTraders) {
        try {
          const tradePrice = Number(signal.entryPrice);
          const maxAmount = Number(user.maxAutoTradeAmount);
          const balance = Number(user.balance);

          // Calculate quantity based on max trade amount
          // Example: If max trade is 5000 and price is 1000, quantity is 5.
          const quantity = Math.floor(maxAmount / tradePrice);

          if (quantity <= 0) {
            logger.warn(`Automation skipped for ${user.email}: Trade amount too low for price ${tradePrice}`);
            continue;
          }

          if (balance < tradePrice * quantity) {
            logger.warn(`Automation skipped for ${user.email}: Insufficient balance.`);
            continue;
          }

          // 3. Place the order
          await OrderManager.executeOrder(user.id, {
            symbol: signal.symbol,
            direction: signal.direction === "BULLISH" ? "BUY" : "SELL",
            quantity,
            orderType: "MARKET",
            price: tradePrice,
            strategy: `AUTO:${signal.strategy}`
          });

          logger.info(`Automation SUCCESS: Executed ${signal.direction} for ${user.email} on ${signal.symbol}`);
        } catch (err) {
          logger.error(`Automation individual user error (${user.email}):`, {
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    } catch (error) {
      logger.error("Automation Critical Error:", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
