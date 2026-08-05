import type { MetadataRoute } from "next";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";

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
  const slugs = await ProductCatalogue.getAllSlugs();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/products`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/platform`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/platform/assistant`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/market-intelligence`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/workspace`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/platform/publishing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/platform/knowledge-base`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/resources`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/resources/faq`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/solutions`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/solutions/retail-traders`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/solutions/professional-traders`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/company`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${SITE_URL}/company/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/company/vision`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/company/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/company/disclaimer`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/signup`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const productRoutes: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${SITE_URL}/products/${slug}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...productRoutes];
}
