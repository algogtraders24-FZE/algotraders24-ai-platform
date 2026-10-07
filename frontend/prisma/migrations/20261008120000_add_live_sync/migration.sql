-- AT24 Live Sync P1 (additive only: five new tables, nothing existing is changed).
-- NOT APPLIED to production without explicit owner go-ahead.

-- CreateTable
CREATE TABLE "live_sync_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "live_sync_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sync_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "marginMode" TEXT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "serverUtcOffsetSec" INTEGER NOT NULL,
    "terminalBuild" INTEGER NOT NULL,
    "firstSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chainSeq" INTEGER NOT NULL DEFAULT 0,
    "chainHead" TEXT NOT NULL,
    "lastSnapshotAt" TIMESTAMP(3),
    "lastBalance" DOUBLE PRECISION,
    "lastEquity" DOUBLE PRECISION,
    "lastDealTimeMsc" BIGINT,

    CONSTRAINT "live_sync_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sync_deals" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dealTicket" BIGINT NOT NULL,
    "positionId" BIGINT NOT NULL,
    "timeMsc" BIGINT NOT NULL,
    "timeUtc" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "swap" DOUBLE PRECISION NOT NULL,
    "profit" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL,
    "magic" BIGINT NOT NULL,
    "comment" TEXT NOT NULL,
    "batchSeq" INTEGER NOT NULL,

    CONSTRAINT "live_sync_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sync_batches" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sync_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "timeUtc" TIMESTAMP(3) NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "freeMargin" DOUBLE PRECISION NOT NULL,
    "positions" JSONB NOT NULL,

    CONSTRAINT "live_sync_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_sync_devices_tokenHash_key" ON "live_sync_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "live_sync_devices_userId_createdAt_idx" ON "live_sync_devices"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "live_sync_accounts_userId_accountKey_key" ON "live_sync_accounts"("userId", "accountKey");

-- CreateIndex
CREATE INDEX "live_sync_accounts_userId_idx" ON "live_sync_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "live_sync_deals_accountId_dealTicket_key" ON "live_sync_deals"("accountId", "dealTicket");

-- CreateIndex
CREATE INDEX "live_sync_deals_accountId_timeUtc_idx" ON "live_sync_deals"("accountId", "timeUtc");

-- CreateIndex
CREATE UNIQUE INDEX "live_sync_batches_accountId_seq_key" ON "live_sync_batches"("accountId", "seq");

-- CreateIndex
CREATE INDEX "live_sync_snapshots_accountId_timeUtc_idx" ON "live_sync_snapshots"("accountId", "timeUtc");
