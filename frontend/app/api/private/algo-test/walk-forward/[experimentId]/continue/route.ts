// app/api/private/algo-test/walk-forward/[experimentId]/continue/route.ts
// P4.9-B-B.4 - a thin HTTP adapter over
// walkForwardExecutionService.continueWalkForwardExperiment() (B.3's own
// one time-budgeted chunk - CLOSED, unmodified here). No body. Same
// path-parsing convention as GET /walk-forward/[experimentId] and
// POST /optimization/[experimentId]/continue - the same
// experimentIdFromPath() helper (segments.indexOf("walk-forward") + 1)
// works unchanged for this trailing /continue segment too. A terminal
// experiment (COMPLETED/FAILED/CANCELLED) is a harmless 200 no-op, per
// continueWalkForwardExperiment()'s own locked semantics - never a
// distinct ALREADY_TERMINAL error, mirroring the optimization route's own
// identical rule.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { walkForwardExecutionService } from "@/services/algo-test/walk-forward-execution.service";
import { WalkForwardServiceError } from "@/services/algo-test/walk-forward.service";

function experimentIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("walk-forward");
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
    const experiment = await walkForwardExecutionService.continueWalkForwardExperiment(sessionUser.profile.id, experimentId);
    return ApiResponse.success({ experiment }, ctx.requestId, 200, ctx.startedAt);
  } catch (err) {
    // Mirrors the P4.9-A.3 locked mapping exactly: NOT_FOUND -> 404;
    // PROVIDER_ERROR (and any other non-NOT_FOUND code) -> 500 (the
    // existing middleware fallback status, deliberately NOT extended to
    // 502/503 - the application-level code stays in the response body,
    // only the transport status is the existing 500).
    if (err instanceof WalkForwardServiceError) {
      const status = err.code === "NOT_FOUND" ? 404 : 500;
      return ApiResponse.error({ code: err.code, message: err.message }, ctx.requestId, status, ctx.startedAt);
    }
    throw err;
  }
});
