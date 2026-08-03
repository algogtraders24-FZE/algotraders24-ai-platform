// app/api/private/market-data/status/route.ts
// Sprint D2.3 (Phase 2) - read-only provider-status endpoint for the workspace
// Provider Status indicator. Reports which market-data providers are configured
// (in priority order) and which is primary vs fallback, so the UI can show the
// institutional-grade transparency the sprint asks for ("● TwelveData ·
// Fallback Ready"). Never exposes keys - only provider names and readiness.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { MarketDataService } from "@/services/market-data/market-data.service";

const marketData = new MarketDataService();

export const GET = withContext(async (_req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const configured = marketData.configuredProviders();
  return ApiResponse.success(
    {
      configured,
      primary: configured[0] ?? null,
      fallback: configured[1] ?? null,
      fallbackReady: configured.length > 1,
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
