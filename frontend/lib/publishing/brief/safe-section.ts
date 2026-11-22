// lib/publishing/brief/safe-section.ts
// Market Brief 2.0: the public reader's sanitizer for the optional structured section fields (pure, no database).
// Used by services/publishing/blog-reader.service.ts and by scripts/validate-brief-render.ts.
import { toSafeInline, toSafePlainText } from "@/lib/publishing/sanitize-text";
import type { BlogPost, PublishedInternalBlogRecord } from "@/types/publishing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

const SECTION_KINDS = new Set(["headline", "chips", "hero", "bullets", "fit", "scenarios", "plan", "check", "learn", "footer"]);

/** Image URLs are only kept when they point to OUR Supabase storage or our own site (https), never an arbitrary host. */
export function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (!/\.(png|jpe?g|webp)$/i.test(u.pathname)) return false; // an image file only
    if (u.pathname.includes("..")) return false;
    // our own Supabase project: only the public brief-charts bucket (never another bucket of the same project)
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabase) {
      try {
        if (u.host === new URL(supabase).host) return u.pathname.startsWith("/storage/v1/object/public/brief-charts/");
      } catch { /* ignore a malformed env value */ }
    }
    // our own site (brand and marketplace images)
    const siteHosts = new Set<string>(["algotraders24.ai", "www.algotraders24.ai"]);
    try { siteHosts.add(new URL(SITE_URL).host); } catch { /* ignore */ }
    return siteHosts.has(u.host);
  } catch {
    return false;
  }
}

/** Sanitizes one section: heading/body as before, plus the optional Market Brief 2.0 fields (whitelisted kind and tone, plain text only). */
export function toSafeSection(s: PublishedInternalBlogRecord["sections"][number]): BlogPost["sections"][number] {
  const out: BlogPost["sections"][number] = { heading: toSafeInline(s.heading), body: toSafePlainText(s.body) };
  if (s.kind && SECTION_KINDS.has(s.kind)) out.kind = s.kind;
  if (Array.isArray(s.bullets)) out.bullets = s.bullets.map((b) => toSafePlainText(b)).filter((b) => b.length > 0).slice(0, 20);
  if (Array.isArray(s.chips)) out.chips = s.chips.map((c) => ({ value: toSafeInline(c?.value), label: toSafeInline(c?.label) })).filter((c) => c.value.length > 0).slice(0, 8);
  if (Array.isArray(s.cards)) {
    out.cards = s.cards
      .map((c) => ({ title: toSafeInline(c?.title), body: toSafePlainText(c?.body), tone: c?.tone === "up" || c?.tone === "down" ? c.tone : ("neutral" as const) }))
      .filter((c) => c.title.length > 0 && c.body.length > 0)
      .slice(0, 4);
  }
  if (s.image && typeof s.image.url === "string" && isAllowedImageUrl(s.image.url)) {
    out.image = { url: s.image.url, alt: toSafeInline(s.image.alt), caption: toSafeInline(s.image.caption) };
  }
  return out;
}
