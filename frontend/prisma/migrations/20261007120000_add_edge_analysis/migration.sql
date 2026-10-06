-- Trader Edge Analyzer saved analyses (additive only: one new table).
-- NOT APPLIED to production without explicit owner go-ahead.

-- CreateTable
CREATE TABLE "edge_analyses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edge_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edge_analyses_userId_createdAt_idx" ON "edge_analyses"("userId", "createdAt");
