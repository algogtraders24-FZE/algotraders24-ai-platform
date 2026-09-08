// app/api/private/algo-test/optimization/route.ts
// P4.9-A.3 - a thin HTTP adapter over optimizationService.createOptimizationExperiment(),
// which already owns every real decision (strategy resolution, search-space
// bounds/step/cap validation, candidate generation, fingerprint
// computation). Same request-shape-check-then-delegate convention as the
// existing POST /runs (app/api/private/algo-test/runs/route.ts) - only a
// SHAPE check here (non-empty strings, array/object presence); every
// semantic check (parameter bounds, the 256 cap, date-range caps) happens
// exactly once, server-side, in optimization.service.ts's own
// validateCreateRequest() - never duplicated here.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { optimizationService, OptimizationServiceError } from "@/services/algo-test/optimization.service";
import type { CreateOptimizationExperimentRequest, OptimizationParameterRange } from "@/types/optimization";

function isValidSearchSpaceEntry(entry: unknown): entry is OptimizationParameterRange {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.parameterId === "string" && e.parameterId.trim().length > 0 && typeof e.min === "number" && typeof e.max === "number" && typeof e.step === "number";
}

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw Errors.validation("A JSON body with strategyId/symbol/timeframe/startTime/endTime/searchSpace is required");
  }
  const { strategyId, symbol, timeframe, startTime, endTime, initialBalance, searchSpace } = body as Record<string, unknown>;
  if (typeof strategyId !== "string" || strategyId.trim().length === 0) throw Errors.validation("strategyId is required");
  if (typeof symbol !== "string" || symbol.trim().length === 0) throw Errors.validation("symbol is required");
  if (typeof timeframe !== "string" || timeframe.trim().length === 0) throw Errors.validation("timeframe is required");
  if (typeof startTime !== "string" || startTime.trim().length === 0) throw Errors.validation("startTime (ISO 8601) is required");
  if (typeof endTime !== "string" || endTime.trim().length === 0) throw Errors.validation("endTime (ISO 8601) is required");
  if (initialBalance !== undefined && typeof initialBalance !== "number") throw Errors.validation("initialBalance must be a number when provided");
  if (!Array.isArray(searchSpace) || !searchSpace.every(isValidSearchSpaceEntry)) {
    throw Errors.validation("searchSpace must be an array of {parameterId: string, min: number, max: number, step: number}");
  }

  const request: CreateOptimizationExperimentRequest = {
    strategyId,
    symbol,
    timeframe,
    startTime,
    endTime,
    ...(typeof initialBalance === "number" ? { initialBalance } : {}),
    searchSpace,
  };

  try {
    const experiment = await optimizationService.createOptimizationExperiment(sessionUser.profile.id, request);
    return ApiResponse.success({ experiment }, ctx.requestId, 201, ctx.startedAt);
  } catch (err) {
    // OptimizationServiceError is NOT an AppError - withContext's own
    // catch-all would collapse it to a generic 500, discarding its typed
    // code. Every code createOptimizationExperiment can throw is
    // validation-shaped (P4.9-A.3 locked mapping) - 400, same convention
    // POST /runs already uses for its own equivalent failure codes.
    if (err instanceof OptimizationServiceError) {
      return ApiResponse.error({ code: err.code, message: err.message }, ctx.requestId, 400, ctx.startedAt);
    }
    throw err;
  }
});
