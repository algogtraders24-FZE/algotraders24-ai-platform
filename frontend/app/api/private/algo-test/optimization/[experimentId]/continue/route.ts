// app/api/private/algo-test/optimization/[experimentId]/continue/route.ts
// P4.9-A.3 - a thin HTTP adapter over optimizationService.continueOptimizationExperiment()
// (one time-budgeted chunk - claims/executes candidates up to the locked
// 8s wall-clock budget, then returns current progress). No body. Same
// path-parsing convention as GET /optimization/[experimentId] and the
// existing POST /paper-trading/positions/[id]/close - the SAME
// experimentIdFromPath() helper (segments.indexOf("optimization") + 1)
// works unchanged for this trailing /continue segment too, matching how
// positionIdFromPath is already reused as-is by both
// positions/[id]/route.ts and positions/[id]/close/route.ts. A terminal
// experiment (COMPLETED/FAILED/CANCELLED) is a harmless 200 no-op, per the
// service's own locked semantics - never a distinct ALREADY_TERMINAL error.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { optimizationService, OptimizationServiceError } from "@/services/algo-test/optimization.service";

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

  try {
    const experiment = await optimizationService.continueOptimizationExperiment(sessionUser.profile.id, experimentId);
    return ApiResponse.success({ experiment }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    // P4.9-A.3 locked mapping: NOT_FOUND -> 404; PROVIDER_ERROR -> 500
    // (the existing middleware fallback status, deliberately NOT extended
    // to 502/503 for this - the application-level code stays PROVIDER_ERROR
    // in the response body, only the transport status is the existing 500).
    if (err instanceof OptimizationServiceError) {
      const status = err.code === "NOT_FOUND" ? 404 : 500;
      return ApiResponse.error({ code: err.code, message: err.message }, ctx.requestId, status, ctx.startedAt);
    }
    throw err;
  }
});
