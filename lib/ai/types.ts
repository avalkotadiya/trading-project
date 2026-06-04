/**
 * Shared types for the multi-provider AI gateway.
 *
 * The gateway stacks several LLM providers into a failover chain so a single
 * provider being down, rate-limited or mis-keyed never breaks an AI feature —
 * the next layer answers instead.
 */

export type AIProviderName = "gemini" | "openai" | "anthropic";

export interface AIRequest {
  /** Optional system / role instruction. */
  system?: string;
  /** The user prompt. */
  prompt: string;
  /** Sampling temperature, 0..1. Defaults to 0.4. */
  temperature?: number;
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Ask the provider to return strict JSON. Set automatically by generateJSON. */
  json?: boolean;
  /** Optional external abort signal from caller runtime. */
  signal?: AbortSignal;
}

export interface AIResponse {
  /** Raw model text output. */
  text: string;
  /** Which provider in the chain produced this response. */
  provider: AIProviderName;
  /** The concrete model id used. */
  model: string;
  /** Wall-clock time the successful call took, in ms. */
  latencyMs: number;
}

export interface AIProvider {
  readonly name: AIProviderName;
  /** True when a usable API key is present for this provider. */
  isConfigured(): boolean;
  /** The model id this provider will call. */
  model(): string;
  /** Run one completion. Resolves with raw text, or throws AIProviderError. */
  complete(req: AIRequest, signal: AbortSignal): Promise<string>;
}

/** A recoverable failure from one provider — the gateway falls through to the next. */
export class AIProviderError extends Error {
  constructor(
    public readonly provider: AIProviderName,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

/** Thrown only when every configured provider has failed (or none are configured). */
export class AIUnavailableError extends Error {
  constructor(message = "All AI providers are unavailable.") {
    super(message);
    this.name = "AIUnavailableError";
  }
}
