-- Seller self-serve: product files stored in Supabase Storage. Additive, nullable: existing rows and old code are unaffected.
ALTER TABLE "release_artifacts" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "release_artifacts" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "release_artifacts" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;
