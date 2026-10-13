-- Wallet: who paid and what kind of payment a referral commission came from (additive, nullable).
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "buyerId" TEXT;
ALTER TABLE "referral_commissions" ADD COLUMN IF NOT EXISTS "source" TEXT;
