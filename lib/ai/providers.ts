/**
 * Concrete LLM providers for the gateway.
 *
 * Each provider talks to its vendor REST API directly with `fetch` — no SDK
 * dependency — and normalises the response down to plain text. Any non-2xx
 * response, network error or empty body is surfaced as an AIProviderError so
 * the gateway can fall through to the next layer.
 */

import { AI_CONFIG } from "./config";
import { AIProviderError, type AIProvider, type AIRequest } from "./types";

/** Read at most ~400 chars of an error body for diagnostics. */
async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Gemini — Google Generative Language API
// ---------------------------------------------------------------------------
export const geminiProvider: AIProvider = {
  name: "gemini",
  isConfigured: () => AI_CONFIG.gemini.apiKey() !== "",
  model: () => AI_CONFIG.gemini.model(),

  async complete(req: AIRequest, signal: AbortSignal): Promise<string> {
    const key = AI_CONFIG.gemini.apiKey();
    const model = AI_CONFIG.gemini.model();
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxTokens ?? 1024,
        ...(req.json ? { responseMimeType: "application/json" } : {})
      }
    };
    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      throw new AIProviderError("gemini", `HTTP ${res.status}: ${await safeBody(res)}`, res.status);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p?.text ?? "").join("");

    if (!text.trim()) {
      throw new AIProviderError("gemini", `Empty response (finishReason=${candidate?.finishReason ?? "unknown"})`);
    }
    return text;
  }
};

// ---------------------------------------------------------------------------
// OpenAI — Chat Completions API
// ---------------------------------------------------------------------------
export const openaiProvider: AIProvider = {
  name: "openai",
  isConfigured: () => AI_CONFIG.openai.apiKey() !== "",
  model: () => AI_CONFIG.openai.model(),

  async complete(req: AIRequest, signal: AbortSignal): Promise<string> {
    const key = AI_CONFIG.openai.apiKey();

    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = {
      model: AI_CONFIG.openai.model(),
      messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.json ? { response_format: { type: "json_object" } } : {})
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      throw new AIProviderError("openai", `HTTP ${res.status}: ${await safeBody(res)}`, res.status);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? "";

    if (!text.trim()) {
      throw new AIProviderError("openai", "Empty response");
    }
    return text;
  }
};

// ---------------------------------------------------------------------------
// Anthropic — Messages API
// ---------------------------------------------------------------------------
export const anthropicProvider: AIProvider = {
  name: "anthropic",
  isConfigured: () => AI_CONFIG.anthropic.apiKey() !== "",
  model: () => AI_CONFIG.anthropic.model(),

  async complete(req: AIRequest, signal: AbortSignal): Promise<string> {
    const key = AI_CONFIG.anthropic.apiKey();

    const body: Record<string, unknown> = {
      model: AI_CONFIG.anthropic.model(),
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      messages: [{ role: "user", content: req.prompt }]
    };
    // Anthropic has no JSON mode — instruct via the system prompt instead.
    if (req.system) body.system = req.system;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      throw new AIProviderError("anthropic", `HTTP ${res.status}: ${await safeBody(res)}`, res.status);
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((block) => block?.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    if (!text.trim()) {
      throw new AIProviderError("anthropic", "Empty response");
    }
    return text;
  }
};
