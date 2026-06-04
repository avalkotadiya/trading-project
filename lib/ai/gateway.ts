/**
 * Multi-provider AI gateway.
 *
 * Stacks the configured LLM providers into an ordered failover chain. A request
 * is handed to the first provider; if it errors, times out, returns an empty
 * body or (for JSON requests) unparseable output, the gateway transparently
 * falls through to the next layer. Callers get a single clean result and never
 * have to know which provider answered — data keeps flowing as long as *any*
 * provider works.
 *
 * A lightweight in-memory circuit breaker parks a provider that just failed
 * for a short cooldown, so a dead/rate-limited provider does not slow every
 * subsequent request.
 */

import { logger } from "@/lib/logger";
import { getBreakerCooldownMs, getProviderOrder, getRequestTimeoutMs } from "./config";
import { extractJson } from "./json";
import { anthropicProvider, geminiProvider, openaiProvider } from "./providers";
import {
  AIProviderError,
  AIUnavailableError,
  type AIProvider,
  type AIProviderName,
  type AIRequest,
  type AIResponse
} from "./types";

const PROVIDERS: Record<AIProviderName, AIProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider
};

// --- circuit breaker --------------------------------------------------------
type BreakerEntry = { until: number; reason: string };
const breaker = new Map<AIProviderName, BreakerEntry>();

function isTripped(name: AIProviderName): boolean {
  const entry = breaker.get(name);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    breaker.delete(name);
    return false;
  }
  return true;
}

function trip(name: AIProviderName, reason: string, status?: number): void {
  // An invalid key (401/403) will not fix itself — park it longer so we stop
  // wasting a round-trip on it. Transient failures get the base cooldown.
  const base = getBreakerCooldownMs();
  const cooldown = status === 401 || status === 403 ? base * 5 : base;
  breaker.set(name, { until: Date.now() + cooldown, reason });
}

// --- core failover loop -----------------------------------------------------
type Parsed<T> = { value: T; provider: AIProviderName; model: string; latencyMs: number };

/**
 * Runs the request through the provider chain. `parse` converts raw model text
 * into the caller's shape and may throw — a throw is treated as a soft failure
 * for that provider and the gateway moves on to the next one.
 */
async function run<T>(req: AIRequest, parse: (text: string) => T): Promise<Parsed<T>> {
  const order = getProviderOrder();
  const timeoutMs = getRequestTimeoutMs();
  const attempted: AIProviderName[] = [];
  const errors: string[] = [];

  for (const name of order) {
    const provider = PROVIDERS[name];

    if (!provider.isConfigured()) {
      continue; // no key — silently skip this layer
    }
    if (isTripped(name)) {
      errors.push(`${name}: in cooldown`);
      continue;
    }

    attempted.push(name);
    const startedAt = Date.now();
    const controller = new AbortController();
    const external = req.signal;
    const onExternalAbort = () => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const text = await provider.complete(req, controller.signal);
      const value = parse(text); // may throw on bad/unparseable output
      const latencyMs = Date.now() - startedAt;
      logger.info("[AI] provider answered", { provider: name, model: provider.model(), latencyMs });
      return { value, provider: name, model: provider.model(), latencyMs };
    } catch (err) {
      const aborted = controller.signal.aborted;
      const status = err instanceof AIProviderError ? err.status : undefined;
      const reason = aborted
        ? `timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);

      // Trip the breaker only for genuine provider/transport failures, not for
      // a parse miss (which is usually a one-off formatting hiccup).
      if (aborted || err instanceof AIProviderError) {
        trip(name, reason, status);
      }
      errors.push(`${name}: ${reason}`);
      logger.warn("[AI] provider failed — falling through to next layer", { provider: name, error: reason });
    } finally {
      clearTimeout(timer);
      if (external) {
        external.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  if (attempted.length === 0) {
    throw new AIUnavailableError(
      "No AI provider is configured. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY in the environment."
    );
  }
  throw new AIUnavailableError(`Every AI provider failed — ${errors.join(" | ")}`);
}

// --- public API -------------------------------------------------------------

/** Generate free-form text, with automatic provider failover. */
export async function generateText(req: AIRequest): Promise<AIResponse> {
  const result = await run(req, (text) => {
    if (!text.trim()) throw new Error("empty output");
    return text.trim();
  });
  return {
    text: result.value,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs
  };
}

/**
 * Generate a JSON object, with automatic provider failover. If a provider
 * returns unparseable JSON the gateway retries the next provider instead of
 * failing — so a single sloppy response never breaks the caller.
 */
export async function generateJSON<T = unknown>(
  req: AIRequest
): Promise<{ data: T; provider: AIProviderName; model: string; latencyMs: number }> {
  const jsonReq: AIRequest = {
    ...req,
    json: true,
    system: [req.system, "Respond with one valid JSON object only — no markdown, no commentary."]
      .filter(Boolean)
      .join("\n\n")
  };

  const result = await run(jsonReq, (text) => {
    const parsed = extractJson<T>(text);
    if (parsed === null) throw new Error("unparseable JSON output");
    return parsed;
  });

  return {
    data: result.value,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs
  };
}

/** Snapshot of provider configuration and circuit-breaker state. */
export function getAIHealth() {
  const order = getProviderOrder();
  return {
    order,
    timeoutMs: getRequestTimeoutMs(),
    providers: (Object.keys(PROVIDERS) as AIProviderName[]).map((name) => {
      const entry = breaker.get(name);
      const cooling = entry !== undefined && Date.now() < entry.until;
      return {
        name,
        configured: PROVIDERS[name].isConfigured(),
        model: PROVIDERS[name].model(),
        inChain: order.includes(name),
        status: cooling ? "cooldown" : "ready",
        cooldownEndsAt: entry && cooling ? new Date(entry.until).toISOString() : null,
        lastError: entry && cooling ? entry.reason : null
      };
    })
  };
}
