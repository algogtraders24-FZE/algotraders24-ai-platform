// app/api/private/agents/framework/runs/[id]/route.ts
// AT24 Agent Framework - A15. GET one framework run's full observability
// model (Run -> Steps -> ToolCalls -> Evidence -> Output -> Integrity ->
// Evaluation -> Credits -> timeline), scoped to the authenticated user.
//
// getAgentRun delegates to getRunObservability(runId, { requesterId }) -
// a run that does not belong to the caller returns the SAME 404 as a
// nonexistent one (never leaks existence). Pure read - no execution.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { getAgentRun } from "@/services/agent-framework/api/agent-run-service";

function runIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("runs");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = runIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");

  const observability = await getAgentRun(sessionUser.profile.id, id);
  if (!observability) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Agent run not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ run: observability }, ctx.requestId, 200, ctx.startedAt);
});
