-- Admin Wallet: one row per verified subscription payment (any plan, any cycle), so the admin can report on Pro/plan money in. Additive only.
-- The webhook writes here best-effort and the Wallet page tolerates the table being absent, so applying this after the code deploy is safe.
CREATE TABLE IF NOT EXISTS "subscription_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cycle" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payments_providerRef_key" ON "subscription_payments"("providerRef");
CREATE INDEX IF NOT EXISTS "subscription_payments_paidAt_idx" ON "subscription_payments"("paidAt");
CREATE INDEX IF NOT EXISTS "subscription_payments_userId_idx" ON "subscription_payments"("userId");
