// app/api/private/admin/knowledge-loop/candidates/route.ts
// Sprint K4.2-C Phase 1 — list KnowledgeCandidate rows for the admin queue.
// Read-only; delegates to the new, read-only admin-queries module
// (K4.2C-D2) — never touches CandidateStorePort/GovernanceStorePort.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { listCandidates } from "@/services/knowledge-loop/governance";

export const GET = withContext(async (req, ctx) => {
  const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Math.min(Number(url.searchParams.get("pageSize") ?? "20") || 20, 100);
  const status = url.searchParams.get("status") ?? undefined;

  const result = await listCandidates({ page, pageSize, status });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
