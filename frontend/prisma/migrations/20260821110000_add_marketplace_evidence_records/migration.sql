-- Sprint M12 branding follow-on. Hand-written (not `prisma migrate dev`,
-- per this repo's established convention - the pgvector shadow-DB
-- drift-check trap). Purely additive: one new table, zero changes to any
-- existing table, column, or constraint.
--
-- Replaces the flat-file convention (data/marketplace-evidence/*.json)
-- for Evidence/Validation/Risk/Trust storage - see the model's own
-- comment in schema.prisma for why this is one row per
-- tradingSystemId+versionId rather than the fully-normalized M1 schema
-- draft's multi-table design.

CREATE TABLE "marketplace_evidence_records" (
    "id" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "validationId" TEXT NOT NULL,
    "validationHash" TEXT NOT NULL,
    "riskAnalysisId" TEXT NOT NULL,
    "riskAnalysisHash" TEXT NOT NULL,
    "trustState" TEXT NOT NULL,
    "trustReasonCode" TEXT NOT NULL,
    "trustExplanation" TEXT NOT NULL DEFAULT '',
    "trustStatusId" TEXT NOT NULL,
    "lastEvidenceAt" TIMESTAMP(3),
    "validationOverallStatus" TEXT NOT NULL,
    "riskStatus" TEXT NOT NULL,
    "evidenceContent" JSONB NOT NULL,
    "validationContent" JSONB NOT NULL,
    "riskContent" JSONB NOT NULL,
    "historyContent" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_evidence_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_evidence_records_tradingSystemId_versionId_key" ON "marketplace_evidence_records"("tradingSystemId", "versionId");

CREATE INDEX "marketplace_evidence_records_tradingSystemId_idx" ON "marketplace_evidence_records"("tradingSystemId");
