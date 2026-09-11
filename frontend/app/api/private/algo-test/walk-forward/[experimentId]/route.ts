// app/api/private/algo-test/walk-forward/[experimentId]/route.ts
// P4.9-B-B.4 - a thin HTTP adapter over walkForwardService.getWalkForwardExperiment(),
// which already scopes ownership internally (an experiment belonging to
// another user resolves to null, same as a nonexistent one - never leaking
// existence, proven at the service layer by B.2's own "a different user
// resolves to null" test). Same path-parsing/ownership/404 convention as
// GET /optimization/[experimentId] - withContext's RouteHandler has no
// `params` argument, so the id is parsed from ctx.path, same as every
// other dynamic private route in this codebase.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { walkForwardService } from "@/services/algo-test/walk-forward.service";

function experimentIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("walk-forward");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const experimentId = experimentIdFromPath(ctx.path);
  if (!experimentId) throw Errors.validation("experimentId is required");

  const experiment = await walkForwardService.getWalkForwardExperiment(sessionUser.profile.id, experimentId);
  if (!experiment) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Walk-forward experiment not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ experiment }, ctx.requestId, 200, ctx.startedAt);
});
