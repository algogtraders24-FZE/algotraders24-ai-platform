// app/api/private/chart/analyze-quota/route.ts
//   GET  -> where the signed-in user stands for Analyze (free period, today's count); uses nothing up
//   POST -> uses one Analyze run; { allowed:false, reason } tells the chart to show the upgrade note instead of running
// Rules: lib/access/chart-quota.ts (30 free days, 10 a day, then a paid plan).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { chartQuotaService } from "@/services/chart/chart-quota.service";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const d = await chartQuotaService.status(user.profile.id, user.profile.role, "chart_analyze");
  return ApiResponse.success(d, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const d = await chartQuotaService.consume(user.profile.id, user.profile.role, "chart_analyze");
  return ApiResponse.success(d, ctx.requestId, 200, ctx.startedAt);
});
