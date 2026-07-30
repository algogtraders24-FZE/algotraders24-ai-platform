// services/tracking/RequestLogService.ts
// Sprint L2.7 - Phase 6: real, durable request tracking for the two
// metrics L2.5/L2.6 disclosed as "not yet tracked". Backed by the new
// RequestLog Prisma model (append-only, no update/delete path - a pure
// event log). Written by a single additive, best-effort call at the end of
// the market-intelligence analyze route and the knowledge search route -
// this service itself has zero imports from either pipeline, and neither
// route's core logic is touched beyond that one line.
import { prisma } from "@/lib/prisma";

export type RequestLogType = "market_analysis" | "knowledge_search";

export class RequestLogService {
  async record(userId: string, type: RequestLogType): Promise<void> {
    await prisma.requestLog.create({ data: { userId, type } });
  }

  async countForUser(userId: string, type: RequestLogType, periodStart: Date, periodEnd: Date): Promise<number> {
    return prisma.requestLog.count({
      where: { userId, type, createdAt: { gte: periodStart, lte: periodEnd } },
    });
  }

  async countAll(type: RequestLogType, periodStart?: Date, periodEnd?: Date): Promise<number> {
    return prisma.requestLog.count({
      where: {
        type,
        ...(periodStart && periodEnd ? { createdAt: { gte: periodStart, lte: periodEnd } } : {}),
      },
    });
  }
}

export const requestLogService = new RequestLogService();
