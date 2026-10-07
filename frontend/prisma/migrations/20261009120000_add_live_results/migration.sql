-- AT24 Live Results (additive only: one new table, nothing existing is changed).
-- NOT APPLIED to production without explicit owner go-ahead.

-- CreateTable
CREATE TABLE "live_results_pages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "unlistedKey" TEXT NOT NULL,
    "magicFilter" BIGINT,
    "showAmounts" BOOLEAN NOT NULL DEFAULT false,
    "positionDelayMin" INTEGER NOT NULL DEFAULT 15,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_results_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_results_pages_slug_key" ON "live_results_pages"("slug");

-- CreateIndex
CREATE INDEX "live_results_pages_userId_idx" ON "live_results_pages"("userId");

-- CreateIndex
CREATE INDEX "live_results_pages_accountId_idx" ON "live_results_pages"("accountId");

-- CreateIndex
CREATE INDEX "live_results_pages_visibility_idx" ON "live_results_pages"("visibility");
