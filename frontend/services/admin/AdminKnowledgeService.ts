// services/admin/AdminKnowledgeService.ts
// Sprint L2.6 - Phase 4: Knowledge Administration. Reads Knowledge rows
// directly via Prisma (the same pattern L2.2/L2.5 already use for
// newer real routes) rather than through the IngestionService or any
// chat/search route file - this sprint may not modify the Knowledge
// pipeline, and a read-only admin list plus a soft-delete moderation
// action never calls into that pipeline at all. Deletion is a soft
// delete (deletedAt), consistent with every other model in this schema -
// never a hard delete that would orphan the row's KnowledgeChunk children
// (cascade-deleted only via the DB FK, which a soft delete deliberately
// does not trigger, preserving the chunks for audit/recovery).
import { prisma } from "@/lib/prisma";

export interface AdminKnowledgeRow {
  id: string;
  userId: string;
  ownerEmail: string;
  title: string;
  status: string;
  embeddingStatus: string;
  chunkCount: number;
  documentSize: number;
  retrievalCount: number;
  createdAt: string;
}

export interface AdminKnowledgePage {
  items: AdminKnowledgeRow[];
  total: number;
}

export interface AdminKnowledgeStats {
  totalDocuments: number;
  totalStorageBytes: number;
  byStatus: Record<string, number>;
  byEmbeddingStatus: Record<string, number>;
}

export class AdminKnowledgeService {
  async listKnowledge(params: { page: number; pageSize: number }): Promise<AdminKnowledgePage> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));

    const [rows, total] = await Promise.all([
      prisma.knowledge.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.knowledge.count({ where: { deletedAt: null } }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
    const emailByUser = new Map(users.map((u) => [u.id, u.email]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        ownerEmail: emailByUser.get(r.userId) ?? "unknown",
        title: r.title,
        status: r.status,
        embeddingStatus: r.embeddingStatus,
        chunkCount: r.chunkCount,
        documentSize: r.documentSize,
        retrievalCount: r.retrievalCount,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  async getStats(): Promise<AdminKnowledgeStats> {
    const rows = await prisma.knowledge.findMany({
      where: { deletedAt: null },
      select: { status: true, embeddingStatus: true, documentSize: true },
    });

    const byStatus: Record<string, number> = {};
    const byEmbeddingStatus: Record<string, number> = {};
    let totalStorageBytes = 0;

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byEmbeddingStatus[r.embeddingStatus] = (byEmbeddingStatus[r.embeddingStatus] ?? 0) + 1;
      totalStorageBytes += r.documentSize;
    }

    return { totalDocuments: rows.length, totalStorageBytes, byStatus, byEmbeddingStatus };
  }

  // Soft delete only - never touches KnowledgeChunk rows or re-triggers
  // any part of the ingestion pipeline.
  async softDeleteKnowledge(knowledgeId: string): Promise<boolean> {
    const existing = await prisma.knowledge.findUnique({ where: { id: knowledgeId } });
    if (!existing || existing.deletedAt) return false;
    await prisma.knowledge.update({ where: { id: knowledgeId }, data: { deletedAt: new Date() } });
    return true;
  }
}

export const adminKnowledgeService = new AdminKnowledgeService();
