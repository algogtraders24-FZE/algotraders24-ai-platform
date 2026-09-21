-- AlterTable
-- BILLING-03-MIGRATION-SPLIT: EXPAND phase of an expand/contract migration
-- (see docs/architecture/AT24_BILLING02_PRICING_CONTRACT_DECISION_LOCK.md
-- for the pricing decisions, and the BILLING-03-MIGRATION-GATE report for
-- why the original single rename/drop migration could not safely precede
-- or follow the new application code in either order).
--
-- This migration is purely additive: it adds `priceMonthly` and
-- `priceYearly` alongside the existing `price`/`interval` columns rather
-- than renaming or dropping anything. That means it can be applied to
-- production at any time - before, during, or after the new billing code
-- deploys - with zero breakage window, because old code (which still reads
-- `price`/`interval`) keeps working unchanged, and new code (which only
-- reads `priceMonthly`/`priceYearly`) already has what it needs the moment
-- this migration finishes.
--
-- `price` and `interval` are left in the database untouched. They are no
-- longer declared in schema.prisma (the application no longer reads them),
-- which is valid in Prisma - an undeclared column is simply ignored, not
-- an error. Dropping them is deferred to a separate future CONTRACT
-- migration, requiring its own authorization once this expand migration
-- and the new billing code have been live and stable in production.
ALTER TABLE "Plan" ADD COLUMN     "priceMonthly" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "priceYearly" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill priceMonthly from the existing price column - preserves current
-- values exactly, no assumptions, no data loss.
UPDATE "Plan" SET "priceMonthly" = "price";

-- Backfill the owner-approved yearly prices (BILLING-02 S3). Hardcoded
-- per-row, not computed from a discount formula at migration time - these
-- are business-approved numbers, not a derived value.
UPDATE "Plan" SET "priceYearly" = 0 WHERE "id" = 'free';
UPDATE "Plan" SET "priceYearly" = 279 WHERE "id" = 'pro';
UPDATE "Plan" SET "priceYearly" = 949 WHERE "id" = 'elite';
UPDATE "Plan" SET "priceYearly" = 4790 WHERE "id" = 'enterprise';
