/**
 * Wilder's RSI (14-period default).
 *
 * RSI is the classic momentum oscillator (0-100):
 *   < 30  = oversold (bounce-likely if trend intact)
 *   30-45 = pullback inside an uptrend — the bot's preferred buy zone
 *   45-65 = healthy momentum
 *   > 70  = overbought (chasing risk)
 *
 * The bot uses RSI to *filter out* late entries: when price has already run
 * vertical (RSI > 65), a pullback setup is much more likely to fail.
 */
export function rsi(closes: number[], len = 14): number[] {
  if (closes.length < len + 1) return closes.map(() => 50);

  const out = new Array<number>(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;

  // Seed period — simple averages of the first `len` changes.
  for (let i = 1; i <= len; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= len;
  avgLoss /= len;

  // Wilder smoothing from len+1 onward.
  for (let i = len; i < closes.length; i++) {
    if (i > len) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      avgGain = (avgGain * (len - 1) + gain) / len;
      avgLoss = (avgLoss * (len - 1) + loss) / len;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

export function lastRsi(closes: number[], len = 14): number {
  if (closes.length < len + 1) return 50;

  let avgGain = 0;
  let avgLoss = 0;

  // Seed period - simple averages of the first `len` changes.
  for (let i = 1; i <= len; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= len;
  avgLoss /= len;

  // Wilder smoothing to the latest bar only.
  for (let i = len + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (len - 1) + gain) / len;
    avgLoss = (avgLoss * (len - 1) + loss) / len;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
