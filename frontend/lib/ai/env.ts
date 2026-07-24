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
