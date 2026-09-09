-- Sprint K2 -- AT24 AI Assistant Knowledge Loop: Retrieval Cache.
--
-- GENERATED via `prisma migrate diff` (offline, schema-to-schema, no DB) and
-- hand-reviewed against KNOWLEDGE_RETRIEVAL_CONTRACT.md section 7.2
-- (ADR-K2-RETR-CACHE), 7.5, 7.6.
--
-- STATUS: NOT APPLIED. Application requires an explicit K2 owner go-ahead
-- (K2_ACCEPTANCE.md "K2 Migration Gate" = NOT AUTHORIZED) and is then run via
-- `prisma migrate deploy`. Never run `prisma migrate dev` against this
-- database (pgvector-reset trap -- project_sprint15c_workflow).
--
-- Every statement below is CREATE TABLE or CREATE INDEX. Reviewer-verified
-- absent: destructive DDL, column retyping, row mutation, table truncation,
-- any reference to an existing table, any foreign-key constraint.
--
-- Content: 1 new table (KnowledgeRetrievalCache) + 2 indexes. This is the
-- Postgres-backed retrieval cache (ADR-K2-RETR-CACHE); it is NOT
-- `KnowledgeAnswerCache` (K5) -- see contract section 7.5.

-- CreateTable
CREATE TABLE "KnowledgeRetrievalCache" (
    "key" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "scopeSig" TEXT NOT NULL,
    "knowledgeVersionFingerprint" TEXT NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRetrievalCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalCache_expiresAt_idx" ON "KnowledgeRetrievalCache"("expiresAt");

-- CreateIndex
CREATE INDEX "KnowledgeRetrievalCache_knowledgeVersionFingerprint_idx" ON "KnowledgeRetrievalCache"("knowledgeVersionFingerprint");
