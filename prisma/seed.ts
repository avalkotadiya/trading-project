import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "../lib/env";

// Prisma 7 requires an explicit driver adapter — bare `new PrismaClient()`
// throws at construction. Mirrors lib/prisma.ts but skips the Next.js
// startup-checks side effect since this runs as a one-shot CLI.
const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl() ?? "")
});

async function main() {
  await prisma.subscriptionPlan.upsert({
    where: { key: "free" },
    update: {
      name: "Free",
      priceInr: 0,
      interval: "MONTH",
      features: ["Market overview", "5 watchlist symbols", "Basic scanner"],
      isActive: true
    },
    create: {
      key: "free",
      name: "Free",
      priceInr: 0,
      interval: "MONTH",
      features: ["Market overview", "5 watchlist symbols", "Basic scanner"]
    }
  });

  await prisma.subscriptionPlan.upsert({
    where: { key: "pro" },
    update: {
      name: "Pro",
      priceInr: 1499,
      interval: "MONTH",
      features: ["Advanced scanner", "Options analytics", "Realtime alerts", "Unlimited watchlists"],
      isActive: true
    },
    create: {
      key: "pro",
      name: "Pro",
      priceInr: 1499,
      interval: "MONTH",
      features: ["Advanced scanner", "Options analytics", "Realtime alerts", "Unlimited watchlists"]
    }
  });

  await prisma.tradingSignal.deleteMany({
    where: {
      symbol: { in: ["TATAMOTORS", "SBIN"] }
    }
  });

  await prisma.tradingSignal.createMany({
    data: [
      {
        symbol: "TATAMOTORS",
        direction: "BULLISH",
        confidence: 88,
        strategy: "Volume Breakout",
        entryPrice: "1018.45",
        stopLoss: "986.00",
        targetPrice: "1084.00",
        timeframe: "1D",
        summary: "Relative volume expansion with bullish close above prior resistance."
      },
      {
        symbol: "SBIN",
        direction: "BEARISH",
        confidence: 71,
        strategy: "VWAP Rejection",
        entryPrice: "814.55",
        stopLoss: "832.00",
        targetPrice: "786.00",
        timeframe: "4H",
        summary: "Momentum loss after failed recovery above VWAP."
      }
    ],
    skipDuplicates: true
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
