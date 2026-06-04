import type { Candle } from "@/types/ai-trading";

/**
 * On-Balance Volume (OBV) — volume-weighted trend confirmation.
 *
 *   close[t] > close[t-1]  →  obv += volume[t]
 *   close[t] < close[t-1]  →  obv -= volume[t]
 *   close[t] = close[t-1]  →  unchanged
 *
 * OBV by itself is just a running tally. The useful signal is its *slope*
 * relative to price: when price grinds higher but OBV is flat or falling,
 * the rally lacks volume — a classic divergence the bot avoids.
 *
 * `obvSlope` here is OBV normalized to its own 20-bar mean, so the value is
 * comparable across symbols regardless of their absolute volume scale.
 */

export type ObvReadout = {
  obv: number;
  slope: number; // normalized slope over last 20 bars, roughly in [-2, +2]
  confirmsTrend: boolean; // OBV slope sign matches price slope sign
};

export function obv(candles: Candle[], window = 20): ObvReadout {
  const n = candles.length;
  if (n < window + 1) return { obv: 0, slope: 0, confirmsTrend: false };

  const series: number[] = new Array(n);
  series[0] = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i].close;
    const p = candles[i - 1].close;
    const v = candles[i].volume;
    series[i] = series[i - 1] + (c > p ? v : c < p ? -v : 0);
  }

  // Linear-regression-ish slope of the last `window` bars, scaled by the
  // absolute level so the unit is "fraction per bar" rather than raw volume.
  const slice = series.slice(-window);
  const xMean = (window - 1) / 2;
  let yMean = 0;
  for (const v of slice) yMean += v;
  yMean /= window;
  let num = 0;
  let den = 0;
  for (let i = 0; i < window; i++) {
    num += (i - xMean) * (slice[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const rawSlope = den > 0 ? num / den : 0;
  const denom = Math.max(1, Math.abs(yMean));
  const slope = rawSlope / denom;

  // Trend confirmation: same sign as price slope.
  const priceSlice = candles.slice(-window).map((c) => c.close);
  let priceY = 0;
  for (const v of priceSlice) priceY += v;
  priceY /= window;
  let pNum = 0;
  for (let i = 0; i < window; i++) {
    pNum += (i - xMean) * (priceSlice[i] - priceY);
  }
  const priceSlope = den > 0 ? pNum / den : 0;
  const confirmsTrend = Math.sign(slope) === Math.sign(priceSlope) && Math.abs(slope) > 1e-6;

  return { obv: series[n - 1], slope, confirmsTrend };
}
