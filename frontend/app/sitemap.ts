import type { MetadataRoute } from "next";
import { MARKETS } from "@/services/markets/hub";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import { blogReaderService } from "@/services/publishing/blog-reader.service";

// Sprint H1.6 - real, derived routes only: static public pages plus every
// actual product slug from the database (the same source
// app/products/[slug]/page.tsx uses for generateStaticParams). No invented
// URLs.
//
// Sprint D2.4.A1 - extended with every real page the new IA shipped. Hub
// pages for /solutions, /resources, /company are included (they're real,
// crawlable "what's here / what's coming" pages) but their still-unbuilt
// (C) children are deliberately NOT listed here - each page's own
// `robots: { index: false }` metadata is what keeps a not-yet-real page out
// of search results, not an omission here masking a 404. /platform/research
// is a redirect, not a distinct page, so it's excluded too.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The real catalogue is /marketplace (the legacy /products and /products/<slug> URLs only redirect there, so listing them
  // told crawlers to index redirects while the real pages were missing). One entry per public listing, with its last change.
  const listings = await MarketplaceCatalogue.getAllForSitemap().catch(() => [] as Array<{ slug: string; updatedAt: Date }>);
  // Sprint P2.5 - real published blog posts (a SUCCEEDED INTERNAL_BLOG job), derived the same way
  // /blog/[slug]#generateStaticParams derives them. No invented URLs: a post only appears here once it is genuinely live.
  const posts = await blogReaderService.listPosts().catch(() => [] as Awaited<ReturnType<typeof blogReaderService.listPosts>>);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/marketplace`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/platform`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/platform/assistant`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/market-intelligence`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/workspace`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/publishing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/platform/knowledge-base`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/blog`, changeFrequency: "daily", priority: 0.7 },
    { url: `${SITE_URL}/methodology`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/calibration`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/markets`, changeFrequency: "daily", priority: 0.8 },
    ...MARKETS.map((m) => ({ url: `${SITE_URL}/markets/${m.slug}`, changeFrequency: "hourly" as const, priority: 0.8 })),
    { url: `${SITE_URL}/resources`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/resources/faq`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/resources/documentation`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/resources/tutorials`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/resources/market-insights`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/resources/research`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/resources/release-notes`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/resources/roadmap`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/company/media-kit`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/company/brand-assets`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/solutions`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/solutions/retail-traders`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/solutions/professional-traders`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/getting-started`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/company`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/company/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/company/vision`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/company/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/company/disclaimer`, changeFrequency: "yearly", priority: 0.3 },
    // /login and /signup are deliberately NOT listed: they are noindex account screens, not search content.
  ];

  const listingRoutes: MetadataRoute.Sitemap = listings.map((l) => ({
    url: `${SITE_URL}/marketplace/${l.slug}`,
    lastModified: l.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const blogRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    ...(p.publishedAt ? { lastModified: new Date(p.publishedAt) } : {}),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...listingRoutes, ...blogRoutes];
}
