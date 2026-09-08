-- CreateEnum
CREATE TYPE "PublishingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublishingAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "publishing_jobs" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "PublishingJobStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" JSONB,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "publishing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_attempts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "PublishingAttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" JSONB,
    "externalReference" TEXT,
    "externalUrl" TEXT,
    "destinationResponseMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "publishing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publishing_jobs_userId_idx" ON "publishing_jobs"("userId");

-- CreateIndex
CREATE INDEX "publishing_jobs_status_idx" ON "publishing_jobs"("status");

-- CreateIndex
CREATE INDEX "publishing_jobs_status_scheduledFor_idx" ON "publishing_jobs"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "publishing_jobs_idempotencyKey_idx" ON "publishing_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "publishing_jobs_articleId_idx" ON "publishing_jobs"("articleId");

-- CreateIndex
CREATE INDEX "publishing_jobs_deletedAt_idx" ON "publishing_jobs"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_jobs_articleId_destination_contentHash_key" ON "publishing_jobs"("articleId", "destination", "contentHash");

-- CreateIndex
CREATE INDEX "publishing_attempts_jobId_idx" ON "publishing_attempts"("jobId");

-- CreateIndex
CREATE INDEX "publishing_attempts_status_idx" ON "publishing_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_attempts_jobId_attemptNumber_key" ON "publishing_attempts"("jobId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_attempts" ADD CONSTRAINT "publishing_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "publishing_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
