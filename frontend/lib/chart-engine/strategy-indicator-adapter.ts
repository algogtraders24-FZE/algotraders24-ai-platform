// lib/chart-engine/strategy-indicator-adapter.ts
// QP-3 - Strategy + Chart Preview. A pure shape adapter, nothing else: it
// converts the QP-2 compiler's own already-computed indicator values
// (CompileNaturalLanguageStrategyResult.buildIndicatorSeries()'s return
// shape, Map<string, (number|boolean|undefined)[]> index-aligned to the
// SAME bars array the caller fed it) into the chart renderer's existing
// IndicatorSeries[] shape (lib/chart-engine/indicators/types.ts) - the
// exact structure renderChart() (lib/chart-engine/renderer.ts, this
// codebase's ONE chart renderer) already knows how to draw.
//
// Performs NO indicator calculation (every value here was already computed
// by the compiler's own calculateSeries() call), NO strategy
// interpretation, and NO data fetching - purely pairs each already-real
// value with its own candle's real timestamp and assigns the SAME
// id/panel/color convention lib/chart-engine/indicators/compute.ts already
// established for SMA/EMA (price overlay) and RSI/ATR (own sub-panel) -
// never a new mapping invented for this adapter.
import type { ChartCandle } from "@/types/chart-data";
import type { IndicatorConfig, IndicatorId, IndicatorLine, IndicatorSeries, ChartPanelId } from "./indicators/types";

/** "EMA(20)" -> { family: "EMA", period: 20 }. Returns undefined for a key this adapter doesn't recognize (e.g. the "PRICE" pseudo-indicator, which is not a real indicator to overlay - the candles themselves already show price) rather than guessing. */
function parseIndicatorKey(key: string): { family: string; period: number } | undefined {
  const match = /^([A-Z]+)\(([0-9.]+)\)$/.exec(key);
  if (!match) return undefined;
  const period = Number(match[2]);
  if (!Number.isFinite(period)) return undefined;
  return { family: match[1]!, period };
}

/** The SAME id+panel pairing lib/chart-engine/indicators/compute.ts's own switch statement already assigns for these exact 4 families - the only families the AI compiler (lib/ai/strategy-compiler/schema.ts) can ever produce. Never invented here; mirrored from the existing convention. */
const FAMILY_TO_INDICATOR: Readonly<Record<string, { id: IndicatorId; panel: ChartPanelId }>> = {
  SMA: { id: "sma", panel: "price" },
  EMA: { id: "ema", panel: "price" },
  RSI: { id: "rsi", panel: "rsi" },
  ATR: { id: "atr", panel: "atr" },
};

/** A small rotating palette of AT24's own existing design tokens (the same var()-token convention lib/chart-engine/indicators/panel-registry.ts's DEFAULT_INDICATOR_CONFIGS already uses) so two distinct indicators (e.g. EMA(9) and EMA(21)) are visually distinguishable rather than drawn in the same color. */
const COLOR_ROTATION: readonly string[] = ["var(--gold)", "var(--gold-strong)", "var(--steel)", "var(--text-3)"];

export interface AdaptStrategyIndicatorSeriesOptions {
  /** The exact candles the indicator values were computed against - buildIndicatorSeries()'s own output is index-aligned to whatever bars array its caller passed it. Providing a DIFFERENT candle set here would silently misalign every point; this adapter cannot detect that case, only the caller can guarantee it. */
  candles: readonly ChartCandle[];
}

/**
 * Converts the compiler's Map<string, values> into the renderer's
 * IndicatorSeries[]. Skips a key it can't parse (e.g. "PRICE") rather than
 * throwing or fabricating an entry for it. Pairs each value with its
 * candle's `time` up to whichever of (candles.length, values.length) is
 * SHORTER - never fabricates a timestamp for a value with no matching
 * candle, and never fabricates a value for a candle past the end of a
 * shorter indicator series (both are honest, real mismatches this
 * function reports by simply omitting the unpaired tail, not by guessing).
 */
export function adaptStrategyIndicatorSeries(
  indicatorValues: ReadonlyMap<string, readonly (number | boolean | undefined)[]>,
  options: AdaptStrategyIndicatorSeriesOptions,
): IndicatorSeries[] {
  const { candles } = options;
  const result: IndicatorSeries[] = [];
  let colorIndex = 0;

  for (const [key, values] of indicatorValues) {
    const parsed = parseIndicatorKey(key);
    if (!parsed) continue; // e.g. "PRICE" - not a real indicator to overlay
    const mapping = FAMILY_TO_INDICATOR[parsed.family];
    if (!mapping) continue; // a family this adapter doesn't (yet) know how to place - never guessed

    const pointCount = Math.min(candles.length, values.length);
    const points = [];
    for (let i = 0; i < pointCount; i += 1) {
      const raw = values[i];
      points.push({ time: candles[i]!.time, value: typeof raw === "number" ? raw : undefined });
    }

    const color = COLOR_ROTATION[colorIndex % COLOR_ROTATION.length]!;
    colorIndex += 1;

    const config: IndicatorConfig = { id: mapping.id, key, period: parsed.period, color };
    const line: IndicatorLine = { name: key, points, color };
    result.push({ config, panel: mapping.panel, lines: [line] });
  }

  return result;
}

/** The distinct non-"price" panels a set of adapted indicator series needs (e.g. ["rsi"] if the strategy references RSI) - the same `activePanels` shape renderChart()'s own callers already compute from their own indicatorSeries. Never includes "price" (always implicit, per renderChart()'s own contract). */
export function activePanelsForIndicatorSeries(series: readonly IndicatorSeries[]): ChartPanelId[] {
  const panels = new Set<ChartPanelId>();
  for (const s of series) if (s.panel !== "price") panels.add(s.panel);
  return Array.from(panels);
}
