// app/api/private/admin/knowledge-loop/knowledge/route.ts
// Sprint K4.2-C Phase 1 — list active/deprecated loop Knowledge rows.
// Distinct from the legacy app/api/private/admin/knowledge/route.ts
// (Sprint L2.6, scope=user Knowledge.status moderation — an unrelated
// surface, per K4.1 §2.8/§3.3, not extended here).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { listKnowledge } from "@/services/knowledge-loop/governance";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") ?? "20") || 20, 100);
  const lifecycleStatus = url.searchParams.get("lifecycleStatus") ?? undefined;

  const result = await listKnowledge({ page, pageSize, lifecycleStatus });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
