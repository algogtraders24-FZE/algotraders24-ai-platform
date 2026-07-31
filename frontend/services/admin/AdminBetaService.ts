// services/admin/AdminBetaService.ts
// Sprint R1.2 - Phase 3 (User Journey) + Phase 4 (Beta Dashboard). Every
// number here comes from a real query - no synthesized/placeholder metric.
//
// Funnel stages deliberately use the most complete real source available
// for each one, not the new AnalyticsEvent table uniformly:
//  - Account Created / Email Verified come from the User table itself
//    (complete history, unaffected by when this sprint shipped).
//  - First Conversation / First Upload come from the existing Conversation/
//    Knowledge tables (also complete history).
//  - First Login / First Analysis have no other durable record (AnalysisRun
//    is in-memory only - the same disclosed gap dashboard.service.ts notes)
//    so they're read from AnalyticsEvent, which only has data from the
//    moment this sprint shipped forward. This is disclosed in the UI, never
//    hidden.
import { prisma } from "@/lib/prisma";
import { analyticsEventService, type AnalyticsEventType } from "@/services/analytics/AnalyticsEventService";

const ACTIVE_WINDOW_DAYS = 7;

export interface FunnelStage {
  key: "account_created" | "email_verified" | "first_login" | "first_conversation" | "first_upload" | "first_analysis";
  label: string;
  count: number;
  percentOfTotal: number;
  trackedFrom: "all_time" | "this_sprint_forward";
}

export interface BetaOverview {
  totalUsers: number;
  activeBetaUsers: { count: number; windowDays: number };
  completedOnboarding: { count: number; percentOfTotal: number; definition: string };
  mostUsedFeatures: { type: AnalyticsEventType; label: string; count: number }[];
  feedback: { total: number; open: number; reviewed: number; resolved: number };
  dropOff: FunnelStage[];
}

export interface JourneyEvent {
  key: string;
  label: string;
  occurredAt: string | null;
  note?: string;
}

const FEATURE_LABELS: Record<AnalyticsEventType, string> = {
  login: "Login",
  email_verified: "Email Verified",
  ai_chat: "AI Assistant Chat",
  knowledge_upload: "Knowledge Upload",
  market_analysis: "Market Analysis",
  subscription_click: "Subscription Click",
  product_view: "Product View",
};

function pct(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export class AdminBetaService {
  async getOverview(): Promise<BetaOverview> {
    const [
      totalUsers,
      emailVerifiedCount,
      firstLoginCount,
      firstConversationCount,
      firstUploadCount,
      firstAnalysisCount,
      activeCount,
      eventCounts,
      feedbackSummary,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, emailVerified: true } }),
      analyticsEventService.distinctUserCount("login"),
      prisma.conversation
        .findMany({ where: { deletedAt: null }, distinct: ["userId"], select: { userId: true } })
        .then((r) => r.length),
      prisma.knowledge
        .findMany({ where: { deletedAt: null }, distinct: ["userId"], select: { userId: true } })
        .then((r) => r.length),
      analyticsEventService.distinctUserCount("market_analysis"),
      analyticsEventService.distinctActiveUserCount(ACTIVE_WINDOW_DAYS),
      analyticsEventService.countsByType(),
      prisma.feedback.findMany({ where: { deletedAt: null }, select: { status: true } }),
    ]);

    // Completed onboarding: used at least one of the three core modules -
    // a real, disclosed definition (not "did every step"), matching R1.1's
    // own "isNewUser" heuristic in spirit.
    const usedAtLeastOneModule = await prisma.analyticsEvent
      .findMany({
        where: { type: { in: ["ai_chat", "knowledge_upload", "market_analysis"] }, userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      })
      .then((r) => r.length);

    const feedbackByStatus = { open: 0, reviewed: 0, resolved: 0 };
    for (const f of feedbackSummary) {
      if (f.status === "open" || f.status === "reviewed" || f.status === "resolved") feedbackByStatus[f.status] += 1;
    }

    const mostUsedFeatures = (Object.entries(eventCounts) as [AnalyticsEventType, number][])
      .filter(([type]) => type in FEATURE_LABELS)
      .map(([type, count]) => ({ type, label: FEATURE_LABELS[type], count }))
      .sort((a, b) => b.count - a.count);

    const dropOff: FunnelStage[] = [
      { key: "account_created", label: "Account Created", count: totalUsers, percentOfTotal: pct(totalUsers, totalUsers), trackedFrom: "all_time" },
      { key: "email_verified", label: "Email Verified", count: emailVerifiedCount, percentOfTotal: pct(emailVerifiedCount, totalUsers), trackedFrom: "all_time" },
      { key: "first_login", label: "First Login", count: firstLoginCount, percentOfTotal: pct(firstLoginCount, totalUsers), trackedFrom: "this_sprint_forward" },
      { key: "first_conversation", label: "First Conversation", count: firstConversationCount, percentOfTotal: pct(firstConversationCount, totalUsers), trackedFrom: "all_time" },
      { key: "first_upload", label: "First Upload", count: firstUploadCount, percentOfTotal: pct(firstUploadCount, totalUsers), trackedFrom: "all_time" },
      { key: "first_analysis", label: "First Analysis", count: firstAnalysisCount, percentOfTotal: pct(firstAnalysisCount, totalUsers), trackedFrom: "this_sprint_forward" },
    ];

    return {
      totalUsers,
      activeBetaUsers: { count: activeCount, windowDays: ACTIVE_WINDOW_DAYS },
      completedOnboarding: {
        count: usedAtLeastOneModule,
        percentOfTotal: pct(usedAtLeastOneModule, totalUsers),
        definition: "Used at least one of AI Assistant, Knowledge Upload, or Market Analysis.",
      },
      mostUsedFeatures,
      feedback: { total: feedbackSummary.length, ...feedbackByStatus },
      dropOff,
    };
  }

  async getUserJourney(userId: string): Promise<JourneyEvent[] | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, emailVerified: true, deletedAt: true } });
    if (!user || user.deletedAt) return null;

    const [emailVerifiedAt, firstLoginAt, firstConversation, firstUpload, firstAnalysisAt] = await Promise.all([
      analyticsEventService.firstEventAt(userId, "email_verified"),
      analyticsEventService.firstEventAt(userId, "login"),
      prisma.conversation.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.knowledge.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      analyticsEventService.firstEventAt(userId, "market_analysis"),
    ]);

    return [
      { key: "account_created", label: "Account Created", occurredAt: user.createdAt.toISOString() },
      {
        key: "email_verified",
        label: "Email Verified",
        occurredAt: emailVerifiedAt,
        note: !emailVerifiedAt && user.emailVerified ? "Verified before analytics tracking began - exact time unknown." : !user.emailVerified ? "Not yet verified." : undefined,
      },
      { key: "first_login", label: "First Login", occurredAt: firstLoginAt, note: !firstLoginAt ? "Not yet recorded." : undefined },
      { key: "first_conversation", label: "First Conversation", occurredAt: firstConversation?.createdAt.toISOString() ?? null, note: !firstConversation ? "Not yet reached." : undefined },
      { key: "first_upload", label: "First Upload", occurredAt: firstUpload?.createdAt.toISOString() ?? null, note: !firstUpload ? "Not yet reached." : undefined },
      { key: "first_analysis", label: "First Analysis", occurredAt: firstAnalysisAt, note: !firstAnalysisAt ? "Not yet reached." : undefined },
    ];
  }
}

export const adminBetaService = new AdminBetaService();
