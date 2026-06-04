/**
 * Environment-driven configuration for the AI gateway.
 *
 * Every value is read lazily from process.env so the running process picks up
 * changes on restart without any code edits. Keys that are blank or still hold
 * a placeholder ("replace_me") are treated as "not configured".
 */

import type { AIProviderName } from "./types";

const ALL_PROVIDERS: AIProviderName[] = ["gemini", "openai", "anthropic"];
const DEFAULT_ORDER: AIProviderName[] = ["gemini", "openai", "anthropic"];

/** Trim a key and reject placeholder/empty values. */
function cleanKey(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (/replace[_-]?me/i.test(trimmed)) return "";
  return trimmed;
}

export const AI_CONFIG = {
  gemini: {
    apiKey: () => cleanKey(process.env.GEMINI_API_KEY),
    model: () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash"
  },
  openai: {
    apiKey: () => cleanKey(process.env.OPENAI_API_KEY),
    model: () => process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini"
  },
  anthropic: {
    apiKey: () => cleanKey(process.env.ANTHROPIC_API_KEY),
    model: () => process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001"
  }
} as const;

/**
 * The order the gateway tries providers in. Controlled by AI_PROVIDER_ORDER
 * (comma-separated). Unknown names are dropped; an empty result falls back to
 * the default chain.
 */
export function getProviderOrder(): AIProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER?.trim();
  if (!raw) return DEFAULT_ORDER;

  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AIProviderName => (ALL_PROVIDERS as string[]).includes(s));

  return parsed.length ? parsed : DEFAULT_ORDER;
}

/** Per-provider request timeout in ms (1s..120s). Defaults to 15s. */
export function getRequestTimeoutMs(): number {
  const n = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(n)) return 15_000;
  return Math.min(120_000, Math.max(1_000, n));
}

/** Cooldown applied to a provider after it fails, before it is retried. */
export function getBreakerCooldownMs(): number {
  const n = Number(process.env.AI_BREAKER_COOLDOWN_MS);
  if (!Number.isFinite(n)) return 60_000;
  return Math.min(900_000, Math.max(5_000, n));
}
