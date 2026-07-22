// repositories/VectorRepository.ts
// Sprint 15B.4 - Dedicated repository for vector (embedding) operations.
//
// ARCHITECTURAL RULE: all raw SQL touching the pgvector "embedding" column
// lives ONLY here. The column is intentionally absent from the Prisma schema
// (avoids Prisma 7 Unsupported("vector") drift, issue #28867), so it is
// accessed exclusively through parameterized raw SQL via the existing Prisma
// client. This repository does NOT extend PrismaBaseRepository because vector
// operations are not CRUD over an entity; it follows the same conventions
// (error translation, query instrumentation) as a standalone unit.
import { prisma } from "@/lib/prisma";
import {
  RepositoryError,
  DatabaseConnectionError,
} from "@/types/repository";

const EMBEDDING_DIMENSIONS = 768;
const MAX_TOP_K = 100;

export interface VectorSearchResult {
  chunkId: string;
  knowledgeId: string;
  userId: string;
  content: string;
  chunkIndex: number;
  similarity: number; // 1 - cosine_distance, higher = more similar
}

export interface VectorSearchParams {
  embedding: number[];
  topK: number;
  knowledgeId?: string;
  userId?: string;
}

export interface IVectorRepository {
  storeEmbedding(chunkId: string, embedding: number[]): Promise<void>;
  searchSimilar(params: VectorSearchParams): Promise<VectorSearchResult[]>;
}

export class PrismaVectorRepository implements IVectorRepository {
  private readonly entityName = "KnowledgeChunk";

  // ---- validation ----

  private validateEmbedding(embedding: unknown): number[] {
    if (!Array.isArray(embedding)) {
      throw this.invalid("embedding must be an array of numbers");
    }
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw this.invalid(
        `embedding must have exactly ${EMBEDDING_DIMENSIONS} dimensions (got ${embedding.length})`
      );
    }
    for (const v of embedding) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw this.invalid("embedding must contain only finite numbers");
      }
    }
    return embedding as number[];
  }

  private validateTopK(topK: unknown): number {
    if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1) {
      throw this.invalid("topK must be a positive integer");
    }
    return Math.min(topK, MAX_TOP_K);
  }

  private validateId(id: unknown, field: string): string {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw this.invalid(`${field} must be a non-empty string`);
    }
    return id;
  }

  private invalid(message: string): RepositoryError {
    return new RepositoryError({
      code: "VALIDATION",
      entity: this.entityName,
      operation: "vector",
      message,
    });
  }

  // pgvector literal format: "[0.1,0.2,...]" (passed as a bound parameter).
  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
  }

  // Mirrors PrismaBaseRepository error translation for connection failures.
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

  // ---- operations ----

  async storeEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const id = this.validateId(chunkId, "chunkId");
    const vec = this.validateEmbedding(embedding);
    const literal = this.toVectorLiteral(vec);
    try {
      // Parameterized: values are bound ($1, $2), never string-interpolated.
      await prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeChunk" SET "embedding" = $1::vector, "updatedAt" = NOW() WHERE "id" = $2 AND "deletedAt" IS NULL`,
        literal,
        id
      );
    } catch (error) {
      throw this.translate("storeEmbedding", error);
    }
  }

  async searchSimilar(
    params: VectorSearchParams
  ): Promise<VectorSearchResult[]> {
    const vec = this.validateEmbedding(params.embedding);
    const topK = this.validateTopK(params.topK);
    const literal = this.toVectorLiteral(vec);

    const conditions: string[] = [
      `"deletedAt" IS NULL`,
      `"embedding" IS NOT NULL`,
    ];
    const args: unknown[] = [literal];
    let n = 2;

    if (params.knowledgeId !== undefined) {
      const kId = this.validateId(params.knowledgeId, "knowledgeId");
      conditions.push(`"knowledgeId" = $${n}`);
      args.push(kId);
      n += 1;
    }
    if (params.userId !== undefined) {
      const uId = this.validateId(params.userId, "userId");
      conditions.push(`"userId" = $${n}`);
      args.push(uId);
      n += 1;
    }

    // topK is a validated bounded integer; safe to inline as LIMIT.
    const sql =
      `SELECT "id", "knowledgeId", "userId", "content", "chunkIndex", ` +
      `1 - ("embedding" <=> $1::vector) AS "similarity" ` +
      `FROM "KnowledgeChunk" ` +
      `WHERE ${conditions.join(" AND ")} ` +
      `ORDER BY "embedding" <=> $1::vector ` +
      `LIMIT ${topK}`;

    try {
      const rows = (await prisma.$queryRawUnsafe(sql, ...args)) as Array<{
        id: string;
        knowledgeId: string;
        userId: string;
        content: string;
        chunkIndex: number;
        similarity: number;
      }>;
      return rows.map((r) => ({
        chunkId: r.id,
        knowledgeId: r.knowledgeId,
        userId: r.userId,
        content: r.content,
        chunkIndex: r.chunkIndex,
        similarity: Number(r.similarity),
      }));
    } catch (error) {
      throw this.translate("searchSimilar", error);
    }
  }
}
