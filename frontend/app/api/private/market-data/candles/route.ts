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
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { marketData } from "@/services/market-data/shared-instance";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { toMarketDataErrorDTO, statusCodeForReason } from "@/lib/market-data/error-dto";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { isSignalTimeframe, type SignalTimeframe } from "@/types/signal";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import type { ChartSeries } from "@/types/chart-data";

const DEFAULT_OUTPUT_SIZE = 300;
const MIN_OUTPUT_SIZE = 10;
const MAX_OUTPUT_SIZE = 1000;
const DEFAULT_TIMEFRAME: SignalTimeframe = "1h";

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

  if (typeof symbol !== "string" || !getCanonicalInstrument(symbol)) {
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

  try {
    const rawCandles = await marketData.getTimeSeries({
      symbol,
      interval: PROVIDER_INTERVAL[timeframe],
      outputSize,
    });
    const { candles, rejectedCount } = normalizeCandles(rawCandles);
    const series: ChartSeries = {
      symbol,
      timeframe,
      candles,
      rejectedCount,
      retrievedAt: new Date().toISOString(),
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
