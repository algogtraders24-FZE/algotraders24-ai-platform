// lib/chart-engine/viewport.ts
// Sprint D2.7.2, Phase 7 - the viewport model: visible time range, the
// price range that fits it, pan, zoom, fit-to-data. Vertical price range
// auto-fits whatever candles are currently horizontally visible (recomputed
// after every pan/zoom via priceRangeForWindow) rather than being
// independently pannable in this foundation - the same behavior most
// candlestick charts default to, and a deliberate v1 scope decision (no
// independent vertical pan/zoom yet - a real future enhancement, not an
// oversight; see the sprint spec's known limitations).
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";

const DEFAULT_PRICE_PADDING_PCT = 0.08;
const DEFAULT_TIME_PADDING_CANDLES = 2;
const MIN_VISIBLE_CANDLES = 5;
const MAX_VISIBLE_CANDLES = 2000;

/** The real spacing between consecutive candles, derived from the data itself - never a hardcoded per-timeframe constant (Phase 6's "no hardcoded dimensions"). Falls back to 1 minute only when there are fewer than 2 candles to measure a real step from (used solely as a padding unit in that edge case, never presented as real data). */
export function candleStepMs(candles: readonly ChartCandle[]): number {
  if (candles.length < 2) return 60_000;
  return candles[1].time - candles[0].time;
}

function padRange(low: number, high: number, paddingPct: number): { minPrice: number; maxPrice: number } {
  if (high === low) {
    const pad = Math.abs(high) * paddingPct || 1;
    return { minPrice: low - pad, maxPrice: high + pad };
  }
  const span = high - low;
  const pad = span * paddingPct;
  return { minPrice: low - pad, maxPrice: high + pad };
}

/**
 * Auto min/max price across only the candles whose time falls within
 * [minTime, maxTime] (Phase 9's "auto min/max", kept in sync with the
 * horizontal window on every pan/zoom). A window with zero visible
 * candles falls back to the full series' range rather than collapsing to
 * a degenerate 0..1 range mid-interaction (e.g. panning past the data's
 * edge).
 */
export function priceRangeForWindow(
  candles: ChartCandle[],
  minTime: number,
  maxTime: number,
  paddingPct = DEFAULT_PRICE_PADDING_PCT,
): { minPrice: number; maxPrice: number } {
  const visible = candles.filter((c) => c.time >= minTime && c.time <= maxTime);
  const source = visible.length > 0 ? visible : candles;
  if (source.length === 0) return { minPrice: 0, maxPrice: 1 };
  const low = Math.min(...source.map((c) => c.low));
  const high = Math.max(...source.map((c) => c.high));
  return padRange(low, high, paddingPct);
}

/** The initial viewport for a freshly loaded series: the full candle range, padded by a couple of candle-widths so the most recent candle isn't flush against the right edge. An empty series returns a neutral, honest 1-hour/0..1 placeholder viewport - never a fabricated data range. */
export function fitToData(candles: ChartCandle[]): Viewport {
  if (candles.length === 0) {
    const now = Date.now();
    return { minTime: now - 60 * 60_000, maxTime: now, minPrice: 0, maxPrice: 1 };
  }
  const step = candleStepMs(candles);
  const minTime = candles[0].time;
  const maxTime = candles[candles.length - 1].time + step * DEFAULT_TIME_PADDING_CANDLES;
  const { minPrice, maxPrice } = priceRangeForWindow(candles, minTime, maxTime);
  return { minTime, maxTime, minPrice, maxPrice };
}

/** Horizontal pan by a real time delta (the caller converts a pixel drag distance to milliseconds via the plot width / visible span ratio) - shifts both bounds together, so span (zoom level) is unaffected by a pan. */
export function panViewport(viewport: Viewport, deltaMs: number): Viewport {
  return { ...viewport, minTime: viewport.minTime + deltaMs, maxTime: viewport.maxTime + deltaMs };
}

/**
 * Zooms the horizontal span around `anchorTime` (the real time under the
 * mouse cursor) by `factor` (<1 zooms in, >1 zooms out). Clamped by
 * `stepMs`-derived candle-count bounds (MIN/MAX_VISIBLE_CANDLES) so a user
 * can never zoom into a degenerate zero-width span or out past a
 * meaningless one.
 */
export function zoomViewport(viewport: Viewport, factor: number, anchorTime: number, stepMs: number): Viewport {
  const span = viewport.maxTime - viewport.minTime;
  const minSpan = stepMs * MIN_VISIBLE_CANDLES;
  const maxSpan = stepMs * MAX_VISIBLE_CANDLES;
  const nextSpan = Math.min(Math.max(span * factor, minSpan), maxSpan);
  const anchorRatio = span === 0 ? 0.5 : (anchorTime - viewport.minTime) / span;
  const minTime = anchorTime - nextSpan * anchorRatio;
  const maxTime = minTime + nextSpan;
  return { ...viewport, minTime, maxTime };
}

// Sprint D2.7.3, Phase 5 - the visible-range/live-edge model. A user is
// considered "at the right edge" when the viewport's own right bound is
// within one candle-step of the latest real candle - a small, deliberate
// tolerance (not an exact equality check) so the D2.7.2 fitToData()
// padding (which already puts the right edge a couple of candle-widths
// past the last real candle) still counts as "at the edge" rather than
// permanently reading as "manually panned away".
const RIGHT_EDGE_TOLERANCE_CANDLES = 3;

/**
 * True when the viewport's right bound reaches at least close to the
 * latest candle. Deliberately a one-sided check (`>=`, not a symmetric
 * "within N candles either side"): a viewport whose right edge is well
 * BEFORE the latest candle means real, newer data is sitting off-screen -
 * the user has panned back and "follow latest" must not apply. A viewport
 * whose right edge is AT or AFTER the latest candle (including
 * fitToData()'s own padding past it) is always "at the edge", however far
 * past - there is no newer data being hidden in that direction.
 */
export function isAtRightEdge(viewport: Viewport, candles: ChartCandle[]): boolean {
  const latest = candles[candles.length - 1];
  if (!latest) return true; // no data yet - nothing to have panned away from
  const step = candleStepMs(candles);
  return viewport.maxTime >= latest.time - step * RIGHT_EDGE_TOLERANCE_CANDLES;
}

/**
 * Shifts the viewport (preserving its current span/zoom level) so its
 * right edge follows the latest candle again - used only when the user
 * was already at the right edge before new data arrived (see NativeChart's
 * `useEffect` on `candles`). Never called when the user has manually
 * panned backward - D2.7.3's own "do NOT forcibly move the viewport"
 * requirement.
 */
export function followLatest(viewport: Viewport, candles: ChartCandle[]): Viewport {
  const latest = candles[candles.length - 1];
  if (!latest) return viewport;
  const step = candleStepMs(candles);
  const span = viewport.maxTime - viewport.minTime;
  const maxTime = latest.time + step * DEFAULT_TIME_PADDING_CANDLES;
  return { ...viewport, minTime: maxTime - span, maxTime };
}

/**
 * Sprint D2.7.7, Phase 2 - keeps a panned/zoomed viewport from drifting into
 * a permanently "candle-free" void ("panning must respect available candle
 * bounds"). Deliberately NOT applied inside panViewport/zoomViewport
 * themselves (both stay pure, unclamped, exactly as D2.7.2's own tests
 * already lock in) - this is a separate, additive function the interaction
 * layer (NativeChart.tsx) applies to the RESULT of a pan/zoom, the same
 * "compose pure functions at the call site" pattern applyViewport already
 * uses for priceRangeForWindow.
 *
 * The rule: the real data's oldest candle can never be pushed further than
 * the viewport's OWN current span past the near edge, and likewise for the
 * latest candle on the other side - i.e. panning back stops once the oldest
 * candle would reach the RIGHT edge of the view, and panning forward stops
 * once the latest candle would reach the LEFT edge. A real candle is always
 * at least reachable at the boundary, never scrolled entirely out of a
 * theoretically-infinite empty timeline. Span (zoom level) is always
 * preserved when clamping - this only ever changes WHERE the user is
 * allowed to look, never how zoomed in they are.
 */
export function clampViewportToCandleBounds(viewport: Viewport, candles: ChartCandle[]): Viewport {
  if (candles.length === 0) return viewport;
  const span = viewport.maxTime - viewport.minTime;
  const earliest = candles[0].time;
  const latest = candles[candles.length - 1].time;
  const minAllowed = earliest - span;
  const maxAllowed = latest + span;

  let { minTime, maxTime } = viewport;
  if (minTime < minAllowed) {
    minTime = minAllowed;
    maxTime = minAllowed + span;
  }
  if (maxTime > maxAllowed) {
    maxTime = maxAllowed;
    minTime = maxAllowed - span;
  }
  return { ...viewport, minTime, maxTime };
}
