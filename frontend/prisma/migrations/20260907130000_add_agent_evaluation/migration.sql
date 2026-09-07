-- Sprint AN - A10: run Evaluation + Observability (AgentEvaluation).
--
-- GENERATED via `prisma migrate diff` (offline) and hand-reviewed
-- (docs/architecture/AN1.12-agent-evaluation.md).
--
-- STATUS: NOT APPLIED. Requires an explicit go-ahead (AN1.2 P1).
-- Never run `prisma migrate dev` (pgvector-reset trap).
--
-- PURELY ADDITIVE: 1 new table. ZERO changes to any existing table.


-- CreateTable
CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "terminalStatus" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "failureCategory" TEXT NOT NULL,
    "failureAnalysis" TEXT NOT NULL,
    "measurableSignals" JSONB NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvaluation_runId_key" ON "AgentEvaluation"("runId");

-- CreateIndex
CREATE INDEX "AgentEvaluation_userId_createdAt_idx" ON "AgentEvaluation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvaluation_agentId_idx" ON "AgentEvaluation"("agentId");

-- CreateIndex
CREATE INDEX "AgentEvaluation_terminalStatus_idx" ON "AgentEvaluation"("terminalStatus");

