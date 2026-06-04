import { cacheGetOrSet } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { getMarketSnapshot } from "@/services/market-service";
import { buildMarketPulseSignals } from "@/services/market-pulse";
import { SCANNER_PRO_SYMBOLS } from "@/services/scanner-pro";
import { getSector } from "@/lib/sector-map";
import type { MarketPulseCategory } from "@/types/market-pulse";
import type { ScannerAlpha, BotScannerSummary } from "@/types/bot";

/**
 * Scanner-Confluence strategy
 * ---------------------------
 * Turns the live Scanner-Pro feed (breakout / intraday breadth, relative
 * strength, relative volume, money-flux) into a per-symbol *alpha* score the
 * AI Quant bot uses to confirm and size its quant-edge entries.
 *
 * The quant-edge model decides "is this a statistically tradeable setup?".
 * This layer answers "is the live tape *also* confirming it right now?" — so
 * the bot only deploys when the historical edge AND the live order-flow agree.
 *
 *   confluenceScore (0-100) = blend of
 *     • signalPercent   (scanner conviction toward its bullish/bearish call)
 *     • relativeStrength (percentile vs the scanned universe)
 *     • moneyFlux        (net order-flow accumulation/distribution)
 *     • relativeVolume   (participation)
 *
 * A bullish, high-RS, accumulation name scores ~80-100; a bearish, weak,
 * distribution name scores near 0. The bot multiplies its per-trade sizing by
 * a boost derived from this score and (optionally) hard-skips bearish tape.
 */

const SCANNER_ALPHA_CACHE_KEY = "bot:scanner-alpha:v1";
const SCANNER_ALPHA_CACHE_SECONDS = Math.max(
  5,
  Number(process.env.BOT_SCANNER_ALPHA_CACHE_SECONDS || "30")
);

// Categories blended into the confluence read. Breakout captures structural
// strength; intraday-boost captures live momentum. We keep the stronger of the
// two so a name confirmed on either basis is recognised.
const CONFLUENCE_CATEGORIES: MarketPulseCategory[] = ["breakout-beacon", "intraday-boost"];

// When true, the bot refuses to enter names the scanner reads as actively
// bearish (distribution tape) even if the quant edge is positive. Default off
// so paper-mode demos still trade on quiet/neutral days.
export const SCANNER_REQUIRE_CONFIRM =
  (process.env.BOT_SCANNER_REQUIRE_CONFIRM ?? "false").toLowerCase() === "true";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function confluenceScore(parts: {
  signal: "bullish" | "bearish" | "neutral";
  signalPercent: number;
  relativeStrength: number;
  moneyFlux: number;
  relativeVolume: number;
}): number {
  // signalPercent is 1-99 around 50; fold direction in so a strong bearish
  // reading drags the score down rather than up.
  const directional =
    parts.signal === "bearish" ? 100 - parts.signalPercent : parts.signalPercent;
  const fluxNorm = (parts.moneyFlux + 100) / 2; // -100..100 → 0..100
  const rvolNorm = clamp((parts.relativeVolume - 0.6) * 45, 0, 100); // ~1x→18, ~2.5x→85
  const score =
    0.42 * directional +
    0.26 * parts.relativeStrength +
    0.18 * fluxNorm +
    0.14 * rvolNorm;
  return Number(clamp(score, 0, 100).toFixed(1));
}

export type ScannerAlphaResult = {
  alpha: Map<string, ScannerAlpha>;
  summary: BotScannerSummary;
};

async function computeScannerAlpha(): Promise<ScannerAlphaResult> {
  const snapshot = await getMarketSnapshot(SCANNER_PRO_SYMBOLS).catch((error) => {
    logger.warn(
      `[ScannerStrategy] snapshot failed: ${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  });

  const ticks = snapshot?.ticks ?? [];
  const alpha = new Map<string, ScannerAlpha>();

  if (ticks.length === 0) {
    return {
      alpha,
      summary: { breadth: 0, avgRvol: 0, bullish: 0, bearish: 0, analyzed: 0, leaders: [] }
    };
  }

  // Build signals for each confluence category, then keep the strongest read
  // per symbol so a name confirmed by either lens is captured.
  for (const category of CONFLUENCE_CATEGORIES) {
    const { data } = buildMarketPulseSignals(ticks, category, { limit: 999 });
    for (const s of data) {
      const score = confluenceScore({
        signal: s.signal,
        signalPercent: s.signalPercent,
        relativeStrength: s.relativeStrength ?? 50,
        moneyFlux: s.moneyFlux ?? 0,
        relativeVolume: s.relativeVolume ?? 1
      });
      const existing = alpha.get(s.symbol);
      if (existing && existing.score >= score) continue;
      alpha.set(s.symbol, {
        symbol: s.symbol,
        sector: getSector(s.symbol),
        signal: s.signal,
        signalPercent: s.signalPercent,
        rFactor: s.rFactor,
        relativeStrength: s.relativeStrength ?? 50,
        relativeVolume: s.relativeVolume ?? 1,
        moneyFlux: s.moneyFlux ?? 0,
        score
      });
    }
  }

  const list = [...alpha.values()];
  const bullish = list.filter((a) => a.signal === "bullish").length;
  const bearish = list.filter((a) => a.signal === "bearish").length;
  const breadth = list.length > 0 ? Math.round(((bullish - bearish) / list.length) * 100) : 0;
  const avgRvol =
    list.length > 0
      ? Number((list.reduce((acc, a) => acc + a.relativeVolume, 0) / list.length).toFixed(2))
      : 0;
  const leaders = [...list]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((a) => ({ symbol: a.symbol, score: a.score, signal: a.signal }));

  return {
    alpha,
    summary: { breadth, avgRvol, bullish, bearish, analyzed: list.length, leaders }
  };
}

/**
 * Cached scanner-alpha read. Serialised through Redis as a plain object map so
 * it survives across the per-cycle and per-state-poll callers without
 * recomputing the whole scanner universe every few seconds.
 */
export async function getScannerAlpha(): Promise<ScannerAlphaResult> {
  const cached = await cacheGetOrSet(
    SCANNER_ALPHA_CACHE_KEY,
    SCANNER_ALPHA_CACHE_SECONDS,
    async () => {
      const { alpha, summary } = await computeScannerAlpha();
      return { entries: [...alpha.values()], summary };
    }
  );

  const alpha = new Map<string, ScannerAlpha>();
  for (const entry of cached.entries) alpha.set(entry.symbol, entry);
  return { alpha, summary: cached.summary };
}

/**
 * Per-symbol sizing multiplier + confirmation verdict for a quant-edge
 * candidate. Multiplier in [0.7, 1.3]:
 *   • strong bullish confluence (score ≥ 70) → up to 1.3× (lean in)
 *   • neutral / unknown                       → 1.0× (no opinion)
 *   • bearish tape                            → down to 0.7× (lean out)
 * `block` is true only when SCANNER_REQUIRE_CONFIRM is on AND the tape is
 * actively bearish — the caller skips the entry entirely.
 */
export function scannerVerdict(
  symbol: string,
  alpha: Map<string, ScannerAlpha>
): { boost: number; score: number | null; signal: ScannerAlpha["signal"] | null; block: boolean; label: string } {
  const a = alpha.get(symbol);
  if (!a) {
    return { boost: 1, score: null, signal: null, block: false, label: "no scanner read" };
  }

  // Map 0-100 confluence → 0.7-1.3 multiplier centred on 50 = 1.0.
  const boost = Number(clamp(0.7 + (a.score / 100) * 0.6, 0.7, 1.3).toFixed(3));
  const bearishTape = a.signal === "bearish" && a.score < 42;
  const block = SCANNER_REQUIRE_CONFIRM && bearishTape;
  const label =
    a.signal === "bullish"
      ? `scanner bullish ${a.score.toFixed(0)} · RS ${a.relativeStrength.toFixed(0)}`
      : a.signal === "bearish"
        ? `scanner bearish ${a.score.toFixed(0)}`
        : `scanner neutral ${a.score.toFixed(0)}`;
  return { boost, score: a.score, signal: a.signal, block, label };
}
