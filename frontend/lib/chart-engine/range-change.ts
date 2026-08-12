// lib/chart-engine/range-change.ts
// Sprint D2.7.5, Phase 2 - the professional chart header needs a "price
// change" figure but must never fetch a second data source to get one (the
// sprint brief's own "consume already available chart/workspace data, no
// duplicated fetching" rule). The only change figure derivable from data
// the chart has ALREADY loaded is the change across the currently loaded
// candle range itself (first candle's open -> last candle's close) - NOT a
// "today's session change" (that would require knowing the session/day
// boundary, which this series doesn't carry) and NOT a duplicate of
// WorkspaceHeader's own snapshot-based change (a different, already-real
// figure sourced from MarketSnapshot). ChartHeader labels this explicitly
// as a range change so it is never confused with either.
import type { ChartCandle } from "@/types/chart-data";

export interface RangeChange {
  changeAbs: number;
  changePercent: number;
  direction: "up" | "down" | "neutral";
}

/** Pure, deterministic: derives a real change figure from the already-loaded candle range - never a fabricated or interpolated value. Returns undefined when there isn't at least one real interval to measure a change across, or when the reference price is exactly zero (division would be meaningless). */
export function computeRangeChange(candles: readonly ChartCandle[]): RangeChange | undefined {
  if (candles.length < 2) return undefined;
  const first = candles[0].open;
  const last = candles[candles.length - 1].close;
  if (first === 0) return undefined;
  const changeAbs = last - first;
  const changePercent = (changeAbs / first) * 100;
  const direction = changeAbs > 0 ? "up" : changeAbs < 0 ? "down" : "neutral";
  return { changeAbs, changePercent, direction };
}
