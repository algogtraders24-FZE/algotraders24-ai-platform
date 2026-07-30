// app/api/private/admin/analytics/route.ts
// Sprint L2.6 - Phase 5: AI Usage Analytics, platform-wide. Admin-only,
// read-only, real Prisma aggregates (see AdminAnalyticsService for the
// no-fabrication accounting of what is and isn't trackable today).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminAnalyticsService } from "@/services/admin/AdminAnalyticsService";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const analytics = await adminAnalyticsService.getAnalytics();
  return ApiResponse.success({ analytics }, ctx.requestId, 200, ctx.startedAt);
});
