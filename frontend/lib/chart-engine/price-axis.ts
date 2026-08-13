// lib/chart-engine/price-axis.ts
// Sprint D2.7.2, Phase 9 - deterministic price axis tick generation. Same
// viewport always produces the same ticks (no randomness, no layout-
// dependent state). Decimal precision is derived from the tick step
// itself, never a hardcoded per-instrument value - the same logic serves
// forex (small step -> more decimals), crypto, equities, and indices
// (large step -> fewer decimals) without a lookup table.
import type { Viewport } from "./types";

const TARGET_TICK_COUNT = 5;
// The standard "nice number" tick algorithm (1/2/2.5/5/10 per decade) most
// charting/plotting libraries use for human-readable axis spacing, applied
// here to price rather than reinvented.
const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(rawStep: number): number {
  if (rawStep <= 0 || !Number.isFinite(rawStep)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const nice = NICE_STEPS.find((n) => residual <= n) ?? 10;
  return nice * magnitude;
}

export interface PriceAxisTick {
  price: number;
  /** Decimal places for this tick - shared across every tick on the axis so the column of numbers stays aligned (pairs with the .fin-num tabular-nums foundation from D2.7.1). */
  decimals: number;
}

// Sprint D2.7.6, Phase 5 - professionalization. The original fixed
// TARGET_TICK_COUNT (5) was correct for a normal desktop panel height but
// could crowd/overlap on a short panel (e.g. a collapsed sub-panel-heavy
// mobile layout) and left wide-desktop panels under-labeled. Real available
// vertical space now drives the count instead of a constant - MIN_TICK_
// SPACING_PX is a generous estimate for one 11px mono label plus breathing
// room, so labels never render closer together than they can be read.
const MIN_PRICE_TICK_SPACING_PX = 40;
const MIN_PRICE_TICK_COUNT = 2;
const MAX_PRICE_TICK_COUNT = 8;

/** Derives a sensible tick count from the price panel's real pixel height - never overlaps, never under-labels a tall panel. Callers pass the result into `computePriceTicks`'s existing `targetCount` param; omitting it preserves the original fixed-5 behavior for any caller that doesn't care. */
export function targetPriceTickCountForHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx) || heightPx <= 0) return TARGET_TICK_COUNT;
  const count = Math.floor(heightPx / MIN_PRICE_TICK_SPACING_PX);
  return Math.min(MAX_PRICE_TICK_COUNT, Math.max(MIN_PRICE_TICK_COUNT, count));
}

/** Ticks for the visible price range. Returns an empty array for a degenerate/invalid viewport (never fabricates a tick from bad bounds). */
export function computePriceTicks(viewport: Viewport, targetCount = TARGET_TICK_COUNT): PriceAxisTick[] {
  const { minPrice, maxPrice } = viewport;
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || maxPrice <= minPrice) return [];

  const rawStep = (maxPrice - minPrice) / targetCount;
  const step = niceStep(rawStep);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));

  const first = Math.ceil(minPrice / step) * step;
  const ticks: PriceAxisTick[] = [];
  for (let price = first; price <= maxPrice; price += step) {
    ticks.push({ price: Number(price.toFixed(10)), decimals });
  }
  return ticks;
}
