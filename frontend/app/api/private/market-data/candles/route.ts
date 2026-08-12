// app/api/private/market-data/candles/route.ts
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation. The one new,
// minimal, read-only route this sprint's Phase 1 audit found genuinely
// missing: no existing route exposed MarketDataService.getTimeSeries()'s
// real OHLC candles to the browser (TradingView, the only chart AT24 has
// had until now, fetches its own data externally and was never wired to
// this platform's own market-data layer at all). This route CONSUMES the
// existing D2.2/D2.6.3 MarketDataService; it adds no new provider, no new
// symbol registry, no new caching layer.
//
// Timeframe handling deliberately reuses the EXISTING SignalTimeframe
// vocabulary (types/signal.ts) and the EXISTING SignalTimeframe -> provider-
// interval mapping (PROVIDER_INTERVAL, already exported from
// hypothesis-outcome-evaluator.service.ts and already used in production by
// RealTimeIntelligenceService) - never a second timeframe registry, per the
// sprint's own explicit instruction.
//
// Sprint D2.7.3 - Production Data Layer. Now also reports honest provider
// provenance (provider/providerSymbol/fallbackUsed) via MarketDataService.
// getTimeSeriesWithProvenance() (same selection loop, same order - D2.7.3
// Phase 2), and serves repeat requests for the same symbol/timeframe/size
// from a short-lived route-local TtlCache (the SAME TtlCache primitive
// every other market-data caching layer already uses - lib/market-data/
// cache.ts - never a second caching mechanism), so panning/zooming the
// chart (which never triggers a refetch - see useChartCandles.ts) and a
// timeframe re-select shortly after don't both hit the upstream provider.
// Freshness is assessed via the EXISTING D2.6.4 freshness-policy.service.ts,
// which already had a `{kind:"candle", timeframe}` subject defined but no
// real consumer until now.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { marketData } from "@/services/market-data/shared-instance";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { toMarketDataErrorDTO, statusCodeForReason } from "@/lib/market-data/error-dto";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { TtlCache } from "@/lib/market-data/cache";
import { assessFreshness } from "@/services/market-data/freshness-policy.service";
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import type { ChartSeries } from "@/types/chart-data";
import type { TimeSeriesResult } from "@/types/market-candle";

const DEFAULT_OUTPUT_SIZE = 300;
const MIN_OUTPUT_SIZE = 10;
const MAX_OUTPUT_SIZE = 1000;
const DEFAULT_TIMEFRAME: SignalTimeframe = "1h";
// Sprint D2.7.3 - short enough that a chart never shows meaningfully stale
// data on a fresh symbol/timeframe switch, long enough to absorb the
// repeat requests a timeframe toggle or a remount can cause. Independent
// of MarketDataService's OWN cache (which does not cover candles at all -
// see that service's getTimeSeries() comment) - this cache exists only at
// this route's boundary.
const ROUTE_CACHE_TTL_MS = 15_000;

const routeCache = new TtlCache<{ result: TimeSeriesResult; providerSymbol?: string }>(ROUTE_CACHE_TTL_MS);

function parseOutputSize(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_OUTPUT_SIZE;
  if (!Number.isFinite(parsed)) return DEFAULT_OUTPUT_SIZE;
  return Math.min(Math.max(parsed, MIN_OUTPUT_SIZE), MAX_OUTPUT_SIZE);
}

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const timeframeRaw = url.searchParams.get("timeframe");
  const outputSize = parseOutputSize(url.searchParams.get("outputSize"));

  const instrument = typeof symbol === "string" ? getCanonicalInstrument(symbol) : undefined;
  if (typeof symbol !== "string" || !instrument) {
    return ApiResponse.error(
      { code: "VALIDATION", message: "symbol must be a known canonical instrument." },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const timeframe: SignalTimeframe = isSignalTimeframe(timeframeRaw) ? timeframeRaw : DEFAULT_TIMEFRAME;
  if (timeframeRaw !== null && !isSignalTimeframe(timeframeRaw)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `timeframe must be one of the platform's supported timeframes.` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const cacheKey = `${symbol}|${timeframe}|${outputSize}`;

  try {
    let cached = false;
    let cacheAgeMs: number | undefined;
    let retrievedAt: string;
    let providerResult: TimeSeriesResult;
    let providerSymbol: string | undefined;

    const stale = routeCache.getStale(cacheKey, ROUTE_CACHE_TTL_MS);
    if (stale) {
      cached = true;
      cacheAgeMs = stale.ageMs;
      providerResult = stale.value.result;
      providerSymbol = stale.value.providerSymbol;
      retrievedAt = new Date(Date.now() - stale.ageMs).toISOString();
    } else {
      providerResult = await marketData.getTimeSeriesWithProvenance({
        symbol,
        interval: PROVIDER_INTERVAL[timeframe],
        outputSize,
      });
      // Sprint D2.7.3 - providerSymbol is looked up from the EXISTING
      // canonical instrument catalog's own providerMappings for the
      // provider that actually served the request - never a second symbol
      // registry, never a guess when the catalog genuinely has no mapping
      // recorded for this provider/instrument pair.
      providerSymbol = instrument.providerMappings.find((m) => m.provider === providerResult.provider)?.providerSymbol;
      retrievedAt = new Date().toISOString();
      routeCache.set(cacheKey, { result: providerResult, providerSymbol });
    }

    const { candles, rejectedCount } = normalizeCandles(providerResult.candles);
    const latest = candles[candles.length - 1];
    const freshness = assessFreshness({
      subject: { kind: "candle", timeframe },
      timestamp: latest ? new Date(latest.time).toISOString() : undefined,
      nowMs: Date.now(),
    }).status;

    const series: ChartSeries = {
      symbol,
      timeframe,
      candles,
      rejectedCount,
      retrievedAt,
      provider: providerResult.provider,
      providerSymbol,
      fallbackUsed: providerResult.fallbackUsed,
      cached,
      cacheAgeMs,
      freshness,
      timestamp: latest ? new Date(latest.time).toISOString() : undefined,
    };
    return ApiResponse.success({ series }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
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
