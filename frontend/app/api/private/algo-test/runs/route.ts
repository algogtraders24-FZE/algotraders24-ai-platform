// app/api/private/algo-test/runs/route.ts
// P3.2B - POST runs a new Algo Test (synchronous - the engine has no I/O
// and the historical-data fetch is bounded by MAX_RANGE_DAYS, so a single
// request/response round-trip is the simplest correct design; no job
// queue/polling is needed at this scale - "do not over-engineer" per
// docs/P3.2A-HISTORICAL-DATA-CONTRACT.md's own precedent). GET lists the
// authenticated user's own runs. Every run is scoped to
// sessionUser.profile.id - never trusted from the request body, the same
// ownership convention paper-trading's routes already use.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { Errors } from "@/services/backend/ErrorHandler";
import { algoTestService, DEFAULT_INITIAL_BALANCE } from "@/services/algo-test/algo-test.service";
import type { AlgoTestRunRequest } from "@/types/algo-test";
import { backtestQuotaService } from "@/services/chart/chart-quota.service";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }
  const runs = await algoTestService.listAlgoTestRuns(sessionUser.profile.id);
  return ApiResponse.success({ runs }, ctx.requestId, 200, ctx.startedAt);
});

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw Errors.validation("A JSON body with strategyId/symbol/timeframe/startTime/endTime is required");
  }
  const { strategyId, strategyVersion, parameters, symbol, timeframe, startTime, endTime, initialBalance } = body as Record<string, unknown>;
  if (typeof strategyId !== "string" || strategyId.trim().length === 0) throw Errors.validation("strategyId is required");
  if (strategyVersion !== undefined && typeof strategyVersion !== "string") throw Errors.validation("strategyVersion must be a string when provided");
  // P3.4 - only a shape check here (a plain JSON object, or omitted). The
  // actual per-parameter type/range/step validation against the
  // authoritative registry schema happens exactly once, server-side, in
  // algo-test.service.ts's validateRequest() - never duplicated here.
  if (parameters !== undefined && (typeof parameters !== "object" || parameters === null || Array.isArray(parameters))) {
    throw Errors.validation("parameters must be a JSON object when provided");
  }
  if (typeof symbol !== "string" || symbol.trim().length === 0) throw Errors.validation("symbol is required");
  if (typeof timeframe !== "string" || timeframe.trim().length === 0) throw Errors.validation("timeframe is required");
  if (typeof startTime !== "string" || startTime.trim().length === 0) throw Errors.validation("startTime (ISO 8601) is required");
  if (typeof endTime !== "string" || endTime.trim().length === 0) throw Errors.validation("endTime (ISO 8601) is required");
  if (initialBalance !== undefined && typeof initialBalance !== "number") throw Errors.validation("initialBalance must be a number when provided");

  const request: AlgoTestRunRequest = {
    strategyId,
    ...(typeof strategyVersion === "string" ? { strategyVersion } : {}),
    ...(parameters !== undefined ? { parameters: parameters as Record<string, unknown> } : {}),
    symbol,
    timeframe,
    startTime,
    endTime,
    initialBalance: typeof initialBalance === "number" ? initialBalance : DEFAULT_INITIAL_BALANCE,
  };

  // One free backtest, then a paid plan (lib/access/chart-quota.ts). Checked before the run; counted only when the run completes, so a rejected or failed
  // request does not use up the free test.
  const quota = await backtestQuotaService.status(sessionUser.profile.id, sessionUser.profile.role);
  if (!quota.allowed) {
    return ApiResponse.error(
      quota.reason === "free_limit_reached"
        ? { code: "PRO_REQUIRED", message: "Your free backtest has been used. More backtests are part of the Pro plan." }
        : { code: "RATE_LIMITED", message: "Daily backtest limit reached. It resets at 00:00 UTC." },
      ctx.requestId, quota.reason === "free_limit_reached" ? 403 : 429, ctx.startedAt,
    );
  }
  if (quota.maxRangeDays !== null) {
    const days = (Date.parse(endTime) - Date.parse(startTime)) / 86_400_000;
    if (Number.isFinite(days) && days > quota.maxRangeDays) {
      return ApiResponse.error({ code: "RANGE_TOO_LARGE", message: `The free backtest covers up to ${quota.maxRangeDays} days. Longer windows are part of the Pro plan.` }, ctx.requestId, 400, ctx.startedAt);
    }
  }

  const run = await algoTestService.runAlgoTest(sessionUser.profile.id, request);
  if (run.testId !== "" && run.status === "completed") await backtestQuotaService.recordCompleted(sessionUser.profile.id).catch(() => undefined);

  // A run that was never even attempted (rejected before any AlgoTestRun
  // row was created - testId === "") is a client input error, HTTP 400.
  // A run that WAS attempted and failed (a real provider/data/backtest
  // failure, already persisted with its own real id) is still a
  // successful API call returning a real resource - HTTP 200, same as
  // quant-lite's own BacktestResult.status === "failed" convention.
  if (run.testId === "") {
    return ApiResponse.error({ code: run.errorCode ?? "INVALID_DATE_RANGE", message: run.errorMessage ?? "Invalid request" }, ctx.requestId, 400, ctx.startedAt);
  }
  return ApiResponse.success({ run }, ctx.requestId, 201, ctx.startedAt);
});
