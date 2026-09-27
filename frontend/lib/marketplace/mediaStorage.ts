// AT24 Security Hardening P0 - marketplace listing media storage.
// Replaces the old writeFile-to-public/ approach (broken on Vercel: the
// deployed serverless filesystem is read-only outside /tmp, and each
// invocation is an ephemeral, non-shared instance) with Supabase Storage.
// Bucket is public-read; every write still goes through this app's own
// authenticated + ownership-checked route handler using the service-role
// client below, never a direct client-to-Supabase upload - so access
// control is unchanged from before, only the storage sink moved.
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const MARKETPLACE_MEDIA_BUCKET = "marketplace-media";

export async function uploadMarketplaceMedia(params: {
  listingId: string;
  filename: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const { listingId, filename, buffer, contentType } = params;
  const objectPath = `${listingId}/${filename}`;

  const { error } = await getSupabaseAdmin()
    .storage.from(MARKETPLACE_MEDIA_BUCKET)
    .upload(objectPath, buffer, { contentType, upsert: false });

  if (error) {
    throw new Error(`Marketplace media upload failed: ${error.message}`);
  }

  const { data } = getSupabaseAdmin()
    .storage.from(MARKETPLACE_MEDIA_BUCKET)
    .getPublicUrl(objectPath);

  return data.publicUrl;
}
