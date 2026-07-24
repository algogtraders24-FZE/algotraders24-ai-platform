// lib/ai/index.ts
export * from "./types";
export * from "./provider.interface";
export * from "./ports";
export * from "./errors";
export * from "./embedding.types";
export * from "./embedding.interface";
export { AIService } from "./ai.service";
export { PlaceholderProvider } from "./providers/placeholder.provider";
export { GeminiProvider } from "./providers/gemini.provider";
export { GeminiEmbeddingProvider } from "./providers/gemini-embedding.provider";
export { loadGeminiEnv, loadGeminiEmbeddingEnv } from "./env";
export { createAIService } from "./container";
