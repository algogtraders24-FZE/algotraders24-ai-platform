// app/api/private/admin/knowledge-loop/candidates/[id]/approve/route.ts
// Sprint K4.2-C Phase 1 — the one HTTP entry point to
// GovernanceService.approve() (K4.2-B, unmodified). requireAdmin gates
// first; the admin's own verified session id is what's passed as adminId —
// GovernanceService independently re-verifies it against User.role too
// (K4.2B-D2, defense-in-depth) — never trusted from the request body.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { createGovernanceService } from "@/services/knowledge-loop/governance";
import type { ApproveOptions } from "@/types/knowledge-loop";

function candidateIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("candidates");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

interface ApproveBody {
  editedAnswer?: unknown;
  knowledgeType?: unknown;
  scope?: unknown;
  visibility?: unknown;
  freshnessClass?: unknown;
  freshnessReviewEveryDays?: unknown;
  expiresAt?: unknown;
  reviewerNotes?: unknown;
  deprecateRelatedIds?: unknown;
}

export const POST = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const id = candidateIdFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "candidate id must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const body = (await req.json().catch(() => ({}))) as ApproveBody;
  const opts: ApproveOptions = {
    ...(typeof body.editedAnswer === "string" ? { editedAnswer: body.editedAnswer } : {}),
    ...(typeof body.knowledgeType === "string" ? { knowledgeType: body.knowledgeType as ApproveOptions["knowledgeType"] } : {}),
    ...(typeof body.scope === "string" ? { scope: body.scope as ApproveOptions["scope"] } : {}),
    ...(typeof body.visibility === "string" ? { visibility: body.visibility as ApproveOptions["visibility"] } : {}),
    ...(typeof body.freshnessClass === "string" ? { freshnessClass: body.freshnessClass as ApproveOptions["freshnessClass"] } : {}),
    ...(typeof body.freshnessReviewEveryDays === "number" ? { freshnessReviewEveryDays: body.freshnessReviewEveryDays } : {}),
    ...(typeof body.expiresAt === "string" ? { expiresAt: new Date(body.expiresAt) } : {}),
    ...(typeof body.reviewerNotes === "string" ? { reviewerNotes: body.reviewerNotes } : {}),
    ...(Array.isArray(body.deprecateRelatedIds) ? { deprecateRelatedIds: body.deprecateRelatedIds.filter((v): v is string => typeof v === "string") } : {}),
  };

  const governance = await createGovernanceService();
  const result = await governance.approve(id, gate.user.profile.id, opts);

  if (result.outcome === "unauthorized") {
    return ApiResponse.error({ code: "FORBIDDEN", message: "Admin authorization required" }, ctx.requestId, 403, ctx.startedAt);
  }
  if (result.outcome === "not-found") {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Candidate not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  if (result.outcome === "wrong-status") {
    return ApiResponse.error({ code: "CONFLICT", message: "Candidate is no longer awaiting review" }, ctx.requestId, 409, ctx.startedAt);
  }
  if (result.outcome === "blocked-privacy") {
    return ApiResponse.error(
      { code: "VALIDATION", message: "Approval blocked by the privacy re-scan", details: { blockedReasons: result.blockedReasons } },
      ctx.requestId,
      422,
      ctx.startedAt,
    );
  }

  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
