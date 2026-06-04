/**
 * Smoke test: pull the real Dhan scrip master, build the India-only registry
 * with all cleanup filters, and print the section/segment breakdown so we
 * can verify the "unwanted symbols" pruning is doing what we expect.
 *
 * Run:  npx tsx scripts/registry-smoke.ts
 */

import { getRegistryHealth, getSectionSymbols, resolveSymbol } from "@/services/symbols/symbol-registry";

async function main() {
  console.log("Building India-only symbol registry from the live Dhan master…");
  const t0 = Date.now();
  const health = await getRegistryHealth();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nBuilt in ${elapsed}s · ${health.totalSymbols} clean symbols\n`);

  console.log("Per-section counts:");
  for (const [section, n] of Object.entries(health.bySection).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${section.padEnd(16)} ${String(n).padStart(7)}`);
  }

  console.log("\nPer-segment counts:");
  for (const [segment, n] of Object.entries(health.bySegment).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${segment.padEnd(16)} ${String(n).padStart(7)}`);
  }

  console.log("\nRejection breakdown (rows pruned from the master):");
  for (const [reason, n] of Object.entries(health.rejections).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(16)} ${String(n).padStart(7)}`);
  }

  // Spot-check a few well-known symbols
  console.log("\nResolver spot-checks (O(1) index lookups):");
  for (const input of ["NSE:RELIANCE", "RELIANCE", "NSE:NIFTY", "BSE:SENSEX", "NSE:DOESNOTEXIST"]) {
    const r = await resolveSymbol(input);
    console.log(`  ${input.padEnd(22)} → ${r ? `${r.exchange}:${r.symbol} (${r.exchangeSegment}, ${r.instrument})` : "NOT FOUND"}`);
  }

  // Show the dashboard view in full so we can eyeball the curated list
  const dashboard = await getSectionSymbols("dashboard");
  console.log(`\nDashboard view (${dashboard.symbols.length} symbols):`);
  for (const s of dashboard.symbols) {
    console.log(`  ${s.exchange}:${s.symbol.padEnd(14)} · ${s.segmentLabel}`);
  }

  // Diagnostic: what NSE equities starting with R do we actually have?
  const scanner = await getSectionSymbols("scanner");
  const startsR = scanner.symbols.filter((s) => s.exchange === "NSE" && s.symbol.startsWith("R")).slice(0, 20);
  console.log(`\nNSE equities starting with "R" in registry (first 20):`);
  for (const s of startsR) {
    console.log(`  ${s.symbol.padEnd(20)} · ${s.tradingSymbol.padEnd(20)} · ${s.name}`);
  }
  // And what about NIFTY-named instruments
  const niftyish = scanner.symbols.filter((s) => s.symbol.includes("NIFTY")).slice(0, 10);
  const all = await getSectionSymbols("all");
  const niftyAll = all.symbols.filter((s) => s.symbol.includes("NIFTY") || s.tradingSymbol.includes("NIFTY")).slice(0, 10);
  console.log(`\nNIFTY-named in scanner (${niftyish.length}):`);
  for (const s of niftyish) console.log(`  ${s.exchange}:${s.symbol} · ${s.tradingSymbol} · ${s.segmentLabel}`);
  console.log(`\nNIFTY-named in any section (first 10):`);
  for (const s of niftyAll) console.log(`  ${s.exchange}:${s.symbol} · ${s.tradingSymbol} · ${s.segmentLabel}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
