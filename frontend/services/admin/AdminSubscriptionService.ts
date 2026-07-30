// services/admin/AdminSubscriptionService.ts
// Sprint L2.6 - Phase 3: Subscription Management (admin view). Deliberately
// independent of services/billing/* (the L2.5 user-facing billing module) -
// this file is never imported by, and never imports, anything under
// services/billing/ or app/dashboard/billing/, per this sprint's "No
// Billing changes" rule. It only reads the shared PlanId type and the
// shared plan-limits config (product configuration, not billing logic).
//
// Unlike the self-service SubscriptionActionService (L2.5), which blocks
// any change to a plan priced above $0 because no payment provider is
// connected, an ADMIN override is a real, legitimate administrative action
// (e.g. comping a plan after an offline/manual payment) - it is never
// disguised as a real charge; every override is audit-logged so the
// non-standard grant is always traceable to the admin who made it.
import { prisma } from "@/lib/prisma";
import { isPlanId } from "@/config/plan-limits";
import type { PlanId } from "@/types/billing";

export class InvalidPlanError extends Error {
  constructor(planId: string) {
    super(`Unknown plan: ${planId}`);
    this.name = "InvalidPlanError";
  }
}

export interface AdminSubscriptionRow {
  userId: string;
  userEmail: string;
  userName: string;
  subscriptionId: string | null;
  planId: string;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AdminSubscriptionPage {
  items: AdminSubscriptionRow[];
  total: number;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export class AdminSubscriptionService {
  // Real join done manually (User<->Subscription<->Plan have no FK
  // relations in this schema - see the L2.2/L2.5 audits), never fabricated.
  async listSubscriptions(params: { page: number; pageSize: number }): Promise<AdminSubscriptionPage> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));

    const [users, total, plans] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.plan.findMany({ where: { deletedAt: null } }),
    ]);

    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    const userIds = users.map((u) => u.id);
    const subs = await prisma.subscription.findMany({
      where: { userId: { in: userIds }, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const subByUser = new Map<string, (typeof subs)[number]>();
    for (const s of subs) {
      if (!subByUser.has(s.userId)) subByUser.set(s.userId, s); // most recent first
    }

    const items: AdminSubscriptionRow[] = users.map((u) => {
      const sub = subByUser.get(u.id) ?? null;
      const planId = sub?.planId ?? u.planId;
      return {
        userId: u.id,
        userEmail: u.email,
        userName: u.name,
        subscriptionId: sub?.id ?? null,
        planId,
        planName: planNameById.get(planId) ?? planId,
        status: sub?.status ?? "active",
        currentPeriodStart: sub?.currentPeriodStart.toISOString() ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd.toISOString() ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      };
    });

    return { items, total };
  }

  private async findActive(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async setCancelAtPeriodEnd(userId: string, cancelAtPeriodEnd: boolean) {
    const existing = await this.findActive(userId);
    if (!existing) return null;
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { cancelAtPeriodEnd },
    });
  }

  // Admin override: unlike the user-facing flow, ANY plan (including paid
  // ones) can be granted here. Never silently invoked from anywhere but an
  // explicit, audit-logged admin action.
  async overridePlan(userId: string, targetPlanId: string) {
    if (!isPlanId(targetPlanId)) throw new InvalidPlanError(targetPlanId);
    const plan = await prisma.plan.findUnique({ where: { id: targetPlanId } });
    if (!plan) throw new InvalidPlanError(targetPlanId);

    const existing = await this.findActive(userId);
    const now = new Date();
    const periodEnd = addMonths(now, 1);
    const planId: PlanId = targetPlanId;

    const subscription = existing
      ? await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planId,
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        })
      : await prisma.subscription.create({
          data: { userId, planId, status: "active", currentPeriodStart: now, currentPeriodEnd: periodEnd },
        });

    await prisma.user.update({ where: { id: userId }, data: { planId } });
    return subscription;
  }
}

export const adminSubscriptionService = new AdminSubscriptionService();
