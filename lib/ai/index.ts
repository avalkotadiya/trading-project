/**
 * Multi-provider AI gateway — public entry point.
 *
 * Usage:
 *   import { generateText, generateJSON } from "@/lib/ai";
 *
 *   const { text, provider } = await generateText({ prompt: "..." });
 *   const { data } = await generateJSON<{ answer: string }>({ prompt: "..." });
 *
 * The gateway tries each configured provider (Gemini → OpenAI → Anthropic by
 * default) until one succeeds. Callers should still catch AIUnavailableError
 * and fall back to deterministic logic so a total AI outage degrades cleanly.
 */

export { generateText, generateJSON, getAIHealth } from "./gateway";
export { extractJson } from "./json";
export { AIUnavailableError, AIProviderError } from "./types";
export type { AIRequest, AIResponse, AIProviderName, AIProvider } from "./types";
