/**
 * MACD — Moving Average Convergence Divergence.
 *
 * Standard (12, 26, 9):
 *   macdLine    = EMA(12) - EMA(26)
 *   signalLine  = EMA(9) of macdLine
 *   histogram   = macdLine - signalLine
 *
 * The bot reads the *histogram*: positive + rising means short-term momentum
 * is accelerating in the direction of the trend; negative or falling means
 * the impulse is fading — even if the long-term trend is still up.
 *
 * The bot requires histogram > 0 to confirm a pullback entry isn't being
 * bought into a fresh downturn.
 */

export type MacdReadout = {
  macd: number;
  signal: number;
  histogram: number;
  histogramSlope: number; // (latest - 3 bars ago) — positive = accelerating
};

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalLen = 9
): MacdReadout {
  if (closes.length < slow + signalLen) {
    return { macd: 0, signal: 0, histogram: 0, histogramSlope: 0 };
  }
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  const kSignal = 2 / (signalLen + 1);

  let emaFast = closes[0];
  let emaSlow = closes[0];
  let signal = 0;
  let macdVal = 0;
  const tail: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const price = closes[i];
    if (i > 0) {
      emaFast = price * kFast + emaFast * (1 - kFast);
      emaSlow = price * kSlow + emaSlow * (1 - kSlow);
      macdVal = emaFast - emaSlow;
      signal = macdVal * kSignal + signal * (1 - kSignal);
    }

    const hist = macdVal - signal;
    tail.push(hist);
    if (tail.length > 4) tail.shift();
  }

  const histogram = tail[tail.length - 1] ?? 0;
  const prev = tail.length >= 4 ? tail[0] : tail[0] ?? 0;
  return {
    macd: macdVal,
    signal,
    histogram,
    histogramSlope: histogram - prev
  };
}
