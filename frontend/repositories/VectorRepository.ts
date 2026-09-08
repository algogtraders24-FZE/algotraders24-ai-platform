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
  // ── Sprint K1 — Knowledge Loop retrieval eligibility (ADDITIVE) ──────
  // When `scopes` is a non-empty array the query JOINs `Knowledge` and
  // enforces the retrieval-safety predicate (KNOWLEDGE_CONTRACT.md §10 /
  // KNOWLEDGE_RETRIEVAL_CONTRACT.md §3.1 step 4 / K1_DECISION INV-1):
  //   k."lifecycleStatus" = 'active'  AND  k."supersededById" IS NULL
  //   AND k."deletedAt" IS NULL  AND (k."expiresAt" IS NULL OR future)
  //   AND k."scope"::text = ANY(scopes)  AND k."visibility"::text = ANY(visibilities)
  // plus an OR branch for the caller's own `scope = 'user'` rows when
  // `includeUserScope` + `callerUserId` are set.
  // When `scopes` is omitted the query is byte-identical to the pre-K1
  // behaviour (K1_DECISION A-13) — no JOIN, no Knowledge predicate.
  scopes?: string[];
  visibilities?: string[];
  includeUserScope?: boolean;
  callerUserId?: string;
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

    const scoped =
      Array.isArray(params.scopes) && params.scopes.length > 0;

    let sql: string;
    const args: unknown[] = [literal];

    if (!scoped) {
      // ── Pre-K1 path — UNCHANGED (K1_DECISION A-13 backward compat). ──
      const conditions: string[] = [
        `"deletedAt" IS NULL`,
        `"embedding" IS NOT NULL`,
      ];
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
      sql =
        `SELECT "id", "knowledgeId", "userId", "content", "chunkIndex", ` +
        `1 - ("embedding" <=> $1::vector) AS "similarity" ` +
        `FROM "KnowledgeChunk" ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY "embedding" <=> $1::vector ` +
        `LIMIT ${topK}`;
    } else {
      // ── Sprint K1 — Knowledge Loop eligibility-filtered retrieval. ───
      // The retrieval-safety predicate (INV-1) is enforced in SQL here so
      // an ineligible row can never even reach the ranking layer. The
      // KnowledgeService re-checks eligibility on hydration too (cache
      // path), but this is the structural gate.
      const scopes = params.scopes!.map((s) => this.validateId(s, "scope"));
      const visibilities = (params.visibilities ?? []).map((v) =>
        this.validateId(v, "visibility"),
      );
      const conditions: string[] = [
        `kc."deletedAt" IS NULL`,
        `kc."embedding" IS NOT NULL`,
        `k."deletedAt" IS NULL`,
        `k."supersededById" IS NULL`,
        `(k."expiresAt" IS NULL OR k."expiresAt" > now())`,
      ];
      let n = 2;

      const scopesParam = `$${n}`;
      args.push(scopes);
      n += 1;

      // Verified-knowledge branch: active + in-scope + (visibility unset OR in-list).
      let verifiedBranch =
        `(k."scope"::text = ANY(${scopesParam}) ` +
        `AND k."lifecycleStatus" = 'active'`;
      if (visibilities.length > 0) {
        verifiedBranch += ` AND k."visibility"::text = ANY($${n})`;
        args.push(visibilities);
        n += 1;
      }
      verifiedBranch += `)`;

      // Own private-knowledge branch: the caller's own scope = 'user' rows.
      let ownBranch = "";
      if (params.includeUserScope && params.callerUserId) {
        const uId = this.validateId(params.callerUserId, "callerUserId");
        ownBranch =
          ` OR (k."scope"::text = 'user' AND k."userId" = $${n} ` +
          `AND (k."lifecycleStatus" IS NULL OR k."lifecycleStatus" = 'active'))`;
        args.push(uId);
        n += 1;
      }
      conditions.push(`(${verifiedBranch}${ownBranch})`);

      if (params.knowledgeId !== undefined) {
        const kId = this.validateId(params.knowledgeId, "knowledgeId");
        conditions.push(`kc."knowledgeId" = $${n}`);
        args.push(kId);
        n += 1;
      }

      sql =
        `SELECT kc."id", kc."knowledgeId", kc."userId", kc."content", kc."chunkIndex", ` +
        `1 - (kc."embedding" <=> $1::vector) AS "similarity" ` +
        `FROM "KnowledgeChunk" kc ` +
        `JOIN "Knowledge" k ON k."id" = kc."knowledgeId" ` +
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY kc."embedding" <=> $1::vector ` +
        `LIMIT ${topK}`;
    }

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
