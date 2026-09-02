import type { Timeframe } from "../market-data.js";
import type { ParentBarIdentity } from "./parent-bar.js";
import type { DetailStatus } from "./bar-detail.js";
/** One child (lower-timeframe) bar, reconstructed from a BarDetailProvider — never synthesized. */
export interface IntrabarObservation {
    readonly childBarId: string;
    readonly timestamp: number;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;
}
/**
 * Q0.6.6/7 — the reconstructed intrabar path for one parent bar, in
 * strict chronological order. `coverage` reflects whether every expected
 * child bar was present (`COMPLETE`), some were missing (`PARTIAL`), or
 * none were available (`MISSING`). Ambiguity WITHIN a single observation
 * (both SL and TP reachable inside one child bar's own OHLC) is never
 * resolved here — this type only carries the raw sequence; resolution is
 * runtime/fidelity/intrabar-fill.ts's job, and it preserves ambiguity
 * rather than silently upgrading fidelity.
 */
export interface IntrabarSequence {
    readonly parent: ParentBarIdentity;
    readonly childTimeframe: Timeframe;
    readonly observations: readonly IntrabarObservation[];
    readonly coverage: DetailStatus;
    readonly expectedCount: number;
}
