-- AlterTable
-- BILLING-03: promote the yearly price from a config-only display number
-- (config/plan-limits.ts) to a real DB column, and rename `price` to
-- `priceMonthly` now that a `priceYearly` sibling exists (see
-- docs/architecture/AT24_BILLING02_PRICING_CONTRACT_DECISION_LOCK.md, S4-S6,
-- S12 for the full rationale and owner-approved numbers).
ALTER TABLE "Plan" RENAME COLUMN "price" TO "priceMonthly";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill the owner-approved yearly prices (BILLING-02 S3). Hardcoded
-- per-row, not computed from a discount formula at migration time - these
-- are business-approved numbers, not a derived value.
UPDATE "Plan" SET "priceYearly" = 0 WHERE "id" = 'free';
UPDATE "Plan" SET "priceYearly" = 279 WHERE "id" = 'pro';
UPDATE "Plan" SET "priceYearly" = 949 WHERE "id" = 'elite';
UPDATE "Plan" SET "priceYearly" = 4790 WHERE "id" = 'enterprise';

-- AlterTable
-- `interval` is a dead column: zero non-schema code references, always
-- "month" in all 4 real rows, never read by any pricing/checkout/
-- entitlement logic (re-verified at BILLING-03 implementation time).
ALTER TABLE "Plan" DROP COLUMN "interval";
