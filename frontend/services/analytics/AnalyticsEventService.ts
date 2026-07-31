// services/analytics/AnalyticsEventService.ts
// Sprint R1.2 - Phase 2: internal beta analytics (explicitly not a
// third-party integration). Backed by the AnalyticsEvent Prisma model
// (append-only, no update/delete path). record() is called as a single
// additive, best-effort line from the real action it observes (sign-in,
// the callback route, chat/upload/analyze routes, or a small client-side
// tracker for subscription_click/product_view) - this service has zero
// imports from any pipeline it instruments, and never invents an event
// that didn't really happen.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

export type AnalyticsEventType =
  | "login"
  | "email_verified"
  | "ai_chat"
  | "knowledge_upload"
  | "market_analysis"
  | "subscription_click"
  | "product_view";

// Event types a client may report about itself directly (no server-side
// action to hang the call off of). Every other type is only ever recorded
// from a session-authenticated server code path - never from a client-
// supplied body - so a user can't fabricate their own "first login".
export const CLIENT_REPORTABLE_EVENT_TYPES: readonly AnalyticsEventType[] = [
  "subscription_click",
  "product_view",
];

export interface JourneyMilestone {
  type: AnalyticsEventType;
  firstAt: string;
}

export class AnalyticsEventService {
  async record(userId: string | null, type: AnalyticsEventType, metadata?: Record<string, unknown>): Promise<void> {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        type,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // Earliest occurrence of `type` for `userId`, or null if it hasn't happened
  // (yet, or wasn't tracked before this event type existed - never guessed).
  async firstEventAt(userId: string, type: AnalyticsEventType): Promise<string | null> {
    const row = await prisma.analyticsEvent.findFirst({
      where: { userId, type },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return row ? row.createdAt.toISOString() : null;
  }

  // Distinct users who have ever fired `type` - the real basis for funnel
  // stages that have no other durable record (see AdminBetaService).
  async distinctUserCount(type: AnalyticsEventType): Promise<number> {
    const rows = await prisma.analyticsEvent.findMany({
      where: { type, userId: { not: null } },
      distinct: ["userId"],
      select: { userId: true },
    });
    return rows.length;
  }

  // Users with at least one `login` event within the trailing window -
  // the real basis for "Active Beta Users".
  async distinctActiveUserCount(sinceDays: number): Promise<number> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await prisma.analyticsEvent.findMany({
      where: { type: "login", userId: { not: null }, createdAt: { gte: since } },
      distinct: ["userId"],
      select: { userId: true },
    });
    return rows.length;
  }

  // Raw counts per type, for "Most Used Features".
  async countsByType(): Promise<Record<string, number>> {
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["type"],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.type, r._count._all]));
  }
}

export const analyticsEventService = new AnalyticsEventService();
