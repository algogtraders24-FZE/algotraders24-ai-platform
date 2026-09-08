// services/knowledge-loop/knowledge/prisma-backend.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop. Production adapters:
//   PrismaKnowledgeStore  — the real `Knowledge` table + KnowledgeVersionCounter
//   PrismaVectorSearch    — delegates to VectorRepository.searchSimilar (the
//                           SQL-level INV-1 eligibility gate)
//   GeminiEmbeddingAdapter — wraps the existing GeminiEmbeddingProvider
//
// Functional once the K1 migration is applied (K1-F). Until then these are
// inert — the `validate:knowledge-loop-*` scripts use in-memory-backend.ts and
// never import this file, so K1's tests run with ZERO DB / ZERO Gemini calls.
//
// INV-1: PrismaKnowledgeStore never reads or writes the candidate table.

import { prisma } from "@/lib/prisma";
import { RepositoryFactory } from "@/repositories/RepositoryFactory";
import { GeminiEmbeddingProvider } from "@/lib/ai";
import type {
  KnowledgeRecord,
  KnowledgeChunkRecord,
  KnowledgeProvenance,
  CreateKnowledgeInput,
} from "@/types/knowledge-loop";
import type {
  KnowledgeStore,
  KnowledgeListFilter,
  TransitionInput,
  RetrievalLogEntry,
  VectorSearchPort,
  VectorSearchQuery,
  VectorHit,
  EmbeddingPort,
} from "./ports";

const VERSION_COUNTER_ID = "singleton";

/* eslint-disable @typescript-eslint/no-explicit-any */
function toRecord(row: any): KnowledgeRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description,
    category: row.category,
    canonicalQuestion: row.canonicalQuestion ?? null,
    canonicalAnswer: row.canonicalAnswer ?? null,
    knowledgeType: row.knowledgeType ?? null,
    scope: row.scope,
    visibility: row.visibility,
    source: row.source,
    sourceType: row.sourceType ?? null,
    provenance: (row.provenance as KnowledgeProvenance | null) ?? null,
    confidence: row.confidence ?? null,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus ?? null,
    embeddingStatus: row.embeddingStatus,
    version: row.version ?? 1,
    supersedesId: row.supersedesId ?? null,
    supersededById: row.supersededById ?? null,
    freshnessClass: row.freshnessClass ?? null,
    freshnessReviewEveryDays: row.freshnessReviewEveryDays ?? null,
    expiresAt: row.expiresAt ?? null,
    lastReviewedAt: row.lastReviewedAt ?? null,
    approvedAt: row.approvedAt ?? null,
    approvedBy: row.approvedBy ?? null,
    deprecatedAt: row.deprecatedAt ?? null,
    deprecatedBy: row.deprecatedBy ?? null,
    retrievalCount: row.retrievalCount ?? 0,
    lastRetrievedAt: row.lastRetrievedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function createData(input: CreateKnowledgeInput) {
  return {
    userId: input.userId,
    title: input.title,
    description: input.description ?? "",
    category: input.category ?? "general",
    source: input.source,
    canonicalQuestion: input.canonicalQuestion ?? null,
    canonicalAnswer: input.canonicalAnswer ?? null,
    knowledgeType: input.knowledgeType,
    scope: input.scope,
    visibility: input.visibility ?? "customer",
    sourceType: input.sourceType,
    provenance: input.provenance as unknown as object,
    confidence: input.confidence ?? null,
    lifecycleStatus: "draft" as const,
    freshnessClass: input.freshnessClass,
    freshnessReviewEveryDays: input.freshnessReviewEveryDays ?? null,
    expiresAt: input.expiresAt ?? null,
  };
}

export class PrismaKnowledgeStore implements KnowledgeStore {
  async getById(id: string): Promise<KnowledgeRecord | null> {
    const row = await prisma.knowledge.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }
  async getByIds(ids: string[]): Promise<KnowledgeRecord[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.knowledge.findMany({ where: { id: { in: ids } } });
    return rows.map(toRecord);
  }
  async getChunks(knowledgeIds: string[]): Promise<KnowledgeChunkRecord[]> {
    if (knowledgeIds.length === 0) return [];
    const rows = await prisma.knowledgeChunk.findMany({
      where: { knowledgeId: { in: knowledgeIds }, deletedAt: null },
      select: {
        id: true,
        knowledgeId: true,
        userId: true,
        chunkIndex: true,
        content: true,
      },
    });
    return rows.map((r) => ({
      chunkId: r.id,
      knowledgeId: r.knowledgeId,
      userId: r.userId,
      chunkIndex: r.chunkIndex,
      content: r.content,
    }));
  }
  async list(filter: KnowledgeListFilter): Promise<KnowledgeRecord[]> {
    const rows = await prisma.knowledge.findMany({
      where: {
        ...(filter.includeDeleted ? {} : { deletedAt: null }),
        ...(filter.scope ? { scope: filter.scope } : {}),
        ...(filter.lifecycleStatus
          ? { lifecycleStatus: filter.lifecycleStatus }
          : {}),
        ...(filter.knowledgeType
          ? { knowledgeType: filter.knowledgeType as never }
          : {}),
        ...(filter.supersededOnly ? { supersededById: { not: null } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRecord);
  }

  async create(input: CreateKnowledgeInput): Promise<KnowledgeRecord> {
    const row = await prisma.knowledge.create({
      data: { ...createData(input), chunkCount: 0 },
    });
    return toRecord(row);
  }

  async transition(
    input: TransitionInput,
  ): Promise<{ knowledge: KnowledgeRecord; versionFingerprint: string }> {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const existing = await tx.knowledge.findUnique({ where: { id: input.id } });
      if (!existing) throw new Error(`knowledge ${input.id} not found`);
      const data: Record<string, unknown> = {
        lifecycleStatus: input.to,
        ...(input.patch ?? {}),
      };
      if (input.to === "active" && !existing.approvedAt) {
        data.approvedAt = now;
        data.approvedBy = input.actorId;
      }
      if (input.to === "deprecated") {
        data.deprecatedAt = now;
        data.deprecatedBy = input.actorId;
      }
      const row = await tx.knowledge.update({
        where: { id: input.id },
        data: data as never,
      });
      const counter = await tx.knowledgeVersionCounter.upsert({
        where: { id: VERSION_COUNTER_ID },
        create: { id: VERSION_COUNTER_ID, value: BigInt(1) },
        update: { value: { increment: BigInt(1) } },
      });
      return {
        knowledge: toRecord(row),
        versionFingerprint: counter.value.toString(),
      };
    });
  }

  async createVersionOf(
    fromId: string,
    input: CreateKnowledgeInput,
  ): Promise<{
    created: KnowledgeRecord;
    deprecated: KnowledgeRecord;
    versionFingerprint: string;
  }> {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const prev = await tx.knowledge.findUnique({ where: { id: fromId } });
      if (!prev) throw new Error(`knowledge ${fromId} not found`);
      const createdRow = await tx.knowledge.create({
        data: {
          ...createData(input),
          chunkCount: 0,
          supersedesId: prev.id,
          version: prev.version + 1,
          lifecycleStatus: "active",
          approvedAt: now,
          approvedBy: input.userId,
        } as never,
      });
      const deprecatedRow = await tx.knowledge.update({
        where: { id: fromId },
        data: {
          supersededById: createdRow.id,
          lifecycleStatus: "deprecated",
          deprecatedAt: now,
        } as never,
      });
      const counter = await tx.knowledgeVersionCounter.upsert({
        where: { id: VERSION_COUNTER_ID },
        create: { id: VERSION_COUNTER_ID, value: BigInt(1) },
        update: { value: { increment: BigInt(1) } },
      });
      return {
        created: toRecord(createdRow),
        deprecated: toRecord(deprecatedRow),
        versionFingerprint: counter.value.toString(),
      };
    });
  }

  async getVersionFingerprint(): Promise<string> {
    const row = await prisma.knowledgeVersionCounter.findUnique({
      where: { id: VERSION_COUNTER_ID },
    });
    return (row?.value ?? BigInt(0)).toString();
  }

  async recordRetrieval(
    knowledgeIds: string[],
    log: RetrievalLogEntry,
  ): Promise<void> {
    const now = new Date();
    if (knowledgeIds.length > 0) {
      await prisma.knowledge
        .updateMany({
          where: { id: { in: knowledgeIds } },
          data: { retrievalCount: { increment: 1 }, lastRetrievedAt: now },
        })
        .catch(() => {});
    }
    await prisma.knowledgeRetrievalLog
      .create({
        data: {
          userId: log.userId,
          conversationId: log.conversationId,
          queryHash: log.queryHash,
          scopes: log.scopes,
          hitCount: log.hitCount,
          bestSimilarity: log.bestSimilarity,
          sufficiency: log.sufficiency,
          fromCache: log.fromCache,
          latencyMs: log.latencyMs,
        },
      })
      .catch(() => {});
  }
}

export class PrismaVectorSearch implements VectorSearchPort {
  async searchSimilar(q: VectorSearchQuery): Promise<VectorHit[]> {
    const rows = await RepositoryFactory.vectors().searchSimilar({
      embedding: q.embedding,
      topK: q.topK,
      scopes: q.scopes,
      visibilities: q.visibilities,
      includeUserScope: q.includeUserScope,
      callerUserId: q.callerUserId,
      knowledgeId: q.knowledgeId,
    });
    return rows.map((r) => ({
      chunkId: r.chunkId,
      knowledgeId: r.knowledgeId,
      userId: r.userId,
      content: r.content,
      chunkIndex: r.chunkIndex,
      similarity: r.similarity,
    }));
  }
}

export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly provider = new GeminiEmbeddingProvider();
  async embed(text: string): Promise<number[]> {
    const r = await this.provider.embed({ text });
    return r.embedding;
  }
}
