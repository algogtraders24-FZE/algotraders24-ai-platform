// services/dashboard.service.ts
// Sprint L2.3 - Replaces the previous fully-hardcoded stats/activity
// (data/dashboard.ts, now deleted - identical numbers for every user,
// regardless of their real account state). Every value here comes from a
// real Prisma query scoped to the requesting user.
//
// Honest gap, disclosed rather than worked around: there is no real
// "Total Analyses" or "Latest market analysis" here. AnalysisRunService
// (services/ai/analysis-run.service.ts) was explicitly built in Sprint
// 15D.1 as an in-memory-only reference store with "No Prisma model or
// migration exists yet" - a decision this sprint doesn't touch, since
// adding one would mean modifying the Market Intelligence pipeline, which
// this sprint is explicitly scoped to leave alone. See the L2.3 report.
import { prisma } from "@/lib/prisma";

export interface DashboardOverview {
  totalConversations: number;
  totalDocuments: number;
  totalChunks: number;
  totalRetrievals: number;
}

export type ActivityType = "conversation" | "document" | "indexing";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  text: string;
  /** ISO timestamp - real, from the row's own lastMessageAt/createdAt/lastIndexed. */
  timestamp: string;
}

export const dashboardService = {
  async getOverview(userId: string): Promise<DashboardOverview> {
    const [totalConversations, totalDocuments, totalChunks, retrievalAgg] = await Promise.all([
      prisma.conversation.count({ where: { userId, deletedAt: null } }),
      prisma.knowledge.count({ where: { userId, deletedAt: null } }),
      prisma.knowledgeChunk.count({ where: { userId, deletedAt: null } }),
      prisma.knowledge.aggregate({
        where: { userId, deletedAt: null },
        _sum: { retrievalCount: true },
      }),
    ]);

    return {
      totalConversations,
      totalDocuments,
      totalChunks,
      totalRetrievals: retrievalAgg._sum.retrievalCount ?? 0,
    };
  },

  async getRecentActivity(userId: string): Promise<ActivityItem[]> {
    const [conversation, document, indexed] = await Promise.all([
      prisma.conversation.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, title: true, lastMessageAt: true },
      }),
      prisma.knowledge.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.knowledge.findFirst({
        where: { userId, deletedAt: null, lastIndexed: { not: null } },
        orderBy: { lastIndexed: "desc" },
        select: { id: true, title: true, lastIndexed: true },
      }),
    ]);

    const items: ActivityItem[] = [];
    if (conversation) {
      items.push({
        id: `conv-${conversation.id}`,
        type: "conversation",
        text: `Conversation: "${conversation.title}"`,
        timestamp: conversation.lastMessageAt.toISOString(),
      });
    }
    if (document) {
      items.push({
        id: `doc-${document.id}`,
        type: "document",
        text: `Uploaded "${document.title}"`,
        timestamp: document.createdAt.toISOString(),
      });
    }
    if (indexed?.lastIndexed) {
      items.push({
        id: `idx-${indexed.id}`,
        type: "indexing",
        text: `Indexed "${indexed.title}"`,
        timestamp: indexed.lastIndexed.toISOString(),
      });
    }

    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },
};
