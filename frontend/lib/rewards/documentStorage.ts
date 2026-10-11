// lib/rewards/documentStorage.ts
// Private Supabase Storage bucket for issued contract PDFs. Nothing here is readable from the browser: downloads go through the
// authenticated route, which also checks the stored SHA-256 before sending the file.
import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const CONTRACTS_BUCKET = "reward-contracts";
let bucketChecked = false;

async function ensureBucket(): Promise<void> {
  if (bucketChecked) return;
  const admin = getSupabaseAdmin();
  const { data } = await admin.storage.getBucket(CONTRACTS_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(CONTRACTS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create the contracts bucket: ${error.message}`);
  }
  bucketChecked = true;
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function saveContractPdf(path: string, bytes: Uint8Array): Promise<void> {
  await ensureBucket();
  const { error } = await getSupabaseAdmin().storage.from(CONTRACTS_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Contract upload failed: ${error.message}`);
}

export async function readContractPdf(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from(CONTRACTS_BUCKET).download(path);
  if (error || !data) throw new Error(`Contract download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}
