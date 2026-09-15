// app/api/private/admin/knowledge-loop/candidates/[id]/route.ts
// Sprint K4.2-C Phase 1 — one candidate's detail for the admin review view.
// withContext's RouteHandler doesn't thread Next's dynamic `params` through
// (services/backend/Middleware.ts, untouched) — the id is read from the
// already-parsed request path, same technique as
// app/api/private/admin/users/[userId]/route.ts.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { getCandidateDetail } from "@/services/knowledge-loop/governance";

function candidateIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("candidates");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const id = candidateIdFromPath(ctx.path);
  if (!id) {
    return ApiResponse.error({ code: "VALIDATION", message: "candidate id must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
  }

  const candidate = await getCandidateDetail(id);
  if (!candidate) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Candidate not found" }, ctx.requestId, 404, ctx.startedAt);
  }

  return ApiResponse.success({ candidate }, ctx.requestId, 200, ctx.startedAt);
});
