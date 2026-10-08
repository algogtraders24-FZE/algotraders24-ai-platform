-- Seller self-serve Phase 2: report check jobs (additive, new table only).
CREATE TABLE "report_check_jobs" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "reason" TEXT,
    "result" JSONB,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_check_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_check_jobs_status_createdAt_idx" ON "report_check_jobs"("status", "createdAt");
CREATE INDEX "report_check_jobs_listingId_createdAt_idx" ON "report_check_jobs"("listingId", "createdAt");
