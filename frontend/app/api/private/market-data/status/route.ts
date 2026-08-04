// app/api/private/market-data/status/route.ts
// Sprint D2.3 (Phase 2) - read-only provider-status endpoint for the workspace
// Provider Status indicator. Reports which market-data providers are configured
// (in priority order) and which is primary vs fallback, so the UI can show the
// institutional-grade transparency the sprint asks for ("● TwelveData ·
// Fallback Ready"). Never exposes keys - only provider names and readiness.
//
// Sprint D2.3.S3 - fixed a real gap: this route used to construct its own
// throwaway `new MarketDataService()`, which never observes any real traffic
// (every snapshot/snapshots request goes through the shared instance in
// services/market-data/shared-instance.ts instead). That meant a health
// monitor living on this route's own instance would always report empty
// data. Now imports the shared instance, same as snapshot/snapshots, so
// `state` below reflects real, recently-observed provider outcomes.
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
  const health = marketData.healthReport();
  const stateFor = (provider: string | null) => (provider ? health.find((h) => h.provider === provider)?.state ?? "healthy" : null);

  return ApiResponse.success(
    {
      configured,
      primary: configured[0] ?? null,
      fallback: configured[1] ?? null,
      fallbackReady: configured.length > 1,
      primaryState: stateFor(configured[0] ?? null),
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
