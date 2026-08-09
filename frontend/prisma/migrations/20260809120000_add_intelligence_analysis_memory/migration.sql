-- Sprint D2.5.1 - Persistent Analysis & Outcome Foundation. Hand-written
-- (not `prisma migrate dev`, per this repo's established convention -
-- migrate dev's shadow-DB drift check fails on the pgvector migration and
-- would demand a full reset). Purely additive: two new tables, two new
-- enums, no changes to any existing table.

CREATE TYPE "IntelligenceAnalysisRunEvaluationStatus" AS ENUM ('pending', 'evaluated');
CREATE TYPE "IntelligenceAnalysisOutcomeStatus" AS ENUM ('pending', 'validated', 'invalidated', 'inconclusive');

CREATE TABLE "intelligence_analysis_runs" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "symbol"           TEXT NOT NULL,
    "timeframe"        TEXT NOT NULL,
    "pipelineVersion"  TEXT,
    "analysisResult"   JSONB,
    "regimeAtTime"     JSONB,
    "evaluationStatus" "IntelligenceAnalysisRunEvaluationStatus" NOT NULL DEFAULT 'pending',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"        TIMESTAMP(3),

    CONSTRAINT "intelligence_analysis_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intelligence_analysis_runs_userId_idx" ON "intelligence_analysis_runs"("userId");
CREATE INDEX "intelligence_analysis_runs_symbol_idx" ON "intelligence_analysis_runs"("symbol");
CREATE INDEX "intelligence_analysis_runs_evaluationStatus_idx" ON "intelligence_analysis_runs"("evaluationStatus");
CREATE INDEX "intelligence_analysis_runs_deletedAt_idx" ON "intelligence_analysis_runs"("deletedAt");

CREATE TABLE "intelligence_analysis_outcomes" (
    "id"                 TEXT NOT NULL,
    "analysisRunId"      TEXT NOT NULL,
    "hypothesisId"       TEXT,
    "evaluatedAt"        TIMESTAMP(3),
    "status"             "IntelligenceAnalysisOutcomeStatus" NOT NULL DEFAULT 'pending',
    "actualPriceMovePct" DOUBLE PRECISION,
    "actualRegimeAfter"  JSONB,
    "evaluationBasis"    TEXT NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_analysis_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intelligence_analysis_outcomes_analysisRunId_idx" ON "intelligence_analysis_outcomes"("analysisRunId");
CREATE INDEX "intelligence_analysis_outcomes_status_idx" ON "intelligence_analysis_outcomes"("status");
CREATE INDEX "intelligence_analysis_outcomes_createdAt_idx" ON "intelligence_analysis_outcomes"("createdAt");

ALTER TABLE "intelligence_analysis_outcomes"
  ADD CONSTRAINT "intelligence_analysis_outcomes_analysisRunId_fkey"
  FOREIGN KEY ("analysisRunId") REFERENCES "intelligence_analysis_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
