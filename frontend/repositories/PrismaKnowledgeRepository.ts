// repositories/PrismaKnowledgeRepository.ts
// Sprint 14D - Prisma-backed KnowledgeRepository.
import type { KnowledgeEntity } from "./KnowledgeRepository";
import { PrismaBaseRepository, type PrismaDelegate } from "./PrismaBaseRepository";
import { prisma } from "@/lib/prisma";
import type { Knowledge as PrismaKnowledge } from "@/lib/generated/prisma/client";

function narrowStatus(v: string): KnowledgeEntity["status"] {
  return v === "indexed" || v === "failed" ? v : "processing";
}

export class PrismaKnowledgeRepository extends PrismaBaseRepository<KnowledgeEntity, PrismaKnowledge> {
  protected entityName = "Knowledge";
  protected delegate = prisma.knowledge as unknown as PrismaDelegate;

  protected toEntity(row: PrismaKnowledge): KnowledgeEntity {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      source: row.source,
      chunkCount: row.chunkCount,
      status: narrowStatus(row.status),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  protected toCreateData(input: Omit<KnowledgeEntity, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
    return {
      userId: input.userId,
      title: input.title,
      source: input.source,
      chunkCount: input.chunkCount,
      status: input.status,
    };
  }

  protected toUpdateData(patch: Partial<Omit<KnowledgeEntity, "id" | "createdAt">>): Record<string, unknown> {
    return {
      userId: patch.userId ?? undefined,
      title: patch.title ?? undefined,
      source: patch.source ?? undefined,
      chunkCount: patch.chunkCount ?? undefined,
      status: patch.status ?? undefined,
    };
  }

  async findByUser(userId: string): Promise<KnowledgeEntity[]> {
    return this.run("findByUser", async () => {
      const rows = (await this.delegate.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } })) as PrismaKnowledge[];
      return rows.map((r) => this.toEntity(r));
    });
  }
}
