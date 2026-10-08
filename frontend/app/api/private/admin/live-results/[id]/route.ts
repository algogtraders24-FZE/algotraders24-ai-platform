// app/api/private/admin/live-results/[id]/route.ts
// Admin moderation of one Live Results page. Every action is written to the audit log.
//   PATCH  {action:"make_private"}  take the page down (owner's settings are kept)
//   DELETE                          delete the page
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { auditLogService } from "@/services/admin/AuditLogService";
import { adminDelete, adminMakePrivate } from "@/services/live-results/prisma-store";

export const dynamic = "force-dynamic";

function idFromPath(reqPath: string): string | undefined {
  const segments = reqPath.split("/").filter(Boolean);
  const idx = segments.indexOf("live-results");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const PATCH = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = idFromPath(ctx.path);
  if (!id) return ApiResponse.error({ code: "VALIDATION", message: "page id is required" }, ctx.requestId, 400, ctx.startedAt);
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "make_private") return ApiResponse.error({ code: "VALIDATION", message: 'action must be "make_private"' }, ctx.requestId, 400, ctx.startedAt);
  try {
    const before = await adminMakePrivate(id);
    if (before === null) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
    await auditLogService.record({ actorUserId: gate.user.profile.id, action: "live_results.page_made_private", targetType: "LiveResultsPage", targetId: id, metadata: { before, after: "private" } });
    return ApiResponse.success({ ok: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});

export const DELETE = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;
  const id = idFromPath(ctx.path);
  if (!id) return ApiResponse.error({ code: "VALIDATION", message: "page id is required" }, ctx.requestId, 400, ctx.startedAt);
  try {
    if (!(await adminDelete(id))) return ApiResponse.error({ code: "NOT_FOUND", message: "Page not found" }, ctx.requestId, 404, ctx.startedAt);
    await auditLogService.record({ actorUserId: gate.user.profile.id, action: "live_results.page_deleted", targetType: "LiveResultsPage", targetId: id });
    return ApiResponse.success({ deleted: true }, ctx.requestId, 200, ctx.startedAt);
  } catch {
    return ApiResponse.error({ code: "UNAVAILABLE", message: "Live Results is not available yet." }, ctx.requestId, 503, ctx.startedAt);
  }
});
