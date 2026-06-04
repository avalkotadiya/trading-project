import { z } from "zod";
import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { WalletManager } from "@/lib/execution/wallet-manager";
import { writeAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";

const DEFAULT_PAPER_BALANCE = 100_000;

const walletActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("DEPOSIT"),
    amount: z.number().positive().max(10_000_000)
  }),
  z.object({
    action: z.literal("RESET"),
    // Optional — defaults to ₹100K paper-balance for clean bot test cycles.
    // Range chosen so a typo can't drop you into the millions.
    balance: z.number().min(0).max(10_000_000).optional()
  })
]);

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    const [balance, transactions] = await Promise.all([
      WalletManager.getBalance(user.id),
      prisma.walletTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    return NextResponse.json({ ok: true, data: { balance, currency: "INR", transactions } });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    logger.error("Wallet GET failed", { error: error instanceof Error ? error.message : String(error) });
    return fail("WALLET_FETCH_FAILED", "Failed to fetch wallet data.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser();
    const parsed = walletActionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid wallet action.", 422, parsed.error.flatten());
    }

    if (parsed.data.action === "DEPOSIT") {
      const newBalance = await WalletManager.deposit(user.id, parsed.data.amount);
      return NextResponse.json({ ok: true, balance: newBalance });
    }

    // RESET — for paper-mode testing. Wipes bot orders + portfolio holdings +
    // wallet transactions, restores balance to ₹100K (or chosen value), then
    // logs a single DEPOSIT row so the audit trail isn't empty. All-or-nothing
    // via a single transaction so a partial reset can't leave inconsistent state.
    const targetBalance = parsed.data.balance ?? DEFAULT_PAPER_BALANCE;
    const result = await prisma.$transaction(async (tx) => {
      const beforeBalance = await tx.user.findUnique({
        where: { id: user.id },
        select: { balance: true }
      });

      // Order: portfolio first (no FK from holdings to anything else),
      // then bot-strategy orders, then transactions, then balance reset.
      const deletedHoldings = await tx.portfolioHolding.deleteMany({
        where: { userId: user.id }
      });
      const deletedOrders = await tx.order.deleteMany({
        where: { userId: user.id, strategy: { startsWith: "BOT" } }
      });
      const deletedTxns = await tx.walletTransaction.deleteMany({
        where: { userId: user.id }
      });
      const deletedBotEvents = await tx.botEvent.deleteMany({
        where: { userId: user.id }
      });

      await tx.user.update({
        where: { id: user.id },
        data: { balance: new Prisma.Decimal(targetBalance) }
      });

      // Seed transaction so the wallet UI doesn't show an empty ledger.
      await tx.walletTransaction.create({
        data: {
          userId: user.id,
          type: "DEPOSIT",
          amount: targetBalance,
          status: "COMPLETED",
          reference: "PAPER_RESET",
          metadata: { previousBalance: Number(beforeBalance?.balance ?? 0) } as Prisma.InputJsonValue
        }
      });

      return {
        balance: targetBalance,
        cleared: {
          holdings: deletedHoldings.count,
          botOrders: deletedOrders.count,
          transactions: deletedTxns.count,
          botEvents: deletedBotEvents.count
        }
      };
    });

    await writeAuditLog({
      userId: user.id,
      actorEmail: user.email,
      action: "wallet.reset",
      entity: "User",
      entityId: user.id,
      metadata: result
    });

    logger.info("Wallet reset", { userId: user.id, ...result });
    return NextResponse.json({ ok: true, balance: result.balance, cleared: result.cleared });
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    logger.error("Wallet POST failed", { error: error instanceof Error ? error.message : String(error) });
    return fail("WALLET_ACTION_FAILED", "Failed to process wallet action.", 500);
  }
}
