// app/api/private/billing/usage/route.ts
// Sprint L2.5 - Real, DB-backed usage + entitlements for the authenticated
// user (Phase 2/3/4). Period bounds come from the user's real Subscription
// row when one exists; a user with no row yet (free tier, never
// subscribed) is metered against the current calendar month so "usage
// this period" is still a meaningful, real window rather than all-time.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/services/billing/EntitlementService";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt
    );
  }

  const userId = sessionUser.profile.id;
  const sub = await prisma.subscription.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  let periodStart: Date;
  let periodEnd: Date;
  if (sub) {
    periodStart = sub.currentPeriodStart;
    periodEnd = sub.currentPeriodEnd;
  } else {
    const now = new Date();
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const planId = sub?.planId ?? sessionUser.profile.planId;
  const entitlements = await entitlementService.getEntitlements(userId, planId, periodStart, periodEnd);

  return ApiResponse.success({ entitlements }, ctx.requestId, 200, ctx.startedAt);
});
