// lib/marketplace/shareLogo.ts
// Fetches a listing's own icon for the share card, only from hosts we control (own site or our Supabase storage), with a short
// timeout and a size cap, and returns a data URI (or null: the card then simply has no logo).

const MAX_LOGO_BYTES = 1_000_000;
const TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

/** The absolute URL to fetch, or null when the media URL points somewhere we do not trust. */
export function logoFetchUrl(media: string | undefined, siteUrl: string, supabaseUrl?: string): string | null {
  if (!media) return null;
  try {
    if (media.startsWith("/") && !media.startsWith("//")) return new URL(media, siteUrl).toString();
    const u = new URL(media);
    const allowed = [siteUrl, supabaseUrl].filter((x): x is string => !!x).map((x) => new URL(x).host);
    return u.protocol === "https:" && allowed.includes(u.host) ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function loadLogoDataUri(media: string | undefined, siteUrl: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): Promise<string | null> {
  const url = logoFetchUrl(media, siteUrl, supabaseUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!res.ok || !TYPES.includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
