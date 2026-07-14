// services/products/ProductCatalogue.ts
// Sprint 14E - Server-side product catalogue reads.
// Public product pages are Server Components, so they query Prisma directly
// rather than going through the authenticated /api/private/* layer.
import "server-only";
import type { Product, ProductCategoryId, ProductStatus, ProductSpecification, ProductFAQ } from "@/types/product";
import { prisma } from "@/lib/prisma";
import type { Product as PrismaProduct } from "@/lib/generated/prisma/client";

function toProduct(row: PrismaProduct): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    category: row.category as ProductCategoryId,
    platform: row.platform,
    supportedPlatforms: row.supportedPlatforms,
    tags: row.tags,
    price: row.price,
    currency: row.currency,
    images: row.images,
    features: row.features,
    specifications: (row.specifications ?? []) as unknown as ProductSpecification[],
    faqs: (row.faqs ?? []) as unknown as ProductFAQ[],
    version: row.version,
    releaseDate: row.releaseDate,
    lastUpdated: row.lastUpdated,
    rating: row.rating,
    downloads: row.downloads,
    featured: row.featured,
    status: row.status as ProductStatus,
  };
}

export class ProductCatalogue {
  static async getAll(): Promise<Product[]> {
    const rows = await prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(toProduct);
  }

  static async getBySlug(slug: string): Promise<Product | null> {
    const row = await prisma.product.findFirst({
      where: { slug, deletedAt: null },
    });
    return row ? toProduct(row) : null;
  }

  static async getByCategory(category: string): Promise<Product[]> {
    const rows = await prisma.product.findMany({
      where: { category, deletedAt: null },
      orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
    });
    return rows.map(toProduct);
  }

  static async getFeatured(): Promise<Product[]> {
    const rows = await prisma.product.findMany({
      where: { featured: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toProduct);
  }

  static async getRelated(
    slug: string,
    category: string,
    limit = 3
  ): Promise<Product[]> {
    const rows = await prisma.product.findMany({
      where: { category, deletedAt: null, NOT: { slug } },
      orderBy: { downloads: "desc" },
      take: limit,
    });
    return rows.map(toProduct);
  }

  static async getAllSlugs(): Promise<string[]> {
    const rows = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }
}