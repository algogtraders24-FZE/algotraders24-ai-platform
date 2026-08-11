// lib/ai/env.ts
// Requirement #3: API key + model come ONLY from env. Fail fast, fail loud.
// Centralized so every provider validates the same way (DRY).
export interface GeminiEnv {
  apiKey: string;
  model: string;
}

function requireApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      "[ai] GEMINI_API_KEY is missing. Set it in your environment (.env.local).",
    );
  }
  return apiKey;
}

export function loadGeminiEnv(): GeminiEnv {
  return {
    apiKey: requireApiKey(),
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  };
}

// Sprint 15B.6 - embedding model is separate from the chat model.
// gemini-embedding-001 is the stable/GA embedding model; its native output is
// 3072-d, reduced to 768 via outputDimensionality (MRL) to match the locked
// pgvector schema (Sprint 15B.3).
export function loadGeminiEmbeddingEnv(): GeminiEnv {
  return {
    apiKey: requireApiKey(),
    model: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
  };
}

// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Same "fail fast, fail loud" discipline as loadGeminiEnv() -
// these are only ever called by ClaudeProvider/OpenAIProvider's own
// constructors, which the presenter orchestrator only invokes after its
// own env-var-presence availability check already passed (see
// services/intelligence/chat/ai-presenter-orchestrator.service.ts) - so
// this throwing on a genuinely missing key here is a defensive last
// resort, never the normal "provider unavailable" path.
export interface AnthropicEnv {
  apiKey: string;
  model: string;
}

export function loadAnthropicEnv(): AnthropicEnv {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("[ai] ANTHROPIC_API_KEY is missing. Set it in your environment (.env.local).");
  }
  return { apiKey, model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5" };
}

export interface OpenAIEnv {
  apiKey: string;
  model: string;
}

export function loadOpenAIEnv(): OpenAIEnv {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("[ai] OPENAI_API_KEY is missing. Set it in your environment (.env.local).");
  }
  return { apiKey, model: process.env.OPENAI_MODEL ?? "gpt-4o" };
}
