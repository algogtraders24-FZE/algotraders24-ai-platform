-- CreateTable
CREATE TABLE "WalkForwardExperiment" (
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
    "inSampleDays" INTEGER NOT NULL,
    "outOfSampleDays" INTEGER NOT NULL,
    "stepDays" INTEGER NOT NULL,
    "totalFolds" INTEGER NOT NULL,
    "foldsCompleted" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "validationMethod" TEXT NOT NULL DEFAULT 'walk-forward',
    "verdict" TEXT,
    "passedFoldCount" INTEGER NOT NULL DEFAULT 0,
    "conclusiveFoldCount" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "WalkForwardExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardFold" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "foldIndex" INTEGER NOT NULL,
    "inSampleStart" TIMESTAMP(3) NOT NULL,
    "inSampleEnd" TIMESTAMP(3) NOT NULL,
    "outOfSampleStart" TIMESTAMP(3) NOT NULL,
    "outOfSampleEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "winnerCandidateId" TEXT,
    "oosProfitFactor" DOUBLE PRECISION,
    "oosTradeCount" INTEGER,
    "oosOutcome" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WalkForwardFold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardCandidate" (
    "id" TEXT NOT NULL,
    "foldId" TEXT NOT NULL,
    "candidateHash" TEXT NOT NULL,
    "parameterValues" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "tradeCount" INTEGER,
    "profitFactor" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WalkForwardCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalkForwardExperiment_userId_createdAt_idx" ON "WalkForwardExperiment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalkForwardFold_experimentId_status_idx" ON "WalkForwardFold"("experimentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalkForwardFold_experimentId_foldIndex_key" ON "WalkForwardFold"("experimentId", "foldIndex");

-- CreateIndex
CREATE INDEX "WalkForwardCandidate_foldId_status_idx" ON "WalkForwardCandidate"("foldId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WalkForwardCandidate_foldId_candidateHash_key" ON "WalkForwardCandidate"("foldId", "candidateHash");

-- AddForeignKey
ALTER TABLE "WalkForwardFold" ADD CONSTRAINT "WalkForwardFold_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "WalkForwardExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardCandidate" ADD CONSTRAINT "WalkForwardCandidate_foldId_fkey" FOREIGN KEY ("foldId") REFERENCES "WalkForwardFold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

