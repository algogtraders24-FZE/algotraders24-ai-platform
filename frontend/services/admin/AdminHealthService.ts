// services/admin/AdminHealthService.ts
// Sprint L2.6 - Phase 6: System Health Dashboard.
// Sprint L2.7 - Phase 5: now delegates the 6 real subsystem checks
// (database, aiProvider, vectorStore, paymentProvider, storage,
// backgroundJobs) to the shared services/backend/HealthService.ts rather
// than re-implementing them here - that file was rewritten in L2.7 to
// replace its own fabricated statuses with real checks, so reusing it
// satisfies this sprint's "prefer extending existing services instead of
// creating parallel systems" rule and keeps exactly one place that decides
// what "healthy" means for each subsystem. Row counts and Alpha Vantage
// key presence remain admin-specific extras layered on top.
import { prisma } from "@/lib/prisma";
import { resolveRepositoryMode } from "@/config/repository.config";
import { healthService } from "@/services/backend/HealthService";
import type { SystemStatusReport } from "@/types/backend";

export interface AdminHealthReport {
  subsystems: SystemStatusReport;
  repositoryMode: "mock" | "prisma";
  alphaVantageConfigured: boolean;
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
    const [subsystems, users, conversations, messages, knowledge, subscriptions, agents, auditLogs] = await Promise.all([
      healthService.getSystemStatusAsync(),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.message.count({ where: { deletedAt: null } }),
      prisma.knowledge.count({ where: { deletedAt: null } }),
      prisma.subscription.count({ where: { deletedAt: null } }),
      prisma.agent.count({ where: { deletedAt: null } }),
      prisma.auditLog.count(),
    ]);

    return {
      subsystems,
      repositoryMode: resolveRepositoryMode(),
      alphaVantageConfigured: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      rowCounts: { users, conversations, messages, knowledge, subscriptions, agents, auditLogs },
      checkedAt: new Date().toISOString(),
    };
  }
}

export const adminHealthService = new AdminHealthService();
