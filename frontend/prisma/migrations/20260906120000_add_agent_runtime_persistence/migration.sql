-- Sprint AN (Agent Framework Foundation) - A3: Agent Run persistence.
--
-- GENERATED via `prisma migrate diff --from-schema <baseline> --to-schema` and
-- hand-reviewed (see docs/architecture/AN1.5-agent-run-persistence.md).
--
-- STATUS: NOT APPLIED. Applying this migration requires an explicit go-ahead
-- (AN1.2 P1). Never run `prisma migrate dev` against this database (pgvector-
-- reset trap). Apply with `prisma migrate deploy` or reviewed manual SQL only.
--
-- Purely additive: 6 new enums + 4 new tables (AgentRun, AgentStep,
-- AgentToolCall, AgentEvidence). ZERO changes to any existing table, column,
-- constraint or index. The legacy Agent / AgentTask / AgentMemory /
-- AgentActivity models are untouched.


-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'planning', 'running', 'awaiting_approval', 'succeeded', 'failed', 'timeout', 'credit_limit', 'step_limit', 'tool_call_limit', 'permission_denied', 'tool_error', 'model_error', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentRunTrigger" AS ENUM ('manual', 'schedule', 'event', 'supervisor');

-- CreateEnum
CREATE TYPE "AgentStepKind" AS ENUM ('plan', 'tool_call', 'evidence', 'memory_read', 'memory_write', 'evaluation', 'model_call', 'output');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('ok', 'error', 'skipped');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('ok', 'invalid_input', 'tool_error', 'tool_timeout', 'permission_denied');

-- CreateEnum
CREATE TYPE "AgentEvidenceType" AS ENUM ('market_data', 'indicator', 'news', 'regime', 'backtest', 'strategy_result', 'research_document', 'web_result', 'risk_assessment', 'derived');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'queued',
    "trigger" "AgentRunTrigger" NOT NULL DEFAULT 'manual',
    "input" JSONB NOT NULL,
    "plan" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "limits" JSONB NOT NULL,
    "creditsEstimated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditsConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resumeState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "AgentStepKind" NOT NULL,
    "status" "AgentStepStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "creditsConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "AgentToolCallStatus" NOT NULL,
    "permissionChecked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creditCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvidence" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "toolCallId" TEXT,
    "type" "AgentEvidenceType" NOT NULL,
    "claim" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_userId_idx" ON "AgentRun"("userId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_idx" ON "AgentRun"("agentId");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentRun_status_updatedAt_idx" ON "AgentRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentRun_createdAt_idx" ON "AgentRun"("createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_deletedAt_idx" ON "AgentRun"("deletedAt");

-- CreateIndex
CREATE INDEX "AgentStep_runId_idx" ON "AgentStep"("runId");

-- CreateIndex
CREATE INDEX "AgentStep_kind_idx" ON "AgentStep"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_index_key" ON "AgentStep"("runId", "index");

-- CreateIndex
CREATE INDEX "AgentToolCall_runId_idx" ON "AgentToolCall"("runId");

-- CreateIndex
CREATE INDEX "AgentToolCall_stepId_idx" ON "AgentToolCall"("stepId");

-- CreateIndex
CREATE INDEX "AgentToolCall_toolId_idx" ON "AgentToolCall"("toolId");

-- CreateIndex
CREATE INDEX "AgentEvidence_runId_idx" ON "AgentEvidence"("runId");

-- CreateIndex
CREATE INDEX "AgentEvidence_stepId_idx" ON "AgentEvidence"("stepId");

-- CreateIndex
CREATE INDEX "AgentEvidence_toolCallId_idx" ON "AgentEvidence"("toolCallId");

-- CreateIndex
CREATE INDEX "AgentEvidence_type_idx" ON "AgentEvidence"("type");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "AgentToolCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

