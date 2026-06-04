import { NextResponse } from "next/server";
import { getAuthenticatedUser, UnauthorizedError } from "@/lib/auth";
import { fail } from "@/lib/api-response";
import { getQuantEngineUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { generateJSON } from "@/lib/ai";

/**
 * Options analysis is served by a three-layer chain:
 *   1. Python quant engine        (purpose-built, preferred)
 *   2. multi-provider AI gateway  (Gemini → OpenAI → Anthropic failover)
 *   3. deterministic local read   (always available)
 * Each layer is tried in turn so a response always flows back to the client.
 */

function localOptionsInsight(body: Record<string, unknown>) {
  const pcr = Number(body.put_call_ratio ?? 1);
  const spot = Number(body.spot_price ?? 0);
  const maxPain = Number(body.max_pain_strike ?? 0);
  const callWall = Number(body.highest_call_oi ?? 0);
  const putWall = Number(body.highest_put_oi ?? 0);
  const bias = pcr > 1.1 ? "bullish" : pcr < 0.85 ? "bearish" : "neutral";
  const range = putWall && callWall ? `${putWall} - ${callWall}` : "the current high OI range";

  return {
    provider: "deterministic-options-read",
    insight: `**${bias.toUpperCase()} options read.** PCR is ${pcr.toFixed(2)}, spot is near ${spot || "current market"}, and max pain is ${maxPain || "not available"}. Watch ${range}; a clean break outside this zone can confirm direction. Use defined-risk trades only because OI signals can change quickly intraday.`
  };
}

const OPTIONS_SYSTEM =
  "You are an Indian index and stock options analyst. Read option-chain statistics " +
  "and give a concise, defined-risk-focused intraday view. State the directional bias, " +
  "the key support/resistance levels from open interest, and the main risk. Never " +
  "guarantee direction and never recommend undefined-risk trades.";

/** Layer 2 — multi-provider AI gateway. Returns null if every provider is down. */
async function aiOptionsInsight(body: Record<string, unknown>) {
  try {
    const { data, provider } = await generateJSON<{ insight?: string }>({
      system: OPTIONS_SYSTEM,
      prompt:
        `Option-chain data: ${JSON.stringify(body)}.\n` +
        'Return a JSON object: { "insight": "<one strong paragraph: bias, key OI levels, and risk>" }',
      temperature: 0.4,
      maxTokens: 500
    });

    const insight = (data.insight ?? "").toString().trim();
    if (!insight) return null;
    return { provider: `ai:${provider}`, insight };
  } catch (error) {
    logger.warn("[AI options] gateway unavailable — falling back to deterministic read", {
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

  const parsedBody = await req.json().catch(() => ({}));
  const body: Record<string, unknown> =
    parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>)
      : {};

  // Layer 1 — Python quant engine.
  try {
    const res = await fetch(`${getQuantEngineUrl()}/api/options/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      return NextResponse.json(await res.json());
    }
    logger.warn("[AI options] quant engine returned non-OK — trying AI gateway");
  } catch {
    logger.warn("[AI options] quant engine unreachable — trying AI gateway");
  }

  // Layer 2 — multi-provider AI gateway.
  const ai = await aiOptionsInsight(body);
  if (ai) return NextResponse.json(ai);

  // Layer 3 — deterministic.
  return NextResponse.json(localOptionsInsight(body));
}
