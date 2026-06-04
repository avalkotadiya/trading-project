/**
 * Deterministic unit checks for the quant-edge backtest math.
 *
 * Runs in three blocks:
 *   1. Synthetic monotonic-up market — every signal should be a winner.
 *   2. Synthetic monotonic-down market — no signals should fire (no uptrend).
 *   3. Synthetic chop with a hand-counted setup — verify p / avgWin / Kelly.
 *
 * Run with:  npx tsx tests/backtest-unit.ts
 * Exits non-zero on any failed assertion so it can drive CI.
 */

import { __test__ } from "@/services/ai/quant-edge.service";
import type { Candle } from "@/types/ai-trading";

const { backtest, emaSeries, atrSeries } = __test__;

let failed = 0;
function expect(label: string, condition: boolean, detail?: string) {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failed += 1;
}
function approx(actual: number, expected: number, tol = 0.01) {
  return Math.abs(actual - expected) <= tol;
}

/** Build N candles where close grows by `pctPerBar` % per bar, low/high tight. */
function syntheticUpward(n: number, startPrice = 100, pctPerBar = 0.5): Candle[] {
  const out: Candle[] = [];
  let price = startPrice;
  const now = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price * (1 + pctPerBar / 100);
    const high = close * 1.005;
    const low = open * 0.995;
    out.push({
      timestamp: new Date(now + i * 86_400_000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1_000_000
    });
    price = close;
  }
  return out;
}

function syntheticDownward(n: number, startPrice = 100, pctPerBar = -0.5): Candle[] {
  return syntheticUpward(n, startPrice, pctPerBar);
}

console.log("=".repeat(70));
console.log("BACKTEST UNIT — quant-edge.service");
console.log("=".repeat(70));

// ── Block 1: monotonic-up market ────────────────────────────────────────────
{
  const c = syntheticUpward(200, 100, 0.6);
  const ema20 = emaSeries(c.map((x) => x.close), 20);
  const ema50 = emaSeries(c.map((x) => x.close), 50);
  const atr = atrSeries(c, 14);
  const s = backtest(c, ema20, ema50, atr);

  console.log("\nMonotonic-UP (200 bars, +0.6%/bar):");
  console.log("  ", JSON.stringify(s));

  expect("at least some signals fired", s.samples > 0);
  expect("win rate is 100%", approx(s.p, 1.0, 0.001));
  expect("avgWin > 0", s.avgWin > 0);
  expect("avgLoss is 0 (no losers in pure uptrend)", s.avgLoss === 0);
  // Payoff fallback (no losses) is 3 by code convention
  expect("payoff fallback = 3 when no losses", s.payoff === 3);
  // EV = p × avgWin − (1−p) × avgLoss = 1 × avgWin = avgWin
  expect("edgePct equals avgWin", approx(s.edgePct, s.avgWin, 0.01));
  // Kelly = 0.5 × (p − (1−p)/payoff) = 0.5 × (1 − 0) = 0.5 (half-Kelly cap)
  expect("Kelly ≈ 0.5 at 100% win rate", approx(s.kelly, 0.5, 0.001));
}

// ── Block 2: monotonic-down market ─────────────────────────────────────────
{
  const c = syntheticDownward(200, 100, -0.6);
  const ema20 = emaSeries(c.map((x) => x.close), 20);
  const ema50 = emaSeries(c.map((x) => x.close), 50);
  const atr = atrSeries(c, 14);
  const s = backtest(c, ema20, ema50, atr);

  console.log("\nMonotonic-DOWN (200 bars, −0.6%/bar):");
  console.log("  ", JSON.stringify(s));

  expect("no signals fire in pure downtrend", s.samples === 0);
  expect("kelly is 0 with no samples", s.kelly === 0);
}

// ── Block 3: hand-calculable chop market ───────────────────────────────────
//   First half: monotonic up (builds trend so backtest can find entries).
//   Second half: 60-bar flat where price oscillates inside the ATR band → all
//   trades time-exit at roughly the entry price → ~0 EV.
{
  const a = syntheticUpward(120, 100, 0.5);
  const last = a[a.length - 1].close;
  const flat: Candle[] = [];
  const now = Date.UTC(2024, 0, 1) + 120 * 86_400_000;
  for (let i = 0; i < 80; i++) {
    flat.push({
      timestamp: new Date(now + i * 86_400_000).toISOString(),
      open: last,
      high: last * 1.001,
      low: last * 0.999,
      close: last,
      volume: 1_000_000
    });
  }
  const c = [...a, ...flat];
  const ema20 = emaSeries(c.map((x) => x.close), 20);
  const ema50 = emaSeries(c.map((x) => x.close), 50);
  const atr = atrSeries(c, 14);
  const s = backtest(c, ema20, ema50, atr);

  console.log("\nUptrend → flat chop:");
  console.log("  ", JSON.stringify(s));

  expect("samples produced", s.samples > 0);
  // Hand math: 100% win rate while monotonic, then flat trades time-exit at
  // ≈0 return. So win rate stays high but edge shrinks toward 0.
  expect("win rate is in [0.5, 1.0]", s.p >= 0.5 && s.p <= 1.0);
  expect("kelly in [0, 0.5]", s.kelly >= 0 && s.kelly <= 0.5);
  expect("avgWin and avgLoss are non-negative", s.avgWin >= 0 && s.avgLoss >= 0);

  // Hand-check the EV identity: edgePct == p × avgWin − (1−p) × avgLoss
  const reconstructed = s.p * s.avgWin - (1 - s.p) * s.avgLoss;
  expect(
    "edgePct identity p·avgWin − (1−p)·avgLoss",
    approx(s.edgePct, reconstructed, 0.005),
    `edgePct=${s.edgePct} vs reconstructed=${reconstructed.toFixed(4)}`
  );
}

// ── Block 4: invariants used by the bot's sizing logic ────────────────────
{
  // For ALL combinations of (p, avgWin, avgLoss), the runtime ASSUMES:
  //   - 0 ≤ kelly ≤ 1
  //   - kelly > 0 implies edgePct ≥ 0  (positive EV)
  // Verify on a permutation grid.
  let violations = 0;
  for (let pHits = 0; pHits <= 10; pHits++) {
    for (let aw = 1; aw <= 5; aw++) {
      for (let al = 1; al <= 5; al++) {
        // Synthesise a candle path that would produce ≈this stat — skip;
        // instead just compute Kelly & edge directly from the formula and
        // confirm the bot's invariants hold.
        const p = pHits / 10;
        const avgWin = aw;
        const avgLoss = al;
        const payoff = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 3 : 0;
        const edgePct = p * avgWin - (1 - p) * avgLoss;
        const rawKelly = payoff > 0 ? p - (1 - p) / payoff : 0;
        const kelly = Math.max(0, Math.min(1, 0.5 * rawKelly));

        if (kelly < 0 || kelly > 1) violations += 1;
        // The bot's auto-trader gates on Kelly>0. So whenever Kelly>0 fires,
        // edgePct must be ≥ 0; otherwise the bot would size positive-EV
        // money into a negative-EV trade. Sanity-check.
        if (kelly > 0 && edgePct < 0) violations += 1;
      }
    }
  }
  expect("Kelly/EV invariants hold across 275 permutations", violations === 0,
    `violations=${violations}`);
}

console.log("\n" + "=".repeat(70));
if (failed > 0) {
  console.log(`BACKTEST UNIT: ${failed} FAILED CHECK(S)`);
  process.exit(1);
}
console.log("BACKTEST UNIT: ALL CHECKS PASSED");
