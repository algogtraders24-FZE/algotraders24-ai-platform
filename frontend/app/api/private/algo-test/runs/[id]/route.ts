// app/api/private/algo-test/runs/[id]/route.ts
// P3.2B - fetch one Algo Test run, scoped to the authenticated user
// (algoTestService.getAlgoTestRun's own prisma query filters by userId,
// never trusts the path param alone - a run belonging to another user
// returns the same 404 as a nonexistent one, never leaking existence).
// withContext's RouteHandler has no `params` argument, so the id is parsed
// from ctx.path - the same convention every other dynamic private route in
// this codebase uses (see app/api/private/paper-trading/positions/[id]/close/route.ts).
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { algoTestService } from "@/services/algo-test/algo-test.service";

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
  if (!id) throw Errors.validation("test run id is required");

  const run = await algoTestService.getAlgoTestRun(sessionUser.profile.id, id);
  if (!run) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Algo Test run not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ run }, ctx.requestId, 200, ctx.startedAt);
});
