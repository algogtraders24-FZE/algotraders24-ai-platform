// lib/ai/env.ts
// Requirement #3: API key + model come ONLY from env. Fail fast, fail loud.
// Centralized so every provider validates the same way (DRY).
export interface GeminiEnv {
  apiKey: string;
  model: string;
}

export function loadGeminiEnv(): GeminiEnv {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      "[ai] GEMINI_API_KEY is missing. Set it in your environment (.env.local).",
    );
  }
  return { apiKey, model };
}
