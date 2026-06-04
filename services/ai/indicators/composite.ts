/**
 * Composite quality score (0-100) — what the bot actually trades on.
 *
 * Inputs come from the backtest (edge%, win rate, payoff) and the live
 * indicator stack (RSI, MACD, ADX, OBV, Bollinger %B). Each contributor
 * is scored 0-100, then a weighted average is taken. The weights bias
 * toward the *backtested edge* — indicators are confirmation, not the thesis.
 *
 * The score multiplies the user's Half-Kelly stake. A 90-score setup gets
 * close to full Kelly; a 55-score (the default gate) gets ~half of that.
 * Setups below the gate are rejected outright.
 *
 * Why a blended score instead of hard yes/no filters:
 *  - A great backtest with weak RSI/MACD still has value — just trade smaller.
 *  - Hard filters waste signal; sizing-by-quality keeps every good setup in.
 */

export type CompositeInputs = {
  edgePct: number;        // backtested EV per trade (%)
  winProb: number;        // 0-100
  payoff: number;         // avgWin / avgLoss
  rsi14: number;          // 0-100
  macdHist: number;       // any sign
  macdHistSlope: number;  // any sign
  adx14: number;          // 0-100
  plusDi: number;
  minusDi: number;
  bbPctB: number;         // 0..1+
  obvSlope: number;       // normalized
  rvol: number;           // relative volume
};

export type CompositeReadout = {
  score: number;          // 0-100 final
  parts: Record<string, number>; // for the UI tooltip
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  clamp(y0 + ((x - x0) * (y1 - y0)) / (x1 - x0), Math.min(y0, y1), Math.max(y0, y1));

/** Triangular score: y=100 at peak, falls linearly to 0 at edges/clamp. */
function bell(x: number, low: number, peak: number, high: number): number {
  if (x <= low || x >= high) return 0;
  if (x <= peak) return ((x - low) / (peak - low)) * 100;
  return ((high - x) / (high - peak)) * 100;
}

export function composite(input: CompositeInputs): CompositeReadout {
  // 1. Edge — the backtest is the prior. Anchor at the user's typical gate.
  //    edgePct=0 → 0, edgePct=0.35 → 60, edgePct=1.0 → 95.
  const sEdge = lerp(input.edgePct, 0, 1.0, 0, 95);

  // 2. Win rate — anything above 55% adds, below 45% subtracts.
  const sWin = lerp(input.winProb, 35, 70, 0, 100);

  // 3. Payoff — 1R = neutral 50, 3R = 100, 0.5R = 0.
  const sPayoff = lerp(input.payoff, 0.5, 3.0, 0, 100);

  // 4. RSI sweet spot is 35-55 (pullback inside an uptrend, not chasing a top).
  //    Below 30 = oversold but possibly broken trend. Above 70 = overbought.
  const sRsi = bell(input.rsi14, 25, 45, 70);

  // 5. MACD histogram positive + accelerating = full credit. Falling histogram
  //    even if still positive earns half. Negative = 0.
  let sMacd = 0;
  if (input.macdHist > 0) {
    sMacd = input.macdHistSlope >= 0 ? 100 : 60;
  } else if (input.macdHist > -0.1) {
    sMacd = 30; // very close to zero — call it neutral, not bearish
  }

  // 6. ADX: 18 = 50 (gate), 30+ = 100. <12 = 0 (chop, breakouts die).
  //    Direction must be +DI > -DI or we zero out.
  const sAdxBase = lerp(input.adx14, 12, 30, 0, 100);
  const sAdx = input.plusDi > input.minusDi ? sAdxBase : sAdxBase * 0.3;

  // 7. Bollinger %B: ideal pullback is 0.15-0.55. Above 0.85 = chasing.
  const sBb = bell(input.bbPctB, 0.0, 0.35, 0.85);

  // 8. OBV slope positive = trend has volume behind it. Negative = divergence.
  const sObv = input.obvSlope > 0 ? lerp(input.obvSlope, 0, 0.05, 50, 100) : lerp(input.obvSlope, -0.05, 0, 0, 50);

  // 9. Relative volume — 1.0 normal, > 1.5 conviction.
  const sRvol = lerp(input.rvol, 0.6, 1.8, 20, 100);

  // Weights (sum to 1.00). Edge dominates because it's a *real* backtest;
  // everything else is confirmation. Kept here so it's easy to tune.
  const weights = {
    edge: 0.28,
    win: 0.08,
    payoff: 0.10,
    rsi: 0.10,
    macd: 0.12,
    adx: 0.12,
    bb: 0.08,
    obv: 0.07,
    rvol: 0.05
  };

  const score =
    sEdge * weights.edge +
    sWin * weights.win +
    sPayoff * weights.payoff +
    sRsi * weights.rsi +
    sMacd * weights.macd +
    sAdx * weights.adx +
    sBb * weights.bb +
    sObv * weights.obv +
    sRvol * weights.rvol;

  return {
    score: Math.round(clamp(score, 0, 100)),
    parts: {
      edge: Math.round(sEdge),
      win: Math.round(sWin),
      payoff: Math.round(sPayoff),
      rsi: Math.round(sRsi),
      macd: Math.round(sMacd),
      adx: Math.round(sAdx),
      bb: Math.round(sBb),
      obv: Math.round(sObv),
      rvol: Math.round(sRvol)
    }
  };
}
