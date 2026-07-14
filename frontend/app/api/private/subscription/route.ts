// app/api/private/subscription/route.ts
// Sprint 14E - Active subscription for the authenticated user.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";

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

  const row = await prisma.subscription.findFirst({
    where: { userId: sessionUser.profile.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const subscription = row
    ? {
        id: row.id,
        userId: row.userId,
        planId: row.planId,
        status: row.status,
        currentPeriodStart: row.currentPeriodStart.toISOString(),
        currentPeriodEnd: row.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;

  return ApiResponse.success(
    { subscription, planId: sessionUser.profile.planId },
    ctx.requestId,
    200,
    ctx.startedAt
  );
});