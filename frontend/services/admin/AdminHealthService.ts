// services/admin/AdminHealthService.ts
// Sprint L2.6 - Phase 6: System Health Dashboard. Deliberately a new,
// self-contained service rather than an edit to services/backend/HealthService.ts
// (which app/api/health and app/api/system/status already depend on) - this
// sprint's job is an honest admin-facing report, not a rewrite of existing
// shared infra. Every field here is either a real, live check (database
// reachability) or a real, disclosed fact (an env var is/isn't set; a row
// count), never a fabricated "operational" label for something that was
// never actually probed - the L2.6 audit found /api/system/status already
// does this for 5 of 6 subsystems, and that gap is deliberately not
// repeated here.
import { prisma } from "@/lib/prisma";
import { isDatabaseReachable } from "@/lib/db-health";
import { resolveRepositoryMode } from "@/config/repository.config";

export interface AdminHealthReport {
  database: { reachable: boolean; repositoryMode: "mock" | "prisma" };
  providers: {
    geminiConfigured: boolean;
    alphaVantageConfigured: boolean;
  };
  rowCounts: {
    users: number;
    conversations: number;
    messages: number;
    knowledge: number;
    subscriptions: number;
    agents: number;
    auditLogs: number;
  };
  checkedAt: string;
}

export class AdminHealthService {
  async getReport(): Promise<AdminHealthReport> {
    const [
      reachable,
      users,
      conversations,
      messages,
      knowledge,
      subscriptions,
      agents,
      auditLogs,
    ] = await Promise.all([
      isDatabaseReachable(),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.message.count({ where: { deletedAt: null } }),
      prisma.knowledge.count({ where: { deletedAt: null } }),
      prisma.subscription.count({ where: { deletedAt: null } }),
      prisma.agent.count({ where: { deletedAt: null } }),
      prisma.auditLog.count(),
    ]);

    return {
      database: { reachable, repositoryMode: resolveRepositoryMode() },
      providers: {
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      },
      rowCounts: { users, conversations, messages, knowledge, subscriptions, agents, auditLogs },
      checkedAt: new Date().toISOString(),
    };
  }
}

export const adminHealthService = new AdminHealthService();
