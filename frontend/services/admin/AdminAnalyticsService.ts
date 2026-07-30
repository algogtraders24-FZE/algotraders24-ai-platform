// services/admin/AdminAnalyticsService.ts
// Sprint L2.6 - Phase 5: AI Usage Analytics, platform-wide. Same
// no-fabrication principle as L2.5's EntitlementService, scoped across all
// users instead of one: every number is a real Prisma aggregate over
// tables the AI Assistant/Knowledge pipelines already write as a side
// effect of real work, with zero coupling to those pipeline files.
// Sprint L2.7 - Market Analysis Requests and Search Requests are now real,
// platform-wide totals from RequestLogService (Phase 6) - previously
// disclosed as untracked (no durable per-request record existed anywhere).
import { prisma } from "@/lib/prisma";
import { requestLogService } from "@/services/tracking/RequestLogService";

export interface DailyCount {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface TopUserRow {
  userId: string;
  email: string;
  assistantMessages: number;
}

export interface AdminAnalytics {
  totals: {
    users: number;
    conversations: number;
    assistantMessages: number;
    knowledgeDocuments: number;
    knowledgeStorageBytes: number;
    marketAnalysisRequests: number;
    searchRequests: number;
  };
  assistantMessagesByDay: DailyCount[]; // last 30 days
  topUsersByAssistantMessages: TopUserRow[];
  untracked: string[]; // metrics this app has no real record of yet
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class AdminAnalyticsService {
  async getAnalytics(): Promise<AdminAnalytics> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 29 * DAY_MS);
    windowStart.setHours(0, 0, 0, 0);

    const [users, conversations, assistantMessages, knowledgeAgg, recentMessages, marketAnalysisRequests, searchRequests] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.message.count({ where: { role: "assistant", deletedAt: null } }),
      prisma.knowledge.aggregate({
        where: { deletedAt: null },
        _count: { _all: true },
        _sum: { documentSize: true },
      }),
      prisma.message.findMany({
        where: { role: "assistant", deletedAt: null, createdAt: { gte: windowStart } },
        select: { createdAt: true, userId: true },
      }),
      requestLogService.countAll("market_analysis"),
      requestLogService.countAll("knowledge_search"),
    ]);

    const byDay = new Map<string, number>();
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(windowStart.getTime() + i * DAY_MS);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    const byUser = new Map<string, number>();
    for (const m of recentMessages) {
      const key = m.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
      byUser.set(m.userId, (byUser.get(m.userId) ?? 0) + 1);
    }

    const topEntries = [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topUserIds = topEntries.map(([userId]) => userId);
    const topUsersRaw = topUserIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: topUserIds } }, select: { id: true, email: true } })
      : [];
    const emailById = new Map(topUsersRaw.map((u) => [u.id, u.email]));

    return {
      totals: {
        users,
        conversations,
        assistantMessages,
        knowledgeDocuments: knowledgeAgg._count._all,
        knowledgeStorageBytes: knowledgeAgg._sum.documentSize ?? 0,
        marketAnalysisRequests,
        searchRequests,
      },
      assistantMessagesByDay: [...byDay.entries()].map(([date, count]) => ({ date, count })),
      topUsersByAssistantMessages: topEntries.map(([userId, count]) => ({
        userId,
        email: emailById.get(userId) ?? "unknown",
        assistantMessages: count,
      })),
      untracked: [],
    };
  }
}

export const adminAnalyticsService = new AdminAnalyticsService();
