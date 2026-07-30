// services/billing/UsageMeteringService.ts
// Sprint L2.5 - Real usage metering. Every number here is a live Prisma
// aggregate over data other, already-shipped pipelines wrote as a natural
// side effect of doing their real work (Message from the AI Assistant,
// Knowledge from the ingestion pipeline, Conversation from the chat
// history) - this file adds zero writes and zero coupling to those
// pipelines, only read-only aggregation, so it never touches the AI
// Assistant / Knowledge / Market Intelligence code this sprint is
// forbidden from modifying.
//
// Two requested metrics - Market Analysis Requests and Search Requests -
// have no durable, per-request record anywhere in the schema today
// (AnalysisRun is an in-memory-only reference store, per
// services/ai/analysis-run.service.ts, and knowledge search never persists
// a per-query event). Instrumenting either would mean editing the Market
// Intelligence or Knowledge route files, which this sprint's rules
// explicitly forbid. Rather than fabricate a number, EntitlementService
// reports both as `tracked: false` - see the L2.5 report for the honest
// account of this gap and the recommended follow-up.
import { prisma } from "@/lib/prisma";

export interface RealUsage {
  periodStart: string;
  periodEnd: string;
  aiMessages: number; // assistant-role messages sent within the period
  knowledgeDocuments: number; // current total, not period-scoped (a storage ceiling, not a monthly rate)
  storageBytes: number; // current total, not period-scoped
  conversations: number; // current total
}

export class UsageMeteringService {
  async getUsage(userId: string, periodStart: Date, periodEnd: Date): Promise<RealUsage> {
    const [aiMessages, knowledgeDocuments, storageAgg, conversations] = await Promise.all([
      prisma.message.count({
        where: {
          userId,
          role: "assistant",
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.knowledge.count({ where: { userId, deletedAt: null } }),
      prisma.knowledge.aggregate({
        where: { userId, deletedAt: null },
        _sum: { documentSize: true },
      }),
      prisma.conversation.count({ where: { userId, deletedAt: null } }),
    ]);

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      aiMessages,
      knowledgeDocuments,
      storageBytes: storageAgg._sum.documentSize ?? 0,
      conversations,
    };
  }
}

export const usageMeteringService = new UsageMeteringService();
