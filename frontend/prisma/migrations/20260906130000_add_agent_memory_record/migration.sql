-- Sprint AN - A7: policy-gated agent memory (AgentMemoryRecord).
--
-- GENERATED via `prisma migrate diff` (offline) and hand-reviewed
-- (docs/architecture/AN1.9-agent-memory.md).
--
-- STATUS: NOT APPLIED. Applying requires an explicit go-ahead (AN1.2 P1).
-- Never run `prisma migrate dev` against this database (pgvector-reset trap).
--
-- PURELY ADDITIVE: 2 new enums + 1 new table. ZERO changes to any existing
-- table/column/constraint. The legacy AgentMemory model is untouched. This
-- table is NOT the AT24 Knowledge/RAG system.


-- CreateEnum
CREATE TYPE "AgentMemoryLayer" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'USER_CONTEXT', 'RESEARCH_MEMORY', 'STRATEGY_MEMORY', 'PERFORMANCE_MEMORY');

-- CreateEnum
CREATE TYPE "AgentMemoryRecordStatus" AS ENUM ('active', 'pending_approval', 'expired');

-- CreateTable
CREATE TABLE "AgentMemoryRecord" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "layer" "AgentMemoryLayer" NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "retention" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,
    "status" "AgentMemoryRecordStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AgentMemoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_userId_idx" ON "AgentMemoryRecord"("userId");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_agentId_idx" ON "AgentMemoryRecord"("agentId");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_userId_agentId_layer_scope_key_idx" ON "AgentMemoryRecord"("userId", "agentId", "layer", "scope", "key");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_userId_layer_scope_idx" ON "AgentMemoryRecord"("userId", "layer", "scope");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_status_idx" ON "AgentMemoryRecord"("status");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_expiresAt_idx" ON "AgentMemoryRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "AgentMemoryRecord_deletedAt_idx" ON "AgentMemoryRecord"("deletedAt");

