// repositories/PrismaKnowledgeChunkRepository.ts
// Sprint 15B.7 - Prisma-backed chunk persistence (structured columns only).
// Writes NEVER touch the "embedding" vector column (that is VectorRepository's
// job via raw SQL). createMany runs inside a transaction so a batch is atomic.
import { prisma } from "@/lib/prisma";
import {
  RepositoryError,
  DatabaseConnectionError,
} from "@/types/repository";
import type {
  ChunkEntity,
  NewChunkInput,
  IKnowledgeChunkRepository,
} from "./KnowledgeChunkRepository";

export class PrismaKnowledgeChunkRepository
  implements IKnowledgeChunkRepository
{
  private readonly entityName = "KnowledgeChunk";

  private translate(operation: string, error: unknown): RepositoryError {
    if (error instanceof RepositoryError) return error;
    const code = (error as { code?: string })?.code;
    if (code === "P1001" || code === "P1002" || code === "P1017") {
      return new DatabaseConnectionError(this.entityName, operation, error);
    }
    return new RepositoryError({
      code: "UNKNOWN",
      entity: this.entityName,
      operation,
      message: `${this.entityName}.${operation} failed`,
      cause: error,
    });
  }

  async createMany(chunks: NewChunkInput[]): Promise<ChunkEntity[]> {
    if (chunks.length === 0) return [];
    try {
      // Atomic: either all chunk records are created or none.
      const created = await prisma.$transaction(
        chunks.map((c) =>
          prisma.knowledgeChunk.create({
            data: {
              knowledgeId: c.knowledgeId,
              userId: c.userId,
              content: c.content,
              chunkIndex: c.chunkIndex,
              tokenCount: c.tokenCount,
              charCount: c.charCount,
            },
          }),
        ),
      );
      return created as ChunkEntity[];
    } catch (error) {
      throw this.translate("createMany", error);
    }
  }

  async findByKnowledge(knowledgeId: string): Promise<ChunkEntity[]> {
    try {
      const rows = await prisma.knowledgeChunk.findMany({
        where: { knowledgeId, deletedAt: null },
        orderBy: { chunkIndex: "asc" },
      });
      return rows as ChunkEntity[];
    } catch (error) {
      throw this.translate("findByKnowledge", error);
    }
  }

  async softDeleteByKnowledge(knowledgeId: string): Promise<number> {
    try {
      const result = await prisma.knowledgeChunk.updateMany({
        where: { knowledgeId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count;
    } catch (error) {
      throw this.translate("softDeleteByKnowledge", error);
    }
  }
}
