-- Seller identity verification result (additive, new table only). No document data is stored.
CREATE TABLE "seller_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sumsub',
    "applicantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectType" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seller_identities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_identities_userId_key" ON "seller_identities"("userId");
CREATE INDEX "seller_identities_status_idx" ON "seller_identities"("status");
