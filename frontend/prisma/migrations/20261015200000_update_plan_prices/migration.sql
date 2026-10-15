-- Owner decision 2026-10-15: monthly prices Pro $20, Elite $50, Enterprise $200. Yearly keeps the 20% yearly discount (YEARLY_DISCOUNT_PCT):
-- 12 x monthly x 0.8 = $192 / $480 / $1,920. These two columns are what checkout actually charges (Stripe + NOWPayments read the Plan row).
-- Data only, idempotent (safe to run twice). Run AFTER the matching code is deployed so the marketing pages and the DB agree.
UPDATE "Plan" SET "priceMonthly" = 20,  "priceYearly" = 192,  "updatedAt" = NOW() WHERE "id" = 'pro';
UPDATE "Plan" SET "priceMonthly" = 50,  "priceYearly" = 480,  "updatedAt" = NOW() WHERE "id" = 'elite';
UPDATE "Plan" SET "priceMonthly" = 200, "priceYearly" = 1920, "updatedAt" = NOW() WHERE "id" = 'enterprise';
