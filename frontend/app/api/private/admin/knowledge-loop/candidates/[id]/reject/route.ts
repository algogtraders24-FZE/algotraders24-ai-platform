// app/api/private/admin/knowledge-loop/candidates/[id]/reject/route.ts
// Sprint K4.2-C Phase 1 — the one HTTP entry point to
// GovernanceService.reject() (K4.2-B, unmodified).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { createGovernanceService } from "@/services/knowledge-loop/governance";

function candidateIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("candidates");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

const VALID_CLOSE_AS = ["rejected", "duplicate", "superseded"] as const;
type CloseAs = (typeof VALID_CLOSE_AS)[number];

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const id = candidateIdFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "candidate id must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown; closeAs?: unknown };
  if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "reason is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  const closeAs: CloseAs = VALID_CLOSE_AS.includes(body.closeAs as CloseAs) ? (body.closeAs as CloseAs) : "rejected";

  const governance = await createGovernanceService();
  const result = await governance.reject(id, gate.user.profile.id, body.reason, closeAs);

  if (result.outcome === "unauthorized") {
    return ApiResponse.error({ code: "FORBIDDEN", message: "Admin authorization required" }, ctx.requestId, 403, ctx.startedAt);
  }
  if (result.outcome === "not-found") {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Candidate not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  if (result.outcome === "wrong-status") {
    return ApiResponse.error({ code: "CONFLICT", message: "Candidate is no longer awaiting review" }, ctx.requestId, 409, ctx.startedAt);
  }

  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
