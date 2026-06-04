import "dotenv/config";

import { getSectionSymbols, type SectionId } from "@/services/symbols/symbol-registry";
import { normalizeDhanChartRequest } from "@/services/dhan/dhanChartValidation";

const SECTIONS: SectionId[] = [
  "dashboard",
  "charts",
  "watchlist",
  "scanner",
  "bot-universe",
  "futures",
  "options",
  "commodity",
  "currency",
  "etf",
  "all"
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const fromDate = todayIso();
  const toDate = fromDate;
  let failures = 0;

  for (const section of SECTIONS) {
    const view = await getSectionSymbols(section);
    const invalid: Array<{ symbol: string; securityId: string; reason: string }> = [];

    for (const symbol of view.symbols) {
      try {
        normalizeDhanChartRequest({
          securityId: symbol.securityId,
          exchangeSegment: symbol.exchangeSegment,
          instrument: symbol.chartInstrument,
          fromDate,
          toDate
        });
      } catch (error) {
        invalid.push({
          symbol: `${symbol.exchange}:${symbol.symbol}`,
          securityId: symbol.securityId,
          reason: error instanceof Error ? error.message : "unknown"
        });
      }
    }

    failures += invalid.length;
    console.log(
      `[DhanChartAudit] ${section}: ${view.count - invalid.length}/${view.count} chart-compatible` +
        (invalid.length ? `, invalid=${invalid.length}` : "")
    );

    for (const item of invalid.slice(0, 25)) {
      console.log(`  - ${item.symbol} (${item.securityId}): ${item.reason}`);
    }
    if (invalid.length > 25) {
      console.log(`  ... ${invalid.length - 25} more`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[DhanChartAudit] failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
