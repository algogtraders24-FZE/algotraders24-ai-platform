// app/api/private/algo-test/optimization/[experimentId]/cancel/route.ts
// P4.9-A.3 - a thin HTTP adapter over optimizationService.cancelOptimizationExperiment()
// (an atomic QUEUED/RUNNING -> CANCELLED conditional transition, mutually
// exclusive with finalization by construction). No body. Same
// path-parsing/null-is-404 convention as every other dynamic private
// route - cancelOptimizationExperiment() returns null for a nonexistent
// or not-owned experiment (never leaking existence, same discipline as
// getOptimizationExperiment), never throws.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { optimizationService } from "@/services/algo-test/optimization.service";

function experimentIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("optimization");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const POST = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const experimentId = experimentIdFromPath(ctx.path);
  if (!experimentId) throw Errors.validation("experimentId is required");

  const experiment = await optimizationService.cancelOptimizationExperiment(sessionUser.profile.id, experimentId);
  if (!experiment) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Optimization experiment not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ experiment }, ctx.requestId, 200, ctx.startedAt);
});
