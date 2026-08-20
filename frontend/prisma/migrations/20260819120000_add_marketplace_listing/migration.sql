-- Sprint M8 - AT24 Marketplace. Hand-written (not `prisma migrate dev`,
-- per this repo's established convention - see the pgvector shadow-DB
-- drift-check note on 20260813090000_add_outcome_idempotency_guard).
-- Purely additive: one new table, zero changes to any existing table,
-- column, or constraint. Product and every other existing model are
-- completely untouched.
--
-- IMPORTANT: this migration file has been generated but is NOT applied to
-- the live database as of the end of Sprint M8, per explicit instruction.
-- Do not run `prisma migrate deploy` (or otherwise apply this file)
-- without a separate, explicit go-ahead - see
-- ea-research/marketplace-research/m8-marketplace-platform/ for the full
-- reasoning (M8_database_architecture_audit.md, M8_entity_relationship.md).

CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "media" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL DEFAULT '',
    "platformTag" TEXT NOT NULL DEFAULT '',
    "assetTag" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tradingSystemId" TEXT,
    "versionId" TEXT,
    "evidenceId" TEXT,
    "evidenceHash" TEXT,
    "validationId" TEXT,
    "validationHash" TEXT,
    "riskAnalysisId" TEXT,
    "riskAnalysisHash" TEXT,
    "trustState" TEXT,
    "trustReasonCode" TEXT,
    "trustExplanation" TEXT NOT NULL DEFAULT '',
    "trustStatusId" TEXT,
    "lastEvidenceAt" TIMESTAMP(3),
    "publicationState" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketplace_listings_slug_key" ON "marketplace_listings"("slug");
CREATE INDEX "marketplace_listings_sellerId_idx" ON "marketplace_listings"("sellerId");
CREATE INDEX "marketplace_listings_publicationState_idx" ON "marketplace_listings"("publicationState");
CREATE INDEX "marketplace_listings_trustState_idx" ON "marketplace_listings"("trustState");
CREATE INDEX "marketplace_listings_platformTag_idx" ON "marketplace_listings"("platformTag");
CREATE INDEX "marketplace_listings_assetTag_idx" ON "marketplace_listings"("assetTag");
CREATE INDEX "marketplace_listings_category_idx" ON "marketplace_listings"("category");
CREATE INDEX "marketplace_listings_deletedAt_idx" ON "marketplace_listings"("deletedAt");
CREATE INDEX "marketplace_listings_lastEvidenceAt_idx" ON "marketplace_listings"("lastEvidenceAt");
