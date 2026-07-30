// app/api/private/admin/knowledge/route.ts
// Sprint L2.6 - Phase 4: Knowledge Administration. Real, paginated list of
// Knowledge documents across ALL users plus real aggregate stats.
// Admin-only. Read-only - never calls IngestionService or any Knowledge
// pipeline route.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { adminKnowledgeService } from "@/services/admin/AdminKnowledgeService";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20") || 20;

  const [list, stats] = await Promise.all([
    adminKnowledgeService.listKnowledge({ page, pageSize }),
    adminKnowledgeService.getStats(),
  ]);

  return ApiResponse.success({ ...list, stats }, ctx.requestId, 200, ctx.startedAt);
});
