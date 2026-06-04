import { NextResponse } from "next/server";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { getQuantEngineUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { generateJSON } from "@/lib/ai";

/**
 * Portfolio risk / hedge analysis, served by a three-layer chain:
 *   1. Python quant engine        (preferred)
 *   2. multi-provider AI gateway  (Gemini → OpenAI → Anthropic failover)
 *   3. deterministic local read   (always available)
 *
 * Risk numbers (score, beta, VIX exposure) are ALWAYS computed deterministically
 * — the AI layer only writes the narrative suggestion, never the metrics.
 */

type HoldingInput = {
  symbol?: string;
  quantity?: number;
  averagePrice?: number;
  lastPrice?: number | null;
  marketValue?: number;
  unrealizedPnlPercent?: number;
};

type RiskMetrics = {
  risk_score: number;
  portfolio_beta: number;
  vix_exposure: number;
};

function computeRiskMetrics(holdings: HoldingInput[]): RiskMetrics {
  const valueOf = (item: HoldingInput) =>
    Number(item.marketValue ?? Number(item.quantity ?? 0) * Number(item.lastPrice ?? item.averagePrice ?? 0));

  const totalValue = holdings.reduce((sum, item) => sum + valueOf(item), 0);
  const largest = holdings.reduce((max, item) => Math.max(max, valueOf(item)), 0);
  const losers = holdings.filter((item) => Number(item.unrealizedPnlPercent ?? 0) < 0).length;
  const concentration = totalValue > 0 ? (largest / totalValue) * 100 : 0;
  const loserRatio = holdings.length ? (losers / holdings.length) * 100 : 0;
  const riskScore = Math.min(
    100,
    Math.round(concentration * 0.9 + loserRatio * 0.35 + Math.max(0, holdings.length - 10) * 2)
  );

  return {
    risk_score: riskScore,
    portfolio_beta: Number((0.85 + riskScore / 220).toFixed(2)),
    vix_exposure: Number((riskScore / 18).toFixed(2))
  };
}

function deterministicSuggestion(riskScore: number): string {
  if (riskScore > 70) {
    return "Portfolio risk is elevated. Reduce oversized positions and avoid adding fresh correlated trades until drawdown stabilizes.";
  }
  if (riskScore > 40) {
    return "Portfolio risk is moderate. Keep new trades smaller and prefer positions with clear stop-loss levels.";
  }
  return "Portfolio risk looks controlled. Continue using disciplined position sizing and review concentration weekly.";
}

function localPortfolioAnalysis(holdings: HoldingInput[]) {
  const metrics = computeRiskMetrics(holdings);
  return {
    provider: "deterministic-portfolio-risk",
    ...metrics,
    suggestion: deterministicSuggestion(metrics.risk_score)
  };
}

const HEDGE_SYSTEM =
  "You are a portfolio risk manager for Indian equity traders. Given pre-computed " +
  "risk metrics, write one clear, practical risk-control / hedging suggestion. Be " +
  "specific and calm. Use only the metrics and holdings provided — never invent numbers.";

/** Layer 2 — AI gateway. Metrics are kept deterministic; only the text is AI-written. */
async function aiHedgeSuggestion(holdings: HoldingInput[], metrics: RiskMetrics) {
  try {
    const brief = holdings
      .slice(0, 25)
      .map((h) => `${h.symbol ?? "?"}: P&L ${Number(h.unrealizedPnlPercent ?? 0).toFixed(1)}%`)
      .join("; ");

    const { data, provider } = await generateJSON<{ suggestion?: string }>({
      system: HEDGE_SYSTEM,
      prompt:
        `Pre-computed risk metrics: ${JSON.stringify(metrics)}.\n` +
        `Holdings: ${brief || "none"}.\n` +
        'Return a JSON object: { "suggestion": "<2-3 sentence risk-control / hedging suggestion>" }',
      temperature: 0.4,
      maxTokens: 400
    });

    const suggestion = (data.suggestion ?? "").toString().trim();
    if (!suggestion) return null;
    return { provider: `ai:${provider}`, ...metrics, suggestion };
  } catch (error) {
    logger.warn("[AI hedge] gateway unavailable — using deterministic suggestion", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function POST(req: Request) {
  try {
    await getAuthenticatedUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
    return fail("UNAUTHORIZED", "Authentication required.", 401);
  }

  const parsedBody = await req.json().catch(() => []);
  const holdings: HoldingInput[] = Array.isArray(parsedBody) ? (parsedBody as HoldingInput[]) : [];

  // Layer 1 — Python quant engine.
  try {
    const res = await fetch(`${getQuantEngineUrl()}/api/portfolio/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedBody),
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      return NextResponse.json(await res.json());
    }
    logger.warn("[AI hedge] quant engine returned non-OK — trying AI gateway");
  } catch {
    logger.warn("[AI hedge] quant engine unreachable — trying AI gateway");
  }

  // Layer 2 — multi-provider AI gateway (deterministic metrics + AI narrative).
  const metrics = computeRiskMetrics(holdings);
  const ai = await aiHedgeSuggestion(holdings, metrics);
  if (ai) return NextResponse.json(ai);

  // Layer 3 — deterministic.
  return NextResponse.json(localPortfolioAnalysis(holdings));
}
