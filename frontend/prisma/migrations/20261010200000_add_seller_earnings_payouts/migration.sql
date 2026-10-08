-- Seller self-serve Phase 4: earnings ledger + payout requests (additive, new tables only).
CREATE TABLE "seller_earnings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "gatewayFee" DOUBLE PRECISION NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seller_earnings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_earnings_purchaseId_key" ON "seller_earnings"("purchaseId");
CREATE INDEX "seller_earnings_sellerId_status_idx" ON "seller_earnings"("sellerId", "status");
CREATE INDEX "seller_earnings_payoutId_idx" ON "seller_earnings"("payoutId");

CREATE TABLE "seller_payouts" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL DEFAULT 'USDT',
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "txRef" TEXT,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seller_payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "seller_payouts_sellerId_createdAt_idx" ON "seller_payouts"("sellerId", "createdAt");
CREATE INDEX "seller_payouts_status_idx" ON "seller_payouts"("status");
