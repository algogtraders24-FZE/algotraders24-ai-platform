// app/api/private/algo-test/strategy-library/[strategyId]/route.ts
// P4.8-T3.3 - a thin HTTP adapter over algoTestService.getStrategyLibraryDetail(),
// which already owns every real decision (registry-vs-AI disambiguation,
// artifact integrity verification, the artifactVerified boundary). Same
// path-parsing/ownership/404 convention as the existing GET /runs/[id]
// (app/api/private/algo-test/runs/[id]/route.ts) - withContext's
// RouteHandler has no `params` argument, so the id is parsed from
// ctx.path, same as every other dynamic private route in this codebase.
// getStrategyLibraryDetail() already scopes ownership internally (a
// Strategy belonging to another user resolves to null, same as a
// nonexistent one) - never leaking existence, same discipline as
// getAlgoTestRun's own userId-scoped query.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { algoTestService } from "@/services/algo-test/algo-test.service";

function strategyIdFromPath(path: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf("strategy-library");
  return idx >= 0 ? segments[idx + 1] : undefined;
}

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const strategyId = strategyIdFromPath(ctx.path);
  if (!strategyId) throw Errors.validation("strategyId is required");

  const strategy = await algoTestService.getStrategyLibraryDetail(sessionUser.profile.id, strategyId);
  if (!strategy) {
    return ApiResponse.error({ code: "NOT_FOUND", message: "Strategy not found" }, ctx.requestId, 404, ctx.startedAt);
  }
  return ApiResponse.success({ strategy }, ctx.requestId, 200, ctx.startedAt);
});
