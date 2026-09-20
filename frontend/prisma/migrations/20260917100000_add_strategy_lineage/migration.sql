-- QP-5 (docs/architecture/QP5_RECONCILIATION_DECISION.md, D1) - Strategy
-- Lineage. A nullable self-relation on the existing Strategy table, not a
-- second version/history table. Every Strategy row remains exactly what
-- it always was - one immutable, hash-identified artifact, never mutated
-- after creation (persistAiStrategy()'s own `update: {}`). This column
-- only ever records "which other already-persisted Strategy artifact
-- preceded this one in the same Quant Chat conversation" - set once, at
-- create time, never edited afterward. Every existing row gets NULL
-- (a root artifact) - never backfilled or guessed, same "nullable column
-- genuinely null for every row that predates the capability" convention
-- this table's own prior migration (20260907090000_add_strategy_persistence)
-- already used for AlgoTestRun.strategyRefId.
-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN "parentStrategyId" TEXT;

-- CreateIndex
CREATE INDEX "Strategy_parentStrategyId_idx" ON "Strategy"("parentStrategyId");

-- Deliberately SET NULL on delete, mirroring this exact table's own
-- existing AlgoTestRun.strategyRefId -> Strategy foreign key convention -
-- a deleted parent must never cascade-delete its children; they simply
-- become root artifacts.
-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_parentStrategyId_fkey" FOREIGN KEY ("parentStrategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
