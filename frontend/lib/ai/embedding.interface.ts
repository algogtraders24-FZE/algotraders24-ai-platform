// lib/ai/embedding.interface.ts
// Sprint 15B.5 - EmbeddingProvider contract. Abstraction only: no concrete
// provider, no external calls. Mirrors provider.interface.ts (OCP/LSP:
// Gemini/OpenAI/local implementations are substitutable behind this).
import type {
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingProviderName,
} from "./embedding.types";
import { EMBEDDING_DIMENSIONS } from "./embedding.types";
import { AIProviderError } from "./errors";

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

// ---- contract validation helpers ----
// Shared by every implementation so the contract is enforced identically
// (LSP): input must be non-empty text, output must be a numeric vector of
// exactly EMBEDDING_DIMENSIONS values.

export function assertValidEmbeddingInput(
  text: unknown,
  provider: string,
): string {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AIProviderError(
      "invalid_input",
      "Embedding input must be a non-empty string",
      provider,
    );
  }
  return text;
}

export function assertValidEmbeddingOutput(
  embedding: unknown,
  provider: string,
): number[] {
  if (!Array.isArray(embedding)) {
    throw new AIProviderError(
      "invalid_output",
      "Provider returned a non-array embedding",
      provider,
    );
  }
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new AIProviderError(
      "invalid_dimensions",
      `Embedding must have exactly ${EMBEDDING_DIMENSIONS} dimensions (got ${embedding.length})`,
      provider,
    );
  }
  for (const v of embedding) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new AIProviderError(
        "invalid_output",
        "Embedding must contain only finite numbers",
        provider,
      );
    }
  }
  return embedding as number[];
}
