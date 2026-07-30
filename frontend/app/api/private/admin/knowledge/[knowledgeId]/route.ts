// app/api/private/admin/knowledge/[knowledgeId]/route.ts
// Sprint L2.6 - Phase 4: the only moderation action offered - a real,
// audit-logged soft delete. Admin-only.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminKnowledgeService } from "@/services/admin/AdminKnowledgeService";
import { auditLogService } from "@/services/admin/AuditLogService";

function knowledgeIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("knowledge");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const DELETE = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const knowledgeId = knowledgeIdFromPath(ctx.path);
  if (!knowledgeId) {
    return ApiResponse.error({ code: "VALIDATION", message: "knowledgeId must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const deleted = await adminKnowledgeService.softDeleteKnowledge(knowledgeId);
  if (!deleted) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Knowledge document not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  await auditLogService.record({
    actorUserId: gate.user.profile.id,
    action: "knowledge.deleted",
    targetType: "Knowledge",
    targetId: knowledgeId,
  });

  return ApiResponse.success({ knowledgeId, deleted: true }, ctx.requestId, 200, ctx.startedAt);
});
