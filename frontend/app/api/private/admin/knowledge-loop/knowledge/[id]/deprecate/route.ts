// app/api/private/admin/knowledge-loop/knowledge/[id]/deprecate/route.ts
// Sprint K4.2-C Phase 1 — the one HTTP entry point to
// GovernanceService.deprecate() (K4.2-B, unmodified).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { createGovernanceService } from "@/services/knowledge-loop/governance";

function knowledgeIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("knowledge");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const id = knowledgeIdFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "knowledge id must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  const governance = await createGovernanceService();
  const result = await governance.deprecate(id, gate.user.profile.id, reason);

  if (result.outcome === "unauthorized") {
    return ApiResponse.error({ code: "FORBIDDEN", message: "Admin authorization required" }, ctx.requestId, 403, ctx.startedAt);
  }
  if (result.outcome === "not-found") {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Knowledge row not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  if (result.outcome === "wrong-status") {
    return ApiResponse.error({ code: "CONFLICT", message: "Knowledge row is not active" }, ctx.requestId, 409, ctx.startedAt);
  }

  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
