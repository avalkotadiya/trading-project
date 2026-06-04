/**
 * AI Trade Advisor — the advisory layer on top of the deterministic quant core.
 *
 * The quant engine (`quant-edge.service`) is the actual edge: it backtests a
 * trend-pullback rule and only shortlists candidates that clear an expected-value
 * gate. This advisor takes that shortlist and runs ONE AI call per cycle to give
 * each candidate a conviction score, a TRADE/SKIP verdict and a one-line reason.
 *
 * It is strictly advisory: numbers (sizing, stops) stay deterministic, and if
 * every AI provider is unavailable `assessCandidates` returns null so the bot
 * falls back to the pure quant decision. The AI never *creates* a trade — it can
 * only filter and rank the trades the quant model already approved.
 */

import { generateJSON } from "@/lib/ai";
import { logger } from "@/lib/logger";
import type { EdgeSignal } from "@/services/ai/quant-edge.service";

export type TradeVerdict = "TRADE" | "SKIP";

export type TradeAssessment = {
  symbol: string;
  conviction: number; // 0-100
  verdict: TradeVerdict;
  reason: string;
};

export type AdvisoryResult = {
  /** Keyed by UPPER-CASE symbol. */
  assessments: Map<string, TradeAssessment>;
  provider: string;
};

const ADVISOR_SYSTEM =
  "You are the risk desk of a systematic Indian-equity trading operation. A " +
  "deterministic, backtested quant model has ALREADY shortlisted these long " +
  "candidates — each one cleared an expected-value gate. Your job is the final " +
  "quality review: confirm the genuinely strong setups and SKIP only those with " +
  "a clear red flag (fading momentum, no volume confirmation, over-stretched z). " +
  "The model is the edge; you are the filter — favour trading good setups over " +
  "blocking them. Never invent numbers. Be decisive, not vague.";

const ADVISOR_CACHE_MS = Math.max(
  5_000,
  Number(process.env.BOT_ADVISOR_CACHE_MS || "45000")
);

type AdvisoryCacheEntry = {
  expiresAt: number;
  result: AdvisoryResult | null;
};

const advisoryCache = new Map<string, AdvisoryCacheEntry>();

function advisoryCacheKey(
  candidates: EdgeSignal[],
  context: { equity: number; openPositions: number; maxPositions: number }
) {
  const rows = candidates.map((c) => [
    c.symbol,
    Number(c.price.toFixed(2)),
    Number(c.edgePct.toFixed(3)),
    Number(c.winProb.toFixed(1)),
    Number(c.payoff.toFixed(2)),
    Number(c.kelly.toFixed(4)),
    Number(c.zScore.toFixed(2)),
    Number(c.momentum.toFixed(2)),
    Number(c.rvol.toFixed(2)),
    c.sampleSize,
    c.trendUp ? 1 : 0
  ]);
  return JSON.stringify([
    Math.round(context.equity),
    context.openPositions,
    context.maxPositions,
    rows
  ]);
}

/**
 * Reviews the quant shortlist in a single AI call.
 * Returns null when there is nothing to assess or no AI provider is reachable.
 */
export async function assessCandidates(
  candidates: EdgeSignal[],
  context: { equity: number; openPositions: number; maxPositions: number },
  options: { signal?: AbortSignal } = {}
): Promise<AdvisoryResult | null> {
  if (candidates.length === 0) return null;
  if (options.signal?.aborted) return null;

  const cacheKey = advisoryCacheKey(candidates, context);
  const cached = advisoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const rows = candidates.map((c) => ({
      symbol: c.symbol,
      price: c.price,
      edgePct: c.edgePct,
      winProb: c.winProb,
      payoff: c.payoff,
      kelly: c.kelly,
      zScore: c.zScore,
      momentum20d: c.momentum,
      rvol: c.rvol,
      sampleSize: c.sampleSize,
      trendUp: c.trendUp
    }));

    const prompt =
      `Account equity ₹${Math.round(context.equity)}; ` +
      `${context.openPositions}/${context.maxPositions} positions already open.\n` +
      `Quant-shortlisted candidates with their factors:\n${JSON.stringify(rows)}\n\n` +
      "Assess EVERY candidate. Respond as JSON exactly:\n" +
      '{ "assessments": [ { "symbol": "<symbol>", "conviction": <integer 0-100>, ' +
      '"verdict": "TRADE" | "SKIP", "reason": "<one concise sentence>" } ] }';

    const { data, provider } = await generateJSON<{ assessments?: TradeAssessment[] }>({
      system: ADVISOR_SYSTEM,
      prompt,
      temperature: 0.3,
      maxTokens: 900,
      signal: options.signal
    });

    const list = Array.isArray(data.assessments) ? data.assessments : [];
    const assessments = new Map<string, TradeAssessment>();

    for (const item of list) {
      if (!item || typeof item.symbol !== "string") continue;
      const symbol = item.symbol.toUpperCase();
      const conviction = Math.max(0, Math.min(100, Math.round(Number(item.conviction) || 0)));
      const verdict: TradeVerdict = item.verdict === "SKIP" ? "SKIP" : "TRADE";
      assessments.set(symbol, {
        symbol,
        conviction,
        verdict,
        reason: typeof item.reason === "string" ? item.reason.slice(0, 200) : ""
      });
    }

    if (assessments.size === 0) {
      advisoryCache.set(cacheKey, { expiresAt: Date.now() + ADVISOR_CACHE_MS, result: null });
      return null;
    }
    const result = { assessments, provider };
    advisoryCache.set(cacheKey, { expiresAt: Date.now() + ADVISOR_CACHE_MS, result });
    return result;
  } catch (error) {
    if (options.signal?.aborted) {
      logger.info("[TradeAdvisor] AI advisory aborted by bot stop signal.");
      return null;
    }
    logger.warn(
      `[TradeAdvisor] AI advisory unavailable — quant signal stands: ${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  }
}
