-- Live Sync: which terminal sends the data, MT5 (default) or MT4 (additive, defaulted).
ALTER TABLE "live_sync_accounts" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'mt5';
