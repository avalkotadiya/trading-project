/**
 * Bollinger Bands (20, 2σ) — %B and bandwidth.
 *
 *   middle = SMA(20)
 *   upper  = middle + 2·stdev(20)
 *   lower  = middle - 2·stdev(20)
 *
 *   %B     = (price - lower) / (upper - lower)
 *            0.00 = price at lower band, 0.50 = mid, 1.00 = upper, > 1 = blown out
 *   width  = (upper - lower) / middle — volatility regime gauge
 *
 * The bot prefers entries when 0.10 < %B < 0.55 (pullback to the mid/lower
 * half of the band, not chasing a top) AND width is in a normal range
 * (extremely narrow = squeeze, extremely wide = exhaustion risk).
 */

export type BollingerReadout = {
  middle: number;
  upper: number;
  lower: number;
  pctB: number;
  width: number;
};

function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function stdevOf(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.sqrt(s / xs.length);
}

export function bollinger(closes: number[], len = 20, mult = 2): BollingerReadout {
  if (closes.length < len) {
    const last = closes[closes.length - 1] ?? 0;
    return { middle: last, upper: last, lower: last, pctB: 0.5, width: 0 };
  }
  const slice = closes.slice(-len);
  const middle = meanOf(slice);
  const sd = stdevOf(slice, middle);
  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const last = closes[closes.length - 1];
  const denom = upper - lower;
  const pctB = denom > 0 ? (last - lower) / denom : 0.5;
  const width = middle > 0 ? (upper - lower) / middle : 0;
  return { middle, upper, lower, pctB, width };
}
