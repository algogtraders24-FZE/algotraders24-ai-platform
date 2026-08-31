// app/api/quant-lite/coverage/route.ts
// Q1.1.7/41 - read-only coverage assessment for a specific symbol/
// timeframe/date-range, computed server-side and authoritatively
// (services/quant-lite/backend/coveragePolicy.ts). The Backtest Setup UI
// calls this live as the user edits dates, so the same numbers a job
// would be judged against are shown before submit - never a client-side
// approximation.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { assessCoverage } from "@/services/quant-lite/backend/coveragePolicy";

export const runtime = "nodejs";

export const GET = withContext(async (req, ctx) => {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const timeframe = url.searchParams.get("timeframe");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!symbol || !timeframe || !start || !end) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "symbol, timeframe, start, and end query params are all required" }, ctx.requestId, 400, ctx.startedAt);
  }
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
    return ApiResponse.error({ code: "INVALID_REQUEST", message: "start/end could not be parsed as dates" }, ctx.requestId, 400, ctx.startedAt);
  }

  const assessment = assessCoverage(symbol, timeframe, start, end);
  return ApiResponse.success(assessment, ctx.requestId, 200, ctx.startedAt);
});
