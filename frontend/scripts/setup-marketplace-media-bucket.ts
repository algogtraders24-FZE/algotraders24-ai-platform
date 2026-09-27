// AT24 Security Hardening P0 - one-time (idempotent) setup for the
// marketplace-media Supabase Storage bucket. Safe to re-run: checks for
// existing bucket by name before creating, never touches an existing one.
// Run: npm run setup:marketplace-media-bucket
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { MARKETPLACE_MEDIA_BUCKET } from "../lib/marketplace/mediaStorage";

async function main() {
  const admin = getSupabaseAdmin();
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) {
    throw new Error(`Failed to list buckets: ${listError.message}`);
  }

  if (buckets.some((b) => b.name === MARKETPLACE_MEDIA_BUCKET)) {
    console.log(`Bucket "${MARKETPLACE_MEDIA_BUCKET}" already exists - nothing to do.`);
    return;
  }

  const { error: createError } = await admin.storage.createBucket(MARKETPLACE_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: 3 * 1024 * 1024, // 3MB, matches the upload route's own MAX_BYTES
    allowedMimeTypes: ["image/svg+xml", "image/png", "image/jpeg", "image/webp"],
  });
  if (createError) {
    throw new Error(`Failed to create bucket: ${createError.message}`);
  }

  console.log(`Created public bucket "${MARKETPLACE_MEDIA_BUCKET}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
