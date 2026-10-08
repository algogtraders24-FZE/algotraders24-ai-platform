-- AT24 Live Results: follow/watch + marketplace listing link (additive only).
-- One new nullable column on live_results_pages and one new table. NOT APPLIED without explicit owner go-ahead.

-- AlterTable
ALTER TABLE "live_results_pages" ADD COLUMN "listingSlug" TEXT;

-- CreateTable
CREATE TABLE "live_results_follows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_results_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_results_pages_listingSlug_idx" ON "live_results_pages"("listingSlug");

-- CreateIndex
CREATE UNIQUE INDEX "live_results_follows_userId_pageId_key" ON "live_results_follows"("userId", "pageId");

-- CreateIndex
CREATE INDEX "live_results_follows_userId_idx" ON "live_results_follows"("userId");

-- CreateIndex
CREATE INDEX "live_results_follows_pageId_idx" ON "live_results_follows"("pageId");
