import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { generateJSON } from "@/lib/ai";

const holdingSchema = z.object({
  symbol: z.string().min(1),
  quantity: z.number(),
  averagePrice: z.number(),
  lastPrice: z.number().nullable(),
  marketValue: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlPercent: z.number()
});

const analyticsSchema = z.object({
  totalInvested: z.number(),
  totalMarketValue: z.number(),
  unrealizedPnl: z.number(),
  unrealizedPnlPercent: z.number(),
  holdingsCount: z.number(),
  winners: z.number(),
  losers: z.number()
});

const requestSchema = z.object({
  holdings: z.array(holdingSchema),
  analytics: analyticsSchema,
  question: z.string().trim().max(220).optional()
});

type Holding = z.infer<typeof holdingSchema>;
type Analytics = z.infer<typeof analyticsSchema>;

type CoachAlertLevel = "low" | "medium" | "high";

type CoachAlert = {
  title: string;
  message: string;
  level: CoachAlertLevel;
};

function buildAlerts(holdings: Holding[], analytics: Analytics): CoachAlert[] {
  const alerts: CoachAlert[] = [];
  const topHolding = [...holdings].sort((a, b) => b.marketValue - a.marketValue)[0];
  const topWeight = topHolding && analytics.totalMarketValue > 0
    ? (topHolding.marketValue / analytics.totalMarketValue) * 100
    : 0;

  if (topHolding && topWeight >= 40) {
    alerts.push({
      title: "High single-stock concentration",
      message: `${topHolding.symbol} is ${topWeight.toFixed(1)}% of your portfolio. A bad day in one stock can hit your total balance hard.`,
      level: "high"
    });
  }

  if (analytics.unrealizedPnlPercent <= -8) {
    alerts.push({
      title: "Portfolio is in a drawdown",
      message: `You are down ${Math.abs(analytics.unrealizedPnlPercent).toFixed(2)}%. Consider reducing position size until stability improves.`,
      level: "high"
    });
  } else if (analytics.unrealizedPnlPercent >= 12) {
    alerts.push({
      title: "Strong profit phase",
      message: `You are up ${analytics.unrealizedPnlPercent.toFixed(2)}%. Consider booking partial profits and trailing stops.`,
      level: "medium"
    });
  }

  if (analytics.holdingsCount > 0) {
    const loserRatio = analytics.losers / analytics.holdingsCount;
    if (loserRatio >= 0.7) {
      alerts.push({
        title: "Too many positions are losing",
        message: `${analytics.losers}/${analytics.holdingsCount} holdings are in red. Focus on risk control before adding new trades.`,
        level: "high"
      });
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      title: "Portfolio risk looks balanced",
      message: "No urgent risk flags detected right now. Keep position sizes disciplined and review weekly.",
      level: "low"
    });
  }

  return alerts;
}

function buildActions(holdings: Holding[], analytics: Analytics): string[] {
  const actions: string[] = [];
  const sortedLosers = [...holdings]
    .filter((item) => item.unrealizedPnlPercent < 0)
    .sort((a, b) => a.unrealizedPnlPercent - b.unrealizedPnlPercent);

  if (sortedLosers.length > 0) {
    const worst = sortedLosers[0];
    actions.push(`Review ${worst.symbol}: it is your weakest holding at ${worst.unrealizedPnlPercent.toFixed(2)}%. Decide hold/trim/exit today.`);
  }

  if (analytics.unrealizedPnlPercent >= 8) {
    actions.push("Book 10-20% profits in top winners to protect gains.");
  }

  if (analytics.unrealizedPnlPercent <= -5) {
    actions.push("Pause fresh entries for one session and reassess setup quality.");
  }

  if (analytics.holdingsCount > 12) {
    actions.push("Too many positions can dilute attention. Consider reducing to your best 8-12 ideas.");
  }

  if (actions.length < 3) {
    actions.push("Set stop-loss rules per stock and avoid risking more than 1-2% of capital per trade.");
  }

  return actions.slice(0, 4);
}

const COACH_SYSTEM =
  "You are a disciplined Indian-equity portfolio risk coach for retail traders. " +
  "Give concise, practical, risk-first guidance. Never invent prices, never promise " +
  "returns, and never present advice as a guarantee. Keep the language plain and calm.";

/**
 * AI narrative layer. Runs through the multi-provider gateway (Gemini → OpenAI →
 * Anthropic). Returns null on any AI outage so the caller falls back cleanly to
 * the deterministic guidance below.
 */
async function aiCoachNarrative(
  holdings: Holding[],
  analytics: Analytics,
  question: string | undefined
): Promise<{ insight: string; answer: string | null; provider: string } | null> {
  try {
    const brief = holdings
      .slice(0, 25)
      .map(
        (h) =>
          `${h.symbol}: qty ${h.quantity}, value ${Math.round(h.marketValue)}, P&L ${h.unrealizedPnlPercent.toFixed(1)}%`
      )
      .join("; ");

    const prompt = [
      `Portfolio analytics: ${JSON.stringify(analytics)}.`,
      `Holdings: ${brief || "none"}.`,
      question ? `The user asks: "${question}".` : "The user did not ask a specific question.",
      "Return a JSON object with exactly these keys:",
      question
        ? '{ "insight": "<2-3 sentence risk-first read of this portfolio>", "answer": "<direct, practical answer to the question, max 4 sentences>" }'
        : '{ "insight": "<2-3 sentence risk-first read of this portfolio>", "answer": null }'
    ].join("\n");

    const { data, provider } = await generateJSON<{ insight?: string; answer?: string | null }>({
      system: COACH_SYSTEM,
      prompt,
      temperature: 0.4,
      maxTokens: 600
    });

    const insight = (data.insight ?? "").toString().trim();
    if (!insight) return null;

    const answer = question ? (data.answer ?? "").toString().trim() || null : null;
    return { insight, answer, provider: `ai:${provider}` };
  } catch (error) {
    logger.warn("[AI coach] gateway unavailable — using deterministic guidance", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "ai-portfolio-coach", { limit: 30 });
  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many AI coach requests.", 429);
  }

  try {
    await getAuthenticatedUser();
    const payload = await request.json();
    const parsed = requestSchema.safeParse(payload);

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Portfolio coach payload is invalid.", 422, parsed.error.flatten());
    }

    const { holdings, analytics, question } = parsed.data;
    const alerts = buildAlerts(holdings, analytics);
    const actions = buildActions(holdings, analytics);

    const summary = analytics.unrealizedPnl >= 0
      ? `You are currently in profit by ${analytics.unrealizedPnlPercent.toFixed(2)}% across ${analytics.holdingsCount} holdings.`
      : `You are currently in loss by ${Math.abs(analytics.unrealizedPnlPercent).toFixed(2)}% across ${analytics.holdingsCount} holdings.`;

    // AI narrative layer with a deterministic fallback if every provider is down.
    const ai = await aiCoachNarrative(holdings, analytics, question);

    const fallbackAnswer = question
      ? "Focus first on risk: keep losses small, avoid oversized bets, and rebalance if one stock dominates your portfolio."
      : null;

    return ok({
      summary,
      insight: ai?.insight ?? null,
      alerts,
      actions,
      answer: ai?.answer ?? fallbackAnswer,
      provider: ai?.provider ?? "deterministic",
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return fail("UNAUTHORIZED", error.message, 401);
    }
    return fail("PORTFOLIO_COACH_FAILED", "Unable to generate AI coach guidance.", 500);
  }
}
