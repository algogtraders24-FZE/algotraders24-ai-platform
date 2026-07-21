CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeChunk_knowledgeId_idx" ON "KnowledgeChunk"("knowledgeId");
CREATE INDEX "KnowledgeChunk_userId_idx" ON "KnowledgeChunk"("userId");
CREATE INDEX "KnowledgeChunk_deletedAt_idx" ON "KnowledgeChunk"("deletedAt");

ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "Knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeChunk" ADD COLUMN "embedding" vector(768);

CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);