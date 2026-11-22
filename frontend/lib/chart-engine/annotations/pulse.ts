// lib/chart-engine/annotations/pulse.ts
// After an Analyze, ONE element of the result blinks for a moment so the eye lands on it: the fair value gap the trade plan enters from, else the
// fair value gap nearest to price, else the support / resistance level nearest to price. Pure functions (the canvas only reads the phase).
import type { ChartAnnotation, ZoneAnnotation } from "./types";

export const PULSE_MS = 3600;
const BLINK_MS = 600;
const STAGGER_MS = 80;
const MAX_DELAY_MS = 1200;

/** 0..1 brightness `t` ms after the reveal started, for an element that waits `delay` ms and then blinks `blinks` times, fading out at the end. */
export function pulsePhase(t: number, opts: { delay?: number; blinks?: number } = {}): number {
  const delay = opts.delay ?? 0;
  const blinks = opts.blinks ?? 4;
  const u = t - delay;
  const total = blinks * BLINK_MS;
  if (u < 0 || u >= total) return 0;
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * u) / BLINK_MS);
  const fade = Math.min(1, (total - u) / 300);
  return wave * fade;
}

/**
 * Every element of the fresh analysis flashes in turn (a short stagger by order), twice; the `primary` one (the plan's gap / nearest gap / nearest
 * support line) blinks four times. Returns a function id -> brightness for the given time since the reveal.
 */
export function makePulse(annotations: readonly ChartAnnotation[], primary: string | null): (id: string, t: number) => number {
  const order = new Map(annotations.map((a, i) => [a.id, i] as const));
  return (id, t) => {
    const i = order.get(id);
    if (i === undefined) return 0;
    return pulsePhase(t, { delay: Math.min(MAX_DELAY_MS, i * STAGGER_MS), blinks: id === primary ? 4 : 2 });
  };
}

const gap = (low: number, high: number, price: number) => (price < low ? low - price : price > high ? price - high : 0);

export function pickPulseTarget(annotations: readonly ChartAnnotation[], lastClose: number, planEntry?: number): string | null {
  const fvgs = annotations.filter((a): a is ZoneAnnotation => a.type === "zone" && a.kind === "fvg" && a.endTime === null);
  if (planEntry !== undefined) {
    const entryFvg = fvgs.find((z) => planEntry >= z.low - 1e-9 && planEntry <= z.high + 1e-9);
    if (entryFvg) return entryFvg.id;
  }
  if (fvgs.length > 0) {
    return [...fvgs].sort((x, y) => gap(x.low, x.high, lastClose) - gap(y.low, y.high, lastClose))[0].id;
  }
  const levels = annotations.filter((a) => a.type === "level");
  if (levels.length > 0) {
    return [...levels].sort((x, y) => Math.abs((x as { price: number }).price - lastClose) - Math.abs((y as { price: number }).price - lastClose))[0].id;
  }
  return null;
}
