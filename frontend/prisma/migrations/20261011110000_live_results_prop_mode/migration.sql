-- Live Results: Prop Mode settings (additive, nullable).
ALTER TABLE "live_results_pages" ADD COLUMN IF NOT EXISTS "propMode" JSONB;
