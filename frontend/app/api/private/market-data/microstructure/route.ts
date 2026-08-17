// app/api/private/market-data/microstructure/route.ts
// Sprint D2.8.10 - Microstructure Visualization & Intelligence Evidence
// Layer. A thin, read-only endpoint over D2.8.5's MicrostructureSnapshotService
// and D2.8.6's shared binanceMicrostructureProvider/microstructureSnapshots
// instances - the exact same boundary D2.8.7's RealTimeIntelligenceService
// already consumes server-side, now also reachable from the browser so the
// native chart can render it. No calculation, validation, or provider logic
// is reimplemented here; this route only decides (a) whether the requested
// instrument is genuinely Binance-mapped (reusing the real canonical
// instrument catalog, never a second registry) and (b) how to shape the
// HTTP response.
//
// Capability gating mirrors RealTimeIntelligenceService.fetchMicrostructure()
// (services/intelligence/orchestration/real-time-intelligence.service.ts,
// D2.8.7/D2.8.9) exactly: an instrument with no real Binance "quote"
// provider mapping never even reaches the provider - `supported: false` is
// returned immediately, with zero network calls, zero symbol substitution.
//
// Timeout: reuses D2.8.9's own fix (withReliability, retries: 0) rather than
// leaving this call unbounded - the same primitive MarketDataService wraps
// every OHLC/quote provider call with.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { withReliability } from "@/lib/market-data/reliability";
import { binanceMicrostructureProvider, microstructureSnapshots } from "@/services/microstructure/shared-instance";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { toMarketDataErrorDTO, statusCodeForReason } from "@/lib/market-data/error-dto";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const symbol = new URL(req.url).searchParams.get("symbol");
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol query parameter is required" }, ctx.requestId, 400, ctx.startedAt);
  }

  const instrument = getCanonicalInstrument(symbol);
  const binanceCapable = (instrument?.providerMappings ?? []).some(
    (m) => m.provider === binanceMicrostructureProvider.name && m.supportedCapabilities.includes("quote"),
  );
  if (!binanceCapable) {
    // Honest, explicit "not applicable" - never a fabricated MicrostructureSnapshot
    // shape with placeholder unavailable fields, and Binance is never called.
    return ApiResponse.success({ supported: false, symbol }, ctx.requestId, 200, ctx.startedAt);
  }

  try {
    const snapshot = await withReliability(
      () => microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol }),
      binanceMicrostructureProvider.name,
      { retries: 0 },
    );
    return ApiResponse.success({ supported: true, snapshot }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
      // Never cached (D2.8.5's own deliberate "read close to real-time"
      // design) - `cached: false` is the honest, only possible value here.
      const dto = toMarketDataErrorDTO(error, { cached: false });
      return ApiResponse.error(
        { code: dto.reason.toUpperCase(), message: error.message, details: dto as unknown as Record<string, unknown> },
        ctx.requestId,
        statusCodeForReason(dto.reason),
        ctx.startedAt,
      );
    }
    throw error;
  }
});
