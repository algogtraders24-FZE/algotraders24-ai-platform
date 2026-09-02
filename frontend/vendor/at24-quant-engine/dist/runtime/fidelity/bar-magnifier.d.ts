import type { Instrument, OHLCVBar, Timeframe } from "../../domain/market-data.js";
import type { ParentBarIdentity } from "../../domain/fidelity/parent-bar.js";
import type { BarDetailResult } from "../../domain/fidelity/bar-detail.js";
import type { IntrabarObservation, IntrabarSequence } from "../../domain/fidelity/intrabar-sequence.js";
/**
 * Q0.6.6/7 — the BarMagnifier itself: turns a BarDetailResult into an
 * ordered IntrabarSequence. NEVER creates a bar that was not already in
 * `detailResult.bars` — no interpolation, no synthesis (Q0.6.38). If the
 * provider reported MISSING, the returned sequence has zero observations
 * and `coverage: "MISSING"`; the caller (multi-fidelity-engine.ts)
 * decides whether that is fatal (default) or falls back to parent-bar
 * granularity for this one parent (only if explicitly configured).
 */
export declare function reconstructIntrabarSequence(parent: ParentBarIdentity, instrument: Instrument, childTimeframe: Timeframe, detailResult: BarDetailResult): IntrabarSequence;
/** Adapts one IntrabarObservation back into an OHLCVBar shape so Q0.5's fill-model functions can be reused verbatim. */
export declare function observationToBar(obs: IntrabarObservation, instrument: Instrument, timeframe: Timeframe): OHLCVBar;
