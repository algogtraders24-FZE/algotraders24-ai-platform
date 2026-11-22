// lib/publishing/brief/brief-storage.ts
// Market Brief 2.0: stores a rendered chart PNG in Supabase Storage (public-read bucket, same pattern as lib/marketplace/mediaStorage.ts:
// the deployed serverless filesystem is read-only, so images cannot be written under public/). Writes use the service-role client, only
// from server code that has already passed the cron-secret / admin gate.
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BriefChartSize } from "./brief-chart";

export const BRIEF_CHARTS_BUCKET = "brief-charts";

export function briefChartPath(symbol: string, dateIso: string, size: BriefChartSize): string {
  const day = dateIso.slice(0, 10);
  return `${day}/${symbol.toLowerCase()}-${size}.png`;
}

/** Creates the public bucket once (idempotent: "already exists" is not an error). */
export async function ensureBriefChartsBucket(): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.createBucket(BRIEF_CHARTS_BUCKET, { public: true });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Brief charts bucket: ${error.message}`);
}

export async function uploadBriefChart(params: { symbol: string; dateIso: string; size: BriefChartSize; png: Buffer }): Promise<string> {
  const path = briefChartPath(params.symbol, params.dateIso, params.size);
  const admin = getSupabaseAdmin();
  const first = await admin.storage.from(BRIEF_CHARTS_BUCKET).upload(path, params.png, { contentType: "image/png", upsert: true, cacheControl: "3600" });
  if (first.error) {
    // the bucket may not exist yet on a fresh project: create it once and retry
    await ensureBriefChartsBucket();
    const retry = await admin.storage.from(BRIEF_CHARTS_BUCKET).upload(path, params.png, { contentType: "image/png", upsert: true, cacheControl: "3600" });
    if (retry.error) throw new Error(`Brief chart upload failed: ${retry.error.message}`);
  }
  return admin.storage.from(BRIEF_CHARTS_BUCKET).getPublicUrl(path).data.publicUrl;
}
