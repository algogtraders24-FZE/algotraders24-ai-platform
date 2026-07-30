// app/api/private/admin/audit-logs/route.ts
// Sprint L2.6 - Phase 7: real, paginated, filterable audit log list.
// Admin-only, read-only (see AuditLogService - append-only by design).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { auditLogService } from "@/services/admin/AuditLogService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;
  const action = url.searchParams.get("action") ?? undefined;
  const actorUserId = url.searchParams.get("actorUserId") ?? undefined;

  const result = await auditLogService.list({ page, pageSize, action, actorUserId });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
