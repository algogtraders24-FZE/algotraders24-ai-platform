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
