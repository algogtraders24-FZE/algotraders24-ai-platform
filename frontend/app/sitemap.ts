import type { MetadataRoute } from "next";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";

// Sprint H1.6 - real, derived routes only: static public pages plus every
// actual product slug from the database (the same source
// app/products/[slug]/page.tsx uses for generateStaticParams). No invented
// URLs.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await ProductCatalogue.getAllSlugs();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/products`, changeFrequency: "daily", priority: 0.9 },
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
