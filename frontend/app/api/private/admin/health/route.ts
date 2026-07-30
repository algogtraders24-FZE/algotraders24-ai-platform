// app/api/private/admin/health/route.ts
// Sprint L2.6 - Phase 6: System Health Dashboard. Admin-only, real checks
// only (see AdminHealthService).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminHealthService } from "@/services/admin/AdminHealthService";

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const report = await adminHealthService.getReport();
  return ApiResponse.success({ report }, ctx.requestId, 200, ctx.startedAt);
});
