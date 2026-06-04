import type { Candle } from "@/types/ai-trading";

/**
 * ADX(14) — Average Directional Index.
 *
 * Measures *trend strength* (not direction):
 *   ADX < 20  = no trend — mean-revert regime, breakouts often fail
 *   20-25     = emerging trend
 *   25-50     = strong trend — the bot's preferred entry regime
 *   > 50      = overheated trend, exhaustion risk
 *
 * The bot uses ADX as a regime gate: pullback entries only fire when
 * ADX ≥ 18 AND +DI > -DI (the move is up, not just volatile).
 *
 * Wilder smoothing throughout — matches every charting platform's ADX.
 */

export type AdxReadout = {
  adx: number;
  plusDi: number;
  minusDi: number;
};

export function adx(candles: Candle[], len = 14): AdxReadout {
  const n = candles.length;
  if (n < len * 2) return { adx: 0, plusDi: 0, minusDi: 0 };

  // True Range, +DM, -DM
  const tr: number[] = new Array(n);
  const plusDm: number[] = new Array(n);
  const minusDm: number[] = new Array(n);
  tr[0] = candles[0].high - candles[0].low;
  plusDm[0] = 0;
  minusDm[0] = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const up = c.high - p.high;
    const dn = p.low - c.low;
    plusDm[i] = up > dn && up > 0 ? up : 0;
    minusDm[i] = dn > up && dn > 0 ? dn : 0;
  }

  // Wilder smoothing — running sum then exponential.
  let trSum = 0;
  let pdmSum = 0;
  let mdmSum = 0;
  for (let i = 1; i <= len; i++) {
    trSum += tr[i];
    pdmSum += plusDm[i];
    mdmSum += minusDm[i];
  }
  const plusDiSeries: number[] = new Array(n).fill(0);
  const minusDiSeries: number[] = new Array(n).fill(0);
  plusDiSeries[len] = trSum > 0 ? (100 * pdmSum) / trSum : 0;
  minusDiSeries[len] = trSum > 0 ? (100 * mdmSum) / trSum : 0;

  for (let i = len + 1; i < n; i++) {
    trSum = trSum - trSum / len + tr[i];
    pdmSum = pdmSum - pdmSum / len + plusDm[i];
    mdmSum = mdmSum - mdmSum / len + minusDm[i];
    plusDiSeries[i] = trSum > 0 ? (100 * pdmSum) / trSum : 0;
    minusDiSeries[i] = trSum > 0 ? (100 * mdmSum) / trSum : 0;
  }

  // DX → ADX (Wilder-smoothed DX).
  const dx: number[] = new Array(n).fill(0);
  for (let i = len; i < n; i++) {
    const sum = plusDiSeries[i] + minusDiSeries[i];
    dx[i] = sum > 0 ? (100 * Math.abs(plusDiSeries[i] - minusDiSeries[i])) / sum : 0;
  }

  let adxVal = 0;
  // First ADX = simple mean of first `len` DX values.
  let seed = 0;
  for (let i = len; i < len * 2 && i < n; i++) seed += dx[i];
  adxVal = seed / len;
  for (let i = len * 2; i < n; i++) {
    adxVal = (adxVal * (len - 1) + dx[i]) / len;
  }

  return {
    adx: adxVal,
    plusDi: plusDiSeries[n - 1],
    minusDi: minusDiSeries[n - 1]
  };
}
