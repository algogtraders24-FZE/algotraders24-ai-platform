-- Live Sync: opt-in broker company name (additive, nullable / defaulted).
ALTER TABLE "live_sync_accounts" ADD COLUMN IF NOT EXISTS "broker" TEXT;
ALTER TABLE "live_results_pages" ADD COLUMN IF NOT EXISTS "showBroker" BOOLEAN NOT NULL DEFAULT false;
