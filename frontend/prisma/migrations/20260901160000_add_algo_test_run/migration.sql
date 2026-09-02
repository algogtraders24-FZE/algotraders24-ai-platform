CREATE TABLE "AlgoTestRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "initialBalance" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "resultHash" TEXT,
    "metrics" JSONB,
    "trades" JSONB,
    "equityCurve" JSONB,
    "assumptions" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AlgoTestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlgoTestRun_userId_createdAt_idx" ON "AlgoTestRun"("userId", "createdAt");
