import { getSector } from "@/lib/sector-map";
import { MIN_SAMPLES, type EdgeSignal } from "@/services/ai/quant-edge.service";
import type { BotRecommendation, BotScannerSummary } from "@/types/bot";

/**
 * Bot settings recommender
 * ------------------------
 * Produces sensible, data-driven defaults for the four knobs the user would
 * otherwise have to guess at:
 *
 *   • maxDeployedCapital      — how much of the wallet to put to work
 *   • botTrailStartPct / Distance — trailing stop tuned to live volatility
 *   • botMaxSectorExposurePct — diversification cap tuned to opportunity breadth
 *   • botEntryWindow          — when to allow entries given volatility
 *
 * Everything is derived from: the user's wallet balance, the live quant-edge
 * candidate set (ATR%, composite quality, sector spread) and the Scanner-Pro
 * confluence summary (market breadth). The user can accept these as defaults
 * or override any single field — see the bot Settings tab.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeBotRecommendation(input: {
  walletBalance: number;
  edges: EdgeSignal[];
  scanner: BotScannerSummary | null;
}): BotRecommendation {
  const { walletBalance, edges, scanner } = input;

  // Focus the analysis on the candidates the bot would actually consider:
  // genuine uptrend setups with a real backtested sample, ranked by quality.
  const tradeable = edges
    .filter((e) => e.inSetup && e.sampleSize >= MIN_SAMPLES && e.price > 0)
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const sample = tradeable.length > 0 ? tradeable.slice(0, 24) : edges.slice(0, 24);

  const atrPcts = sample
    .map((e) => (e.price > 0 ? (e.atr / e.price) * 100 : 0))
    .filter((v) => v > 0);
  const medianAtrPct = Number((median(atrPcts) || 2).toFixed(2));

  const avgCompositeScore =
    sample.length > 0
      ? Math.round(sample.reduce((acc, e) => acc + e.compositeScore, 0) / sample.length)
      : 0;

  const distinctSectors = new Set(sample.map((e) => getSector(e.symbol))).size || 1;
  const scannerBreadth = scanner?.breadth ?? 0;

  // ── 1) Deployment cap ────────────────────────────────────────────────────
  // Base ~55% of wallet, leaning in when (a) the live tape is broad/bullish
  // and (b) the candidate quality is high; leaning out otherwise. Capped at
  // 85% so the wallet always keeps dry powder, floored at 30%.
  const breadthLift = (scannerBreadth / 100) * 0.18;
  const qualityLift = avgCompositeScore > 0 ? ((avgCompositeScore - 50) / 100) * 0.22 : 0;
  const deployFraction = clamp(0.55 + breadthLift + qualityLift, 0.3, 0.85);
  const rawCapital = walletBalance * deployFraction;
  // Round to a tidy ₹ figure: nearest 1,000 above ₹20k, else nearest 500.
  const step = rawCapital >= 20000 ? 1000 : 500;
  const maxDeployedCapital = clamp(
    roundTo(rawCapital, step),
    Math.min(walletBalance, 1000),
    walletBalance
  );

  // ── 2) Trailing stop ──────────────────────────────────────────────────────
  // Start trailing once the trade clears ~1.6× the typical daily ATR move, and
  // trail ~0.9× ATR behind the peak. Keeps winners running without choking on
  // ordinary volatility. Bounded so the figures stay sane on quiet/wild days.
  const botTrailStartPct = Number(clamp(roundTo(medianAtrPct * 1.6, 0.5), 1.5, 8).toFixed(1));
  const botTrailDistancePct = Number(
    clamp(roundTo(medianAtrPct * 0.9, 0.25), 0.75, Math.max(1, botTrailStartPct - 0.5)).toFixed(2)
  );

  // ── 3) Sector cap ────────────────────────────────────────────────────────
  // The more distinct sectors are showing setups, the tighter we cap any one
  // sector to force the bot to spread the wallet. Few sectors → looser cap.
  const botMaxSectorExposurePct = Number(
    clamp(roundTo(2 / Math.max(2, distinctSectors), 0.05), 0.25, 0.6).toFixed(2)
  );

  // ── 4) Entry window ──────────────────────────────────────────────────────
  // On volatile tape (high ATR% or wild breadth) avoid the opening auction
  // and the closing ramp; otherwise permit entries all session.
  const volatile = medianAtrPct >= 3.5 || Math.abs(scannerBreadth) >= 55;
  const botEntryWindowStart = volatile ? "09:30" : null;
  const botEntryWindowEnd = volatile ? "15:00" : null;

  return {
    maxDeployedCapital,
    botTrailStartPct,
    botTrailDistancePct,
    botMaxSectorExposurePct,
    botEntryWindowStart,
    botEntryWindowEnd,
    basis: {
      walletBalance: Number(walletBalance.toFixed(2)),
      candidatesAnalyzed: sample.length,
      medianAtrPct,
      avgCompositeScore,
      distinctSectors,
      scannerBreadth,
      deployFraction: Number(deployFraction.toFixed(2))
    },
    rationale: {
      maxDeployedCapital: `${Math.round(deployFraction * 100)}% of your ₹${Math.round(
        walletBalance
      ).toLocaleString("en-IN")} wallet — tuned to ${
        scannerBreadth >= 25 ? "broad bullish" : scannerBreadth <= -25 ? "defensive" : "neutral"
      } tape and ${avgCompositeScore}/100 avg candidate quality.`,
      trailing: `Tuned to ~${medianAtrPct}% median candidate ATR: arm at +${botTrailStartPct}%, trail ${botTrailDistancePct}% behind the peak.`,
      sectorCap: `${distinctSectors} sector${distinctSectors === 1 ? "" : "s"} showing setups → cap any one sector at ${Math.round(
        botMaxSectorExposurePct * 100
      )}% of deployed capital.`,
      entryWindow: volatile
        ? `Volatile tape (ATR ~${medianAtrPct}%) — skip the open & close, enter ${botEntryWindowStart}–${botEntryWindowEnd} IST.`
        : "Calm tape — entries allowed across the whole NSE session."
    }
  };
}
