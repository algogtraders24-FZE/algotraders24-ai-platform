-- AlterTable
ALTER TABLE "AlgoTestRun" ADD COLUMN     "experimentCandidateId" TEXT;

-- CreateTable
CREATE TABLE "OptimizationExperiment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyArtifactHash" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "initialBalance" DOUBLE PRECISION NOT NULL,
    "searchSpace" JSONB NOT NULL,
    "objective" TEXT NOT NULL,
    "minEligibleTrades" INTEGER NOT NULL,
    "candidateCap" INTEGER NOT NULL,
    "totalCandidates" INTEGER NOT NULL,
    "processedCandidates" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "bestCandidateId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OptimizationExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationCandidate" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "parameterValues" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "tradeCount" INTEGER,
    "profitFactor" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "OptimizationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OptimizationExperiment_userId_createdAt_idx" ON "OptimizationExperiment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OptimizationCandidate_experimentId_status_idx" ON "OptimizationCandidate"("experimentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OptimizationCandidate_experimentId_candidateHash_key" ON "OptimizationCandidate"("experimentId", "candidateHash");

-- CreateIndex
CREATE UNIQUE INDEX "AlgoTestRun_experimentCandidateId_key" ON "AlgoTestRun"("experimentCandidateId");

-- AddForeignKey
ALTER TABLE "AlgoTestRun" ADD CONSTRAINT "AlgoTestRun_experimentCandidateId_fkey" FOREIGN KEY ("experimentCandidateId") REFERENCES "OptimizationCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationCandidate" ADD CONSTRAINT "OptimizationCandidate_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

