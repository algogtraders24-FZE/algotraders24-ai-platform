// app/api/private/agents/framework/runs/[id]/advance/route.ts
// AT24 Agent Framework - A15. Drive ONE bounded slice of a run.
//
//   POST -> if the run is the caller's and not terminal, execute exactly
//           one agentRuntime.tick() (one persisted checkpoint), then return
//           the updated observability model. If already terminal, a no-op
//           that just returns the model.
//
// This is how a run makes progress: the client loops POST advance / GET
// until { terminal: true }. Each request does a strictly bounded amount of
// work - no request runs the whole agent (owner G14 lock 7). Ownership is
// enforced via getRunForUser inside advanceAgentRun.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { advanceAgentRun } from "@/services/agent-framework/api/agent-run-service";

function runIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("runs");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const id = runIdFromPath(ctx.path);
  if (!id) throw Errors.validation("run id is required");

  const result = await advanceAgentRun(sessionUser.profile.id, id);
  if (!result) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Agent run not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success(
    { run: result.observability, terminal: result.terminal, advanced: result.advanced },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
