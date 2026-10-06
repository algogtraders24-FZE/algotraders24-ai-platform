// services/edge-analyzer/prisma-saved-store.ts
// Prisma-backed EdgeSavedStore. Kept out of the pure modules so tests need no DB.
// Every query includes the userId: a row can never be read or deleted across users.

import { prisma } from "@/lib/prisma";
import type { EdgeReportE1 } from "./index";
import type { EdgeSavedStore, SavedAnalysisFull, SavedAnalysisRow } from "./saved";

const rowOf = (r: { id: string; createdAt: Date; tradeCount: number; level: string }): SavedAnalysisRow => ({
  id: r.id,
  createdAt: r.createdAt,
  tradeCount: r.tradeCount,
  level: r.level,
});

export const prismaEdgeSavedStore: EdgeSavedStore = {
  count: (userId) => prisma.edgeAnalysis.count({ where: { userId } }),

  async create(userId, report) {
    const r = await prisma.edgeAnalysis.create({
      data: { userId, tradeCount: report.core.tradeCount, level: report.edge.level, report: report as unknown as object },
      select: { id: true, createdAt: true, tradeCount: true, level: true },
    });
    return rowOf(r);
  },

  async list(userId) {
    const rows = await prisma.edgeAnalysis.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, tradeCount: true, level: true },
    });
    return rows.map(rowOf);
  },

  async get(userId, id): Promise<SavedAnalysisFull | null> {
    const r = id
      ? await prisma.edgeAnalysis.findFirst({ where: { id, userId } })
      : await prisma.edgeAnalysis.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    return r ? { ...rowOf(r), report: r.report as unknown as EdgeReportE1 } : null;
  },

  async delete(userId, id) {
    const res = await prisma.edgeAnalysis.deleteMany({ where: { id, userId } });
    return res.count > 0;
  },
};
