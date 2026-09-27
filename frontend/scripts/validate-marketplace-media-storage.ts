// scripts/validate-marketplace-media-storage.ts
// AT24 Security Hardening P0 - validates uploadMarketplaceMedia() against
// the REAL marketplace-media Supabase Storage bucket (created via
// `npm run setup:marketplace-media-bucket`). The old local-filesystem
// writeFile approach silently broke on Vercel (read-only fs outside /tmp) -
// this proves the replacement actually persists and serves a real object.
//
// Standalone validation against the REAL database/storage (no test
// framework in this project - see package.json), matching the existing
// validate-payment-links.ts convention. Run via
// `npm run validate:marketplace-media-storage`.
//
// Safety: every uploaded object is under a run-tagged throwaway "listingId"
// folder, deleted from Storage in a `finally` block regardless of pass/fail.
import assert from "node:assert/strict";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { uploadMarketplaceMedia, MARKETPLACE_MEDIA_BUCKET } from "../lib/marketplace/mediaStorage";

const RUN_TAG = `media-storage-${Date.now()}`;

let passed = 0;
let failed = 0;
const uploadedPaths: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

async function main() {
  try {
    await test("bucket exists and is public (setup script ran successfully)", async () => {
      const { data: buckets, error } = await getSupabaseAdmin().storage.listBuckets();
      assert.ifError(error);
      const bucket = buckets?.find((b) => b.name === MARKETPLACE_MEDIA_BUCKET);
      assert.ok(bucket, `bucket "${MARKETPLACE_MEDIA_BUCKET}" not found - run npm run setup:marketplace-media-bucket first`);
      assert.equal(bucket.public, true);
    });

    await test("uploadMarketplaceMedia() persists a real object and returns a working public URL", async () => {
      const listingId = `${RUN_TAG}-listing`;
      const filename = "icon-test.png";
      const buffer = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077053d0000000a4944415478da6360000002000155a2415d0000000049454e44ae426082",
        "hex",
      ); // smallest valid 1x1 PNG
      uploadedPaths.push(`${listingId}/${filename}`);

      const url = await uploadMarketplaceMedia({ listingId, filename, buffer, contentType: "image/png" });
      assert.ok(url.includes(MARKETPLACE_MEDIA_BUCKET), "returned URL should reference the marketplace-media bucket");
      assert.ok(url.includes(listingId), "returned URL should be scoped under the listing's own folder");

      const res = await fetch(url);
      assert.equal(res.status, 200, `expected the public URL to be fetchable, got ${res.status}`);
      const fetchedBytes = Buffer.from(await res.arrayBuffer());
      assert.ok(fetchedBytes.equals(buffer), "fetched object bytes should match what was uploaded");
    });

    await test("uploading to the same listing/filename twice fails (upsert: false - no silent overwrite of another seller's asset)", async () => {
      const listingId = `${RUN_TAG}-listing`;
      const filename = "icon-test.png"; // same as above - already uploaded
      const buffer = Buffer.from("00", "hex");
      await assert.rejects(() => uploadMarketplaceMedia({ listingId, filename, buffer, contentType: "image/png" }));
    });
  } finally {
    const cleanupErrors: string[] = [];
    const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    await safeDelete("storage objects", async () => {
      const { error } = await getSupabaseAdmin().storage.from(MARKETPLACE_MEDIA_BUCKET).remove(uploadedPaths);
      if (error) throw new Error(error.message);
    });

    if (cleanupErrors.length > 0) {
      console.error("  WARNING: cleanup step(s) failed:");
      for (const e of cleanupErrors) console.error(`    ${e}`);
      failed += 1;
    } else {
      console.log("  cleanup - all uploaded test objects removed from Storage");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
