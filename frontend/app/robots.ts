import type { MetadataRoute } from "next";

// Sprint H1.6 - real route audit: /dashboard/* is auth-gated application
// UI, /api/* are backend endpoints, /auth/callback is a technical redirect
// - none of these are content for a crawler to index. Everything else
// (marketing pages, product pages) is public and indexable.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api", "/auth"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
