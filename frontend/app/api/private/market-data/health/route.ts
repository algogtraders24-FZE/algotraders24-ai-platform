// app/api/private/market-data/health/route.ts
// Sprint D2.3.S3 - full Provider Health Monitor detail (Objective 2): per-
// provider state (healthy/degraded/rate_limited/offline), last latency, last
// error kind, and rolling success/failure counts, from the shared
// MarketDataService instance's real recorded outcomes. Never exposes keys.
// This is a superset of status/route.ts's summary primaryState field, for
// any consumer (an admin/diagnostic view, or a richer UI) that wants the
// full picture rather than just the primary provider's state.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { marketData } from "@/services/market-data/shared-instance";

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const configured = marketData.configuredProviders();
  const providers = marketData.healthReport();

  return ApiResponse.success(
    {
      providers,
      primary: configured[0] ?? null,
      fallback: configured[1] ?? null,
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
