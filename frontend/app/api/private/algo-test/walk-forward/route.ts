// app/api/private/algo-test/walk-forward/route.ts
// P4.9-B-B.4 - a thin HTTP adapter over walkForwardService.createWalkForwardExperiment(),
// the EXACT same "shape check here, every semantic check exactly once
// server-side" convention POST /optimization (app/api/private/algo-test/optimization/route.ts)
// already establishes for its own sibling domain - not a new API pattern.
// The request shape is intentionally identical to CreateOptimizationExperimentRequest's
// own fields (strategyId/symbol/timeframe/startTime/endTime/initialBalance/searchSpace) -
// per types/walk-forward.ts's own locked comment, inSampleDays/outOfSampleDays/stepDays
// are deliberately NOT client-configurable, so this route never accepts them.
// Fold derivation happens entirely inside createWalkForwardExperiment() -
// this route never touches WalkForwardFold.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { walkForwardService, WalkForwardServiceError } from "@/services/algo-test/walk-forward.service";
import type { CreateWalkForwardExperimentRequest, WalkForwardParameterRange } from "@/types/walk-forward";

function isValidSearchSpaceEntry(entry: unknown): entry is WalkForwardParameterRange {
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

  const request: CreateWalkForwardExperimentRequest = {
    strategyId,
    symbol,
    timeframe,
    startTime,
    endTime,
    ...(typeof initialBalance === "number" ? { initialBalance } : {}),
    searchSpace,
  };

  try {
    const experiment = await walkForwardService.createWalkForwardExperiment(sessionUser.profile.id, request);
    return ApiResponse.success({ experiment }, ctx.requestId, 201, ctx.startedAt);
  } catch (err) {
    // WalkForwardServiceError is NOT an AppError - withContext's own
    // catch-all would collapse it to a generic 500, discarding its typed
    // code. Every code createWalkForwardExperiment can throw is
    // validation-shaped (mirrors the P4.9-A.3 locked mapping exactly) -
    // 400, same convention POST /optimization already uses for its own
    // equivalent failure codes.
    if (err instanceof WalkForwardServiceError) {
      return ApiResponse.error({ code: err.code, message: err.message }, ctx.requestId, 400, ctx.startedAt);
    }
    throw err;
  }
});
