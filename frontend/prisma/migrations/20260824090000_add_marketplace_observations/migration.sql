-- Real, persisted observation history for M7's "observed across more than
-- one point in time" trust requirement - hand-written (not `prisma migrate
-- dev`, per this repo's established convention). Purely additive: one new
-- table, zero changes to any existing table, column, or constraint.

CREATE TABLE "marketplace_observations" (
    "id" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "riskAnalysisId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_observations_tradingSystemId_versionId_eviden_key" ON "marketplace_observations"("tradingSystemId", "versionId", "evidenceId", "riskAnalysisId");

CREATE INDEX "marketplace_observations_tradingSystemId_versionId_idx" ON "marketplace_observations"("tradingSystemId", "versionId");
