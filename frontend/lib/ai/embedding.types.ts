// lib/ai/embedding.types.ts
// Sprint 15B.5 - Embedding contracts. Provider-neutral (Gemini/OpenAI/local).
// Mirrors the AI completion contracts in types.ts (ISP: narrow, role-specific).

// pgvector schema is locked to 768 dimensions (Sprint 15B.3 migration).
export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingProviderName =
  | "gemini"
  | "openai"
  | "local"
  | "placeholder";

export interface EmbeddingRequest {
  text: string;
  model?: string;
}

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  provider: string;
  // Optional metadata, mirroring AICompletionResponse (usage/latency).
  usage?: { promptTokens: number };
  latencyMs?: number;
}
