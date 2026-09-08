-- P4.5 - Strategy & Run Identity Persistence
-- Adds the semantic strategy hash, full lifecycle result, and compiled
-- strategy view that were already computed on every request since
-- P3.8/P4.3 but never persisted (a disclosed P4.3 gap: a reopened run
-- could not show them). All three are nullable: pre-P4.5 rows genuinely
-- predate this field and are never backfilled with a guessed value, same
-- convention as `parameters` (P3.4, migration 20260903090000).
ALTER TABLE "AlgoTestRun" ADD COLUMN "strategyHash" TEXT;
ALTER TABLE "AlgoTestRun" ADD COLUMN "lifecycle" JSONB;
ALTER TABLE "AlgoTestRun" ADD COLUMN "compiledStrategy" JSONB;

-- Supports a future run-history/library/optimization feature grouping or
-- comparing a user's own runs by exact strategy identity, without a new
-- table or abstraction.
CREATE INDEX "AlgoTestRun_userId_strategyHash_idx" ON "AlgoTestRun"("userId", "strategyHash");
