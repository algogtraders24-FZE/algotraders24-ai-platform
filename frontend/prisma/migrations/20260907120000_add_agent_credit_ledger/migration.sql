-- Sprint AN - A9: the agent Credit Ledger (AgentCreditLedgerEntry).
--
-- GENERATED via `prisma migrate diff` (offline) and hand-reviewed
-- (docs/architecture/AN1.11-agent-credit-ledger.md).
--
-- STATUS: NOT APPLIED. Applying requires an explicit go-ahead (AN1.2 P1).
-- Never run `prisma migrate dev` against this database (pgvector-reset trap).
--
-- PURELY ADDITIVE: 1 new enum + 1 new table. ZERO changes to any existing
-- table/column/constraint. Not a pricing system; the accounting authority
-- for agent credit consumption. `idempotencyKey` UNIQUE = the double-charge
-- guard for resumed/retried ticks.


-- CreateEnum
CREATE TYPE "AgentCreditEntryKind" AS ENUM ('tool_call', 'model_inference', 'research_search', 'backtest', 'optimization', 'large_context', 'refund', 'adjustment');

-- CreateTable
CREATE TABLE "AgentCreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "toolCallId" TEXT,
    "kind" "AgentCreditEntryKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCreditLedgerEntry_idempotencyKey_key" ON "AgentCreditLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentCreditLedgerEntry_userId_periodStart_idx" ON "AgentCreditLedgerEntry"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "AgentCreditLedgerEntry_runId_idx" ON "AgentCreditLedgerEntry"("runId");

-- CreateIndex
CREATE INDEX "AgentCreditLedgerEntry_userId_createdAt_idx" ON "AgentCreditLedgerEntry"("userId", "createdAt");

