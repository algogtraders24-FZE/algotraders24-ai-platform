// services/algo-test/quant-chat-preview.service.ts
// QP-3 - Strategy + Chart Preview. Assembles the (candles + indicator
// overlay) data a successful MODIFY compile needs to render
// StrategyChartPreview - never touches quant-strategy-builder.service.ts
// (QP-2's own compile orchestration stays exactly as QP-2 left it).
//
// Reuses, never duplicates:
//   - the EXISTING algo-test historical data provider
//     (twelveDataHistoricalDataProvider, already used by algo-test.service
//     .ts's own reopen-candle-refetch) for real bars - never a new
//     market-data API/route.
//   - the QP-2 compiler's own already-returned buildIndicatorSeries()
//     closure, called here with those real bars - never re-derives the
//     strategy's indicator values, never a second calculateSeries() call
//     site with different logic.
//   - strategy-indicator-adapter.ts (QP-3's own pure shape adapter) to
//     turn the result into the renderer's IndicatorSeries[] shape.
//
// Best-effort by design, matching algo-test.service.ts's own reopen
// candle-refetch precedent ("a provider hiccup... must never turn an
// already-successful result into an error"): a chart/provider failure
// here returns undefined, never throws - a successful MODIFY compile must
// never be blocked or degraded by the preview being unavailable.
import { twelveDataHistoricalDataProvider } from "./historical-data/twelve-data-provider";
import type { HistoricalDataProvider } from "./historical-data/types";
import { adaptStrategyIndicatorSeries, activePanelsForIndicatorSeries } from "@/lib/chart-engine/strategy-indicator-adapter";
import type { CompileNaturalLanguageStrategyResult } from "./nl-strategy-compiler.service";
import type { ChartCandle } from "@/types/chart-data";
import type { IndicatorSeries, ChartPanelId } from "@/lib/chart-engine/indicators/types";
import type { OHLCVBar, Timeframe } from "at24-quant-engine";
import type { SignalTimeframe } from "@/types/signal";

export interface QuantChatPreviewData {
  symbol: string;
  timeframe: SignalTimeframe;
  name?: string;
  candles: ChartCandle[];
  indicatorSeries: IndicatorSeries[];
  activePanels: ChartPanelId[];
}

/**
 * The engine's own Timeframe -> the chart renderer's SignalTimeframe.
 * Deliberately scoped to exactly the 7 timeframes the AI compiler can ever
 * produce (lib/ai/strategy-compiler/schema.ts's own
 * AI_COMPILER_SUPPORTED_TIMEFRAMES) - not a general-purpose converter, so
 * it can never silently drift from what the compiler could actually emit.
 * No complete reverse of this mapping exists elsewhere in the codebase
 * (services/algo-test/algo-test.service.ts's own
 * SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME has exactly one entry, scoped to
 * the registry-strategy path's own "5m"-only need) - this is a new, small,
 * purely-declarative table, not a duplicate of an existing one.
 */
const ENGINE_TO_SIGNAL_TIMEFRAME: Readonly<Partial<Record<Timeframe, SignalTimeframe>>> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
};

const TIMEFRAME_DURATION_MS: Readonly<Partial<Record<Timeframe, number>>> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
};

/** Matches useChartCandles.ts's own DEFAULT_OUTPUT_SIZE (300) for visual/behavioral parity with every other chart on this platform - a preview window, not an attempt to mirror a real backtest's own date range (there is none yet; no backtest has run). */
const PREVIEW_BAR_COUNT = 300;

function toChartCandle(bar: OHLCVBar): ChartCandle {
  return { time: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
}

export interface BuildQuantChatPreviewDeps {
  historicalDataProvider?: HistoricalDataProvider;
  /** Injectable for tests only - defaults to the real current time. */
  now?: () => Date;
}

/**
 * Best-effort: returns undefined (never throws) whenever the compiled
 * spec has no usable instrument/timeframe, the mapping to a renderer
 * SignalTimeframe fails, the provider call fails, or zero real bars come
 * back - a MODIFY turn's own compile success is never blocked by this.
 */
export async function buildQuantChatPreview(run: CompileNaturalLanguageStrategyResult, deps: BuildQuantChatPreviewDeps = {}): Promise<QuantChatPreviewData | undefined> {
  const spec = run.compiledSpec;
  if (!spec || !run.buildIndicatorSeries) return undefined;

  const symbol = spec.instruments[0]?.symbol;
  const engineTimeframe = spec.timeframes[0];
  if (!symbol || !engineTimeframe) return undefined;

  const signalTimeframe = ENGINE_TO_SIGNAL_TIMEFRAME[engineTimeframe];
  const durationMs = TIMEFRAME_DURATION_MS[engineTimeframe];
  if (!signalTimeframe || !durationMs) return undefined;

  const provider = deps.historicalDataProvider ?? twelveDataHistoricalDataProvider;
  const now = (deps.now ?? (() => new Date()))();
  const startTime = new Date(now.getTime() - PREVIEW_BAR_COUNT * durationMs);

  let bars: readonly OHLCVBar[];
  try {
    const res = await provider.getBars({ symbol, timeframe: engineTimeframe, startTime: startTime.toISOString(), endTime: now.toISOString() });
    bars = res.bars;
  } catch {
    return undefined; // a provider hiccup must never block or degrade the compile turn itself
  }
  if (bars.length === 0) return undefined;

  const candles = bars.map(toChartCandle);
  const indicatorValues = run.buildIndicatorSeries(bars);
  const indicatorSeries = adaptStrategyIndicatorSeries(indicatorValues, { candles });
  const activePanels = activePanelsForIndicatorSeries(indicatorSeries);

  return { symbol, timeframe: signalTimeframe, name: spec.identity.name, candles, indicatorSeries, activePanels };
}
