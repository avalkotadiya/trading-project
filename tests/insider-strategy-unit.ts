/**
 * Deterministic checks for insider-strategy ranking/filter logic.
 *
 * Run with:
 *   npx tsx tests/insider-strategy-unit.ts
 */

import { __test__ } from "@/app/api/insider-strategy/route";
import type { StockSignal } from "@/types/market-pulse";

const { toInsiderSignal, rankInsiderSignals } = __test__;

let failed = 0;
function expect(label: string, condition: boolean, detail?: string) {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` - ${detail}` : ""}`);
  if (!condition) failed += 1;
}

function makeSignal(symbol: string, patch: Partial<StockSignal> = {}): StockSignal {
  return {
    symbol,
    companyName: `${symbol} Corp`,
    exchange: "NSE",
    logoUrl: "",
    price: 100,
    volume: 100000,
    volumeMultiplier: 1,
    percentChange: 1.2,
    signalPercent: 60,
    time: "10:00:00",
    signal: "bullish",
    signalIcon: "bull",
    rFactor: 2,
    rFactorChange: 5,
    pattern: "Buying pressure",
    isBookmarked: false,
    category: "intraday-boost",
    source: "unit-test",
    relativeVolume: 2,
    relativeStrength: 70,
    moneyFlux: 15,
    rangePct: 1.1,
    coiled: false,
    nearDayHigh: false,
    nearDayLow: false,
    ...patch
  };
}

console.log("============================================================");
console.log("INSIDER STRATEGY UNIT");
console.log("============================================================");

{
  const keep = toInsiderSignal(makeSignal("AAA", { relativeVolume: 2.0, moneyFlux: 20 }));
  const dropLowRvol = toInsiderSignal(makeSignal("BBB", { relativeVolume: 1.05, moneyFlux: 30 }));
  const dropLowFlux = toInsiderSignal(makeSignal("CCC", { relativeVolume: 2.4, moneyFlux: 4 }));
  const dropBadPrice = toInsiderSignal(makeSignal("DDD", { price: 0 }));

  expect("keeps valid high-conviction signal", Boolean(keep));
  expect("filters low RVOL", dropLowRvol === null);
  expect("filters low |flux|", dropLowFlux === null);
  expect("filters invalid price", dropBadPrice === null);
}

{
  const pos = toInsiderSignal(makeSignal("EEE", { moneyFlux: 12 }));
  const neg = toInsiderSignal(makeSignal("FFF", { moneyFlux: -14 }));
  expect("positive flux => accumulation", pos?.bias === "accumulation");
  expect("negative flux => distribution", neg?.bias === "distribution");
}

{
  const ranked = rankInsiderSignals([
    makeSignal("AAA", { moneyFlux: 12, relativeVolume: 2.4 }),
    makeSignal("AAA", { moneyFlux: 25, relativeVolume: 2.6 }),
    makeSignal("BBB", { moneyFlux: -18, relativeVolume: 2.0 }),
    makeSignal("CCC", { moneyFlux: 9, relativeVolume: 1.5 })
  ]);

  const aaa = ranked.find((r) => r.symbol === "AAA");
  expect("dedup keeps strongest symbol row", aaa?.moneyFlux === 25, `flux=${aaa?.moneyFlux}`);
  expect("ranked array non-empty", ranked.length > 0);
}

{
  // Tie on conviction => stronger |flux| should rank first.
  const ranked = rankInsiderSignals([
    makeSignal("X1", { moneyFlux: 10, relativeVolume: 2.0 }),
    makeSignal("X2", { moneyFlux: 16, relativeVolume: 1.25 }) // same conviction 20
  ]);
  expect("tie-break by absolute flux", ranked[0]?.symbol === "X2", `first=${ranked[0]?.symbol}`);
}

console.log("============================================================");
if (failed > 0) {
  console.log(`INSIDER STRATEGY UNIT: ${failed} FAILED CHECK(S)`);
  process.exit(1);
}
console.log("INSIDER STRATEGY UNIT: ALL CHECKS PASSED");
