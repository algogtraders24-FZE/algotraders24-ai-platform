-- Paper Trading Engine, Phase P1 - a fully isolated, database-only
-- simulation (no real money, no live-account connectivity). Hand-written
-- (not `prisma migrate dev`), per this repo's established convention.
-- Purely additive: two new tables, zero changes to any existing table,
-- column, or constraint.

CREATE TABLE "PaperTradingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTradingAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaperTradingAccount_userId_key" ON "PaperTradingAccount"("userId");

CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "marginUsed" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "exitPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaperPosition_accountId_status_idx" ON "PaperPosition"("accountId", "status");

ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperTradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
