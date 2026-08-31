import type { Timeframe } from "../../domain/market-data.js";

/**
 * Q0.6.4/5 — fixed-duration timeframes only. "MN1" (calendar month) has
 * no fixed millisecond length, so it is deliberately excluded here and
 * cannot participate in parent/child detail relationships in Q0.6 — a
 * documented limitation (docs/Q0.6_MULTI_FIDELITY.md), not an oversight.
 */
const FIXED_DURATIONS_MS: Partial<Record<Timeframe, number>> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  M30: 1_800_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
  W1: 604_800_000,
};

export function timeframeDurationMs(tf: Timeframe): number {
  const d = FIXED_DURATIONS_MS[tf];
  if (d === undefined) {
    throw new Error(`timeframeDurationMs: "${tf}" has no fixed duration (MN1 is a calendar month) and cannot be used in a parent/child detail relationship`);
  }
  return d;
}

/**
 * Q0.6.5 — a DETERMINISTIC compatibility rule, not a hardcoded whitelist:
 * `child` is a valid detail timeframe for `parent` iff child is strictly
 * shorter AND parent's duration is an EXACT integer multiple of child's
 * (so every parent bar's window aligns cleanly on a child-bar boundary —
 * no fractional/overlapping child bars are ever possible).
 */
export function isValidChildTimeframe(parent: Timeframe, child: Timeframe): boolean {
  const parentMs = timeframeDurationMs(parent);
  const childMs = timeframeDurationMs(child);
  return childMs < parentMs && parentMs % childMs === 0;
}

/** The exact number of child bars a fully-covered parent interval must contain. */
export function expectedChildCount(parent: Timeframe, child: Timeframe): number {
  if (!isValidChildTimeframe(parent, child)) {
    throw new Error(`expectedChildCount: "${child}" is not a valid detail timeframe for parent "${parent}"`);
  }
  return timeframeDurationMs(parent) / timeframeDurationMs(child);
}
