-- Additive: lets the owner leave an account out of "My portfolio" (display only).
ALTER TABLE "live_sync_accounts" ADD COLUMN "hiddenFromPortfolio" BOOLEAN NOT NULL DEFAULT false;
