// services/knowledge/IngestionService.ts
// Sprint 15B.7 - Orchestrates the ingestion pipeline:
//   validate -> soft-delete old chunks (idempotency) -> chunk -> persist
//   records -> embed each (sequential) -> store vector.
// Embedding provider is injected (DI) so it can be swapped/tested.
// Embeddings run OUTSIDE any DB transaction (external API, potentially slow).
import { chunkText, type ChunkOptions } from "./TextChunker";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import type { EmbeddingProvider } from "@/lib/ai";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import { RepositoryError } from "@/types/repository";

export interface IngestParams {
  knowledgeId: string;
  userId: string;
  text: string;
  chunkOptions?: ChunkOptions;
}

export interface IngestResult {
  knowledgeId: string;
  chunksCreated: number;
  embeddingsStored: number;
  embeddingsFailed: number;
}

export class IngestionService {
  // Default provider is the real Gemini one; injectable for tests/other providers.
  constructor(
    private readonly embedder: EmbeddingProvider = new GeminiEmbeddingProvider(),
  ) {}

  private assertNonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "KnowledgeChunk",
        operation: "ingest",
        message: `${field} must be a non-empty string`,
      });
    }
    return value;
  }

  async ingest(params: IngestParams): Promise<IngestResult> {
    const knowledgeId = this.assertNonEmpty(params.knowledgeId, "knowledgeId");
    const userId = this.assertNonEmpty(params.userId, "userId");
    const text = this.assertNonEmpty(params.text, "text");

    const chunkRepo = RepositoryFactory.knowledgeChunks();

    // Idempotency: re-ingesting a document replaces its chunks entirely.
    await chunkRepo.softDeleteByKnowledge(knowledgeId);

    // Deterministic chunking.
    const chunks = chunkText(text, params.chunkOptions);
    if (chunks.length === 0) {
      return { knowledgeId, chunksCreated: 0, embeddingsStored: 0, embeddingsFailed: 0 };
    }

    // Persist structured chunk records atomically.
    const created = await chunkRepo.createMany(
      chunks.map((c) => ({
        knowledgeId,
        userId,
        content: c.content,
        chunkIndex: c.chunkIndex,
        tokenCount: c.tokenCount,
        charCount: c.charCount,
      })),
    );

    const { stored, failed } = await this.embedAndStore(created);
    return { knowledgeId, chunksCreated: created.length, embeddingsStored: stored, embeddingsFailed: failed };
  }

  /**
   * Sprint L2.2 - re-embeds a document's EXISTING chunks, without
   * re-parsing or re-chunking the source text. Useful when embedding
   * failed partially/fully on the original ingest (e.g. the provider was
   * unavailable) - the real chunk content is already stored and correct;
   * only the vectors need regenerating. Reuses the same embed-and-store
   * loop as ingest() via embedAndStore(), so there is exactly one place
   * that talks to the embedding provider and the vector store.
   */
  async reembed(knowledgeId: string): Promise<IngestResult> {
    const id = this.assertNonEmpty(knowledgeId, "knowledgeId");
    const chunkRepo = RepositoryFactory.knowledgeChunks();
    const chunks = await chunkRepo.findByKnowledge(id);

    if (chunks.length === 0) {
      return { knowledgeId: id, chunksCreated: 0, embeddingsStored: 0, embeddingsFailed: 0 };
    }

    const { stored, failed } = await this.embedAndStore(chunks);
    return { knowledgeId: id, chunksCreated: chunks.length, embeddingsStored: stored, embeddingsFailed: failed };
  }

  // Embed + store vectors sequentially (outside any transaction). A failure
  // on one chunk leaves that chunk without an embedding; search skips it
  // (embedding IS NOT NULL). Re-running ingest/reembed fixes partial state.
  private async embedAndStore(chunks: { id: string; content: string }[]): Promise<{ stored: number; failed: number }> {
    const vectorRepo = RepositoryFactory.vectors();
    let stored = 0;
    let failed = 0;
    for (const chunk of chunks) {
      try {
        const result = await this.embedder.embed({ text: chunk.content });
        await vectorRepo.storeEmbedding(chunk.id, result.embedding);
        stored += 1;
      } catch {
        failed += 1;
      }
    }
    return { stored, failed };
  }
}

