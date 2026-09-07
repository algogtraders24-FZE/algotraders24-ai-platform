-- P4.8-T2.2 - Strategy Persistence
-- New, user-owned Strategy table for AI-COMPILED strategies only.
-- Registry strategies ("golden", "ref-ema-crossover") never get a row
-- here - they remain code-defined, the registry itself stays their
-- source of truth (P4.8-T2.1 audit's own finding).
-- `strategyId` is the P4.8-T1 stable, per-user, content-addressed AI
-- identity - the (userId, strategyId) unique index is what makes this an
-- upsert target: recompiling byte-identical trading logic reuses the
-- SAME row.
-- `artifact` is the engine's own StrategyVersionRecord (Q0.9/ADR-007) -
-- the FULL, executable, re-runnable StrategySpec, frozen - never the
-- presentation-only AlgoTestCompiledStrategyView AlgoTestRun.compiledStrategy
-- already stores.
-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artifact" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_userId_strategyId_key" ON "Strategy"("userId", "strategyId");

-- CreateIndex
CREATE INDEX "Strategy_userId_createdAt_idx" ON "Strategy"("userId", "createdAt");

-- A nullable reference to the persisted Strategy a run was compiled
-- from, wired ONLY for new AI runs going forward. Every existing row -
-- and every registry-strategy row, forever - has this genuinely NULL,
-- never backfilled or guessed (same convention as every prior nullable
-- column added to this table: parameters/strategyHash/lifecycle/
-- compiledStrategy).
-- AlterTable
ALTER TABLE "AlgoTestRun" ADD COLUMN "strategyRefId" TEXT;

-- CreateIndex
CREATE INDEX "AlgoTestRun_strategyRefId_idx" ON "AlgoTestRun"("strategyRefId");

-- Deliberately SET NULL on delete, never CASCADE - run history is
-- historical evidence and must survive a Strategy being edited/deleted
-- later (no such UX exists yet in T2, but the constraint is set now so
-- it can never accidentally become destructive when it does).
-- AddForeignKey
ALTER TABLE "AlgoTestRun" ADD CONSTRAINT "AlgoTestRun_strategyRefId_fkey" FOREIGN KEY ("strategyRefId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
