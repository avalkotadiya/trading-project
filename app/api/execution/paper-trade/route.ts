import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api-response";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { WalletManager } from "@/lib/execution/wallet-manager";

const paperTradeSchema = z.object({
  symbol: z.string().min(1).max(32).transform((value) => value.toUpperCase()),
  direction: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(100000),
  price: z.number().positive(),
  orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
  strategy: z.string().max(80).default("AI_PAPER_TRADE"),
  confidence: z.number().min(0).max(100).optional(),
  riskScore: z.number().min(0).max(100).optional()
});

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "execution:paper-trade", { limit: 40, windowMs: 60_000 });
  if (!limit.allowed) return fail("RATE_LIMITED", "Too many paper trade requests.", 429);

  try {
    const user = await getAuthenticatedUser();
    const parsed = paperTradeSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Paper trade payload is invalid.", 422, parsed.error.flatten());
    }

    const trade = parsed.data;
    const amount = trade.price * trade.quantity;
    const { newBalance } = await WalletManager.processTrade(
      user.id,
      trade.direction,
      amount,
      trade.symbol,
      trade.quantity,
      trade.price
    );

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        symbol: trade.symbol,
        direction: trade.direction,
        quantity: trade.quantity,
        orderType: trade.orderType,
        status: "FILLED",
        brokerOrderId: `PAPER-${Date.now()}`,
        entryPrice: trade.price,
        strategy: trade.strategy,
        metadata: {
          mode: "paper",
          confidence: trade.confidence,
          riskScore: trade.riskScore
        }
      }
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "order.paper_trade",
      entity: "Order",
      entityId: order.id,
      metadata: { trade, newBalance },
      request
    });

    return ok({ order, newBalance }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }
    return fail("PAPER_TRADE_FAILED", error instanceof Error ? error.message : "Paper trade failed.", 500);
  }
}
