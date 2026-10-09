-- Seller self-serve Phase 5: buyer reports on a listing (additive, new table only).
CREATE TABLE "listing_reports" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listing_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "listing_reports_listingId_reporterId_key" ON "listing_reports"("listingId", "reporterId");
CREATE INDEX "listing_reports_listingId_status_idx" ON "listing_reports"("listingId", "status");
CREATE INDEX "listing_reports_status_createdAt_idx" ON "listing_reports"("status", "createdAt");
