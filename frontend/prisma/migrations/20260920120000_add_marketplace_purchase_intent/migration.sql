-- CreateTable
CREATE TABLE "marketplace_purchase_intents" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "marketplaceListingId" TEXT NOT NULL,
    "tradingSystemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nowPaymentsInvoiceId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_purchase_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_purchase_intents_buyerId_idx" ON "marketplace_purchase_intents"("buyerId");

-- CreateIndex
CREATE INDEX "marketplace_purchase_intents_status_idx" ON "marketplace_purchase_intents"("status");
