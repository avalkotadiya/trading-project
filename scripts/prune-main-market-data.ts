import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { isMainExactSymbol } from "@/lib/live-market-priority";

function parseSymbolFromKey(key: string) {
  const index = key.indexOf(":");
  if (index < 0) return key.trim().toUpperCase();
  return key.slice(index + 1).trim().toUpperCase();
}

async function main() {
  const distinct = await prisma.marketTick.findMany({
    select: { symbol: true },
    distinct: ["symbol"]
  });

  const drop = distinct
    .map((row) => row.symbol)
    .filter((key) => !isMainExactSymbol("all", parseSymbolFromKey(key)));

  if (drop.length === 0) {
    console.log("[prune-main-market-data] No non-main symbols found. Nothing to delete.");
    return;
  }

  const CHUNK_SIZE = 200;
  let deletedRows = 0;
  for (let index = 0; index < drop.length; index += CHUNK_SIZE) {
    const chunk = drop.slice(index, index + CHUNK_SIZE);
    const result = await prisma.marketTick.deleteMany({
      where: {
        symbol: { in: chunk }
      }
    });
    deletedRows += result.count;
  }

  console.log(
    `[prune-main-market-data] Deleted ${deletedRows} rows across ${drop.length} non-main symbols.`
  );
}

main()
  .catch((error) => {
    console.error("[prune-main-market-data] Failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
