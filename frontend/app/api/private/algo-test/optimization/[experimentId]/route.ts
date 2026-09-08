// app/api/private/algo-test/optimization/[experimentId]/route.ts
// P4.9-A.3 - a thin HTTP adapter over optimizationService.getOptimizationExperiment(),
// which already scopes ownership internally (an experiment belonging to
// another user resolves to null, same as a nonexistent one - never leaking
// existence). Same path-parsing/ownership/404 convention as the existing
// GET /runs/[id] and GET /strategy-library/[strategyId] - withContext's
// RouteHandler has no `params` argument, so the id is parsed from
// ctx.path, same as every other dynamic private route in this codebase.
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

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const experimentId = experimentIdFromPath(ctx.path);
  if (!experimentId) throw Errors.validation("experimentId is required");

  const experiment = await optimizationService.getOptimizationExperiment(sessionUser.profile.id, experimentId);
  if (!experiment) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Optimization experiment not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ experiment }, ctx.requestId, 200, ctx.startedAt);
});
