-- AN1 - AI News Establishment. Hand-written (not `prisma migrate dev`, per
-- this repo's established convention - migrate dev's shadow-DB drift check
-- fails on the pgvector migration and would demand a full reset). Purely
-- additive: three new tables, one new enum, no changes to any existing
-- table.

CREATE TYPE "NewsProcessingStatus" AS ENUM ('pending', 'processed', 'failed');

CREATE TABLE "news_articles" (
    "id"                TEXT NOT NULL,
    "provider"          TEXT NOT NULL,
    "providerArticleId" TEXT,
    "dedupeKey"         TEXT NOT NULL,
    "headline"          TEXT NOT NULL,
    "summary"           TEXT,
    "url"               TEXT,
    "sourceName"        TEXT,
    "publishedAt"       TIMESTAMP(3),
    "fetchedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentimentScore"    DOUBLE PRECISION,
    "sentimentLabel"    TEXT,
    "relevanceByAsset"  JSONB,
    "category"          TEXT,
    "impactLevel"       TEXT,
    "assetTags"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tagProvenance"     JSONB,
    "processingStatus"  "NewsProcessingStatus" NOT NULL DEFAULT 'pending',
    "errorState"        TEXT,
    "rawPayload"        JSONB,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "deletedAt"         TIMESTAMP(3),

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_articles_dedupeKey_key" ON "news_articles"("dedupeKey");
CREATE INDEX "news_articles_provider_idx" ON "news_articles"("provider");
CREATE INDEX "news_articles_publishedAt_idx" ON "news_articles"("publishedAt");
CREATE INDEX "news_articles_processingStatus_idx" ON "news_articles"("processingStatus");
CREATE INDEX "news_articles_deletedAt_idx" ON "news_articles"("deletedAt");

CREATE TABLE "provider_quotas" (
    "provider"   TEXT NOT NULL,
    "date"       TEXT NOT NULL,
    "usedCount"  INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_quotas_pkey" PRIMARY KEY ("provider", "date")
);

CREATE TABLE "provider_call_logs" (
    "id"           TEXT NOT NULL,
    "provider"     TEXT NOT NULL,
    "purpose"      TEXT NOT NULL,
    "calledAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success"      BOOLEAN NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "provider_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_call_logs_provider_idx" ON "provider_call_logs"("provider");
CREATE INDEX "provider_call_logs_calledAt_idx" ON "provider_call_logs"("calledAt");
