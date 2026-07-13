// repositories/PrismaProductRepository.ts
// Sprint 14D - Prisma-backed ProductRepository.
import type { ProductEntity } from "./ProductRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Product as PrismaProduct } from "@/lib/generated/prisma/client";

function narrowStatus(v: string): ProductEntity["status"] {
  return v === "active" || v === "archived" ? v : "draft";
}

export class PrismaProductRepository extends PrismaBaseRepository<ProductEntity, PrismaProduct> {
  protected entityName = "Product";
  protected delegate = prisma.product as unknown as PrismaDelegate;

  protected toEntity(row: PrismaProduct): ProductEntity {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      status: narrowStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<ProductEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      name: input.name,
      slug: input.slug,
      price: input.price,
      status: input.status,
    };
  }

  protected toUpdateData(patch: Partial<Omit<ProductEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      name: patch.name ?? undefined,
      slug: patch.slug ?? undefined,
      price: patch.price ?? undefined,
      status: patch.status ?? undefined,
    };
  }

  async findBySlug(slug: string): Promise<ProductEntity | null> {
    return this.run("findBySlug", async () => {
      const row = (await this.delegate.findFirst({ where: { slug, deletedAt: null } })) as PrismaProduct | null;
      return row ? this.toEntity(row) : null;
    });
  }
}
