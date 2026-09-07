// app/api/private/algo-test/strategy-library/route.ts
// P4.8-T3.3 (docs/P4.8-T3-STRATEGY-LIBRARY.md, per the locked T3.1
// contract) - a thin HTTP adapter over algoTestService.listStrategyLibrary(),
// which already owns every real decision (registry + AI union, ordering,
// bounded aggregation). Same auth/response conventions as the existing
// GET /runs (app/api/private/algo-test/runs/route.ts) - no new pattern.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { algoTestService } from "@/services/algo-test/algo-test.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const strategies = await algoTestService.listStrategyLibrary(sessionUser.profile.id);
  return ApiResponse.success({ strategies }, ctx.requestId, 200, ctx.startedAt);
});
