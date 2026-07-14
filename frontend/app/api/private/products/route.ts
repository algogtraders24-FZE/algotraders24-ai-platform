// app/api/private/products/route.ts
// Sprint 14D - Repository-backed. Auth enforced by middleware.
// Sprint 14E - Returns the full product catalogue (descriptions, media,
// features, specifications, FAQs) now that Product is fully persisted.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { prisma } from "@/lib/prisma";

export const GET = withContext(async (req, ctx) => {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? 50))
  );
  const category = url.searchParams.get("category") ?? undefined;
  const featured = url.searchParams.get("featured");

  const where = {
    deletedAt: null,
    ...(category ? { category } : {}),
    ...(featured === "true" ? { featured: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const items = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    shortDescription: p.shortDescription,
    fullDescription: p.fullDescription,
    category: p.category,
    platform: p.platform,
    supportedPlatforms: p.supportedPlatforms,
    tags: p.tags,
    price: p.price,
    currency: p.currency,
    images: p.images,
    features: p.features,
    specifications: p.specifications,
    faqs: p.faqs,
    version: p.version,
    releaseDate: p.releaseDate,
    lastUpdated: p.lastUpdated,
    rating: p.rating,
    downloads: p.downloads,
    featured: p.featured,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return ApiResponse.success(
    { items, total, page, pageSize },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});