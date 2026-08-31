import type { Instrument, OHLCVBar, Timeframe } from "../../domain/market-data.js";
import type { ParentBarIdentity } from "../../domain/fidelity/parent-bar.js";
import type { BarDetailResult } from "../../domain/fidelity/bar-detail.js";
import type { IntrabarObservation, IntrabarSequence } from "../../domain/fidelity/intrabar-sequence.js";
import { validateMarketSeries } from "../../domain/market-series.js";
import { expectedChildCount, isValidChildTimeframe } from "./timeframe-duration.js";

/**
 * Q0.6.39 — data-integrity validation: reuses Q0.2's validateMarketSeries
 * (not a new validator) over the raw child bars before they are trusted
 * for reconstruction. A structurally invalid child bar (high < low, etc.)
 * fails loudly rather than silently producing a bogus fill/exit price.
 */
function validateChildBars(bars: readonly OHLCVBar[], instrument: Instrument, childTimeframe: Timeframe): void {
  const check = validateMarketSeries({ instrument, timeframe: childTimeframe, bars });
  if (!check.valid) {
    throw new Error(`reconstructIntrabarSequence: invalid child-bar data: ${check.errors.join("; ")}`);
  }
}

/**
 * Q0.6.6/7 — the BarMagnifier itself: turns a BarDetailResult into an
 * ordered IntrabarSequence. NEVER creates a bar that was not already in
 * `detailResult.bars` — no interpolation, no synthesis (Q0.6.38). If the
 * provider reported MISSING, the returned sequence has zero observations
 * and `coverage: "MISSING"`; the caller (multi-fidelity-engine.ts)
 * decides whether that is fatal (default) or falls back to parent-bar
 * granularity for this one parent (only if explicitly configured).
 */
export function reconstructIntrabarSequence(parent: ParentBarIdentity, instrument: Instrument, childTimeframe: Timeframe, detailResult: BarDetailResult): IntrabarSequence {
  const expectedCount = isValidChildTimeframe(parent.timeframe, childTimeframe) ? expectedChildCount(parent.timeframe, childTimeframe) : 0;

  if (detailResult.status === "MISSING") {
    return { parent, childTimeframe, observations: [], coverage: "MISSING", expectedCount };
  }

  validateChildBars(detailResult.bars, instrument, childTimeframe);

  const observations: IntrabarObservation[] = detailResult.bars.map((b) => ({
    childBarId: `${instrument.symbol}:${childTimeframe}:${b.timestamp}`,
    timestamp: b.timestamp,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));

  return { parent, childTimeframe, observations, coverage: detailResult.status, expectedCount };
}

/** Adapts one IntrabarObservation back into an OHLCVBar shape so Q0.5's fill-model functions can be reused verbatim. */
export function observationToBar(obs: IntrabarObservation, instrument: Instrument, timeframe: Timeframe): OHLCVBar {
  return { timestamp: obs.timestamp, instrument, timeframe, open: obs.open, high: obs.high, low: obs.low, close: obs.close, volume: obs.volume };
}
