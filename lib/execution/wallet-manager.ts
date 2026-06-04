import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import { logger } from "@/lib/logger";

export type TransactionType = "DEPOSIT" | "WITHDRAW" | "TRADE_BUY" | "TRADE_SELL";

export class WalletManager {
  /**
   * Retrieves the current user balance.
   */
  static async getBalance(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true }
    });
    return user?.balance ? Number(user.balance) : 0;
  }

  /**
   * Processes a trade transaction (Buy/Sell).
   * This is atomic: it updates balance, portfolio, and logs the transaction.
   */
  static async processTrade(userId: string, type: "BUY" | "SELL", amount: number, symbol: string, quantity: number, price: number) {
    return prisma.$transaction(async (tx) => {
      // 1. Get current user with lock
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, balance: true }
      });

      if (!user) throw new Error("User not found");

      const balance = Number(user.balance);
      const transactionType: TransactionType = type === "BUY" ? "TRADE_BUY" : "TRADE_SELL";
      
      // 2. Validate balance for BUY
      if (type === "BUY" && balance < amount) {
        throw new Error(`Insufficient funds. Required: ${amount.toFixed(2)}, Available: ${balance.toFixed(2)}`);
      }

      // 3. Update User Balance
      const newBalance = type === "BUY" ? balance - amount : balance + amount;
      await tx.user.update({
        where: { id: userId },
        data: { balance: newBalance }
      });

      // 4. Update Portfolio Holdings
      if (type === "BUY") {
        const existingHolding = await tx.portfolioHolding.findUnique({
          where: { userId_symbol: { userId, symbol } }
        });
        const existingQty = existingHolding ? Number(existingHolding.quantity) : 0;
        const existingAverage = existingHolding ? Number(existingHolding.averagePrice) : 0;
        const nextQty = existingQty + quantity;
        const weightedAverage = nextQty > 0 ? (existingQty * existingAverage + quantity * price) / nextQty : price;

        await tx.portfolioHolding.upsert({
          where: { userId_symbol: { userId, symbol } },
          update: {
            quantity: { increment: quantity },
            averagePrice: new Prisma.Decimal(weightedAverage),
            lastPrice: new Prisma.Decimal(price)
          },
          create: {
            userId,
            symbol,
            quantity,
            averagePrice: price,
            lastPrice: price
          }
        });
      } else {
        const holding = await tx.portfolioHolding.findUnique({
          where: { userId_symbol: { userId, symbol } }
        });

        if (!holding || Number(holding.quantity) < quantity) {
          throw new Error(`Insufficient holdings for ${symbol}. Available: ${holding?.quantity || 0}`);
        }

        if (Number(holding.quantity) === quantity) {
          await tx.portfolioHolding.delete({
            where: { id: holding.id }
          });
        } else {
          await tx.portfolioHolding.update({
            where: { id: holding.id },
            data: { quantity: { decrement: quantity } }
          });
        }
      }

      // 5. Log Wallet Transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          userId,
          type: transactionType,
          amount,
          reference: symbol,
          metadata: { quantity, price }
        }
      });

      logger.info(`Wallet transaction processed for ${userId}: ${transactionType} ${amount}`);
      return { transaction, newBalance };
    });
  }

  /**
   * Simple deposit for testing.
   */
  static async deposit(userId: string, amount: number) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });

      await tx.walletTransaction.create({
        data: {
          userId,
          type: "DEPOSIT",
          amount,
          status: "COMPLETED"
        }
      });

      return user.balance;
    });
  }
}
