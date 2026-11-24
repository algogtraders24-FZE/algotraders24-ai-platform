// app/api/private/algo-test/range-limits/route.ts
// GET -> { limits: { "1m": days, "5m": days, ... }, source } the longest backtest window per timeframe right now (the same numbers the run endpoints enforce).
// With the Exness API enabled that is up to two years for H1 and slower timeframes; otherwise the Twelve Data limits.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME, maxRangeDaysFor } from "@/services/algo-test/algo-test.service";
import { exnessHistoryEnabled } from "@/services/algo-test/historical-data/exness-provider";

export const dynamic = "force-dynamic";

export const GET = withContext(async (_req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const limits: Record<string, number> = {};
  for (const [signalTf, engineTf] of Object.entries(SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME)) {
    try { limits[signalTf] = maxRangeDaysFor(engineTf); } catch { /* a timeframe with no data coverage has no limit to show */ }
  }
  return ApiResponse.success({ limits, source: exnessHistoryEnabled() ? "exness" : "twelve-data" }, ctx.requestId, 200, ctx.startedAt);
});
