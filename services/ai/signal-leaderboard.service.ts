import type { ScannerResult } from "@/types/market";
import type { FeaturedSignal } from "@/types/platform";

export function buildSignalLeaderboard(results: ScannerResult[], limit = 5): FeaturedSignal[] {
  return results
    .map((result) => {
      const direction: FeaturedSignal["direction"] =
        result.signal === "bullish" ? "BULLISH" : result.signal === "bearish" ? "BEARISH" : "NEUTRAL";
      const riskBuffer = direction === "BULLISH" ? 0.025 : direction === "BEARISH" ? -0.025 : 0;

      return {
        symbol: result.symbol,
        direction,
        confidence: Math.max(10, Math.min(96, Math.round(result.momentumScore))),
        strategy: result.relativeVolume >= 2.5 ? "Live Volume Breakout" : "Live Momentum Continuation",
        entryPrice: result.price,
        stopLoss: direction === "NEUTRAL" ? null : Number((result.price * (direction === "BULLISH" ? 0.975 : 1.025)).toFixed(2)),
        targetPrice: direction === "NEUTRAL" ? null : Number((result.price * (1 + riskBuffer * 2)).toFixed(2)),
        timeframe: "intraday",
        summary: `${result.symbol} scored ${result.momentumScore}/100 from live market momentum, range location, and relative volume. ${result.setup}`
      } satisfies FeaturedSignal;
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
}
