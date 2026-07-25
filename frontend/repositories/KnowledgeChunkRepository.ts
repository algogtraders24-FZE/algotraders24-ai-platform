// repositories/KnowledgeChunkRepository.ts
// Sprint 15B.7 - Contract for KnowledgeChunk persistence (structured columns).
// The vector "embedding" column is NOT handled here — it lives only in
// VectorRepository (raw SQL). This repo covers the structured chunk record.

export interface ChunkEntity {
  id: string;
  knowledgeId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  charCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface NewChunkInput {
  knowledgeId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  charCount: number;
}

export interface IKnowledgeChunkRepository {
  createMany(chunks: NewChunkInput[]): Promise<ChunkEntity[]>;
  findByKnowledge(knowledgeId: string): Promise<ChunkEntity[]>;
  softDeleteByKnowledge(knowledgeId: string): Promise<number>;
}
