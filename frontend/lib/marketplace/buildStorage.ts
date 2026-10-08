// lib/marketplace/buildStorage.ts
// Private Supabase Storage bucket for seller product files (compiled EAs etc.). Unlike marketplace-media (public-read),
// nothing here is ever readable from the browser: uploads use a one-time signed upload URL minted after this app's own
// auth + ownership check, and downloads go through the licensed download route (service-role read).
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { BUILDS_BUCKET } from "@/lib/marketplace/selfServe";

export const MARKETPLACE_BUILDS_BUCKET = BUILDS_BUCKET;

let bucketChecked = false;

async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;
  const admin = getSupabaseAdmin();
  const { data } = await admin.storage.getBucket(MARKETPLACE_BUILDS_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(MARKETPLACE_BUILDS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create the builds bucket: ${error.message}`);
  }
  bucketChecked = true;
}

export async function createBuildUploadUrl(objectPath: string): Promise<{ path: string; token: string }> {
  await ensureBucket();
  const { data, error } = await getSupabaseAdmin().storage.from(MARKETPLACE_BUILDS_BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) throw new Error(`Could not create an upload URL: ${error?.message ?? "unknown error"}`);
  return { path: data.path, token: data.token };
}

export async function downloadBuild(objectPath: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from(MARKETPLACE_BUILDS_BUCKET).download(objectPath);
  if (error || !data) throw new Error(`Build download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeBuild(objectPath: string): Promise<void> {
  await getSupabaseAdmin().storage.from(MARKETPLACE_BUILDS_BUCKET).remove([objectPath]);
}
