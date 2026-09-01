import type { Timeframe } from "../market-data.js";
/**
 * Identifies the interval a parent (higher-timeframe) bar covers, as a
 * half-open-left / closed-right window `(openTimestamp, closeTimestamp]`
 * — consistent with the established convention (Q0.5, TimeFrontier) that
 * `OHLCVBar.timestamp` is the bar's CLOSE instant. A child bar belongs to
 * this parent iff `openTimestamp < child.timestamp <= closeTimestamp`.
 */
export interface ParentBarIdentity {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly openTimestamp: number;
    readonly closeTimestamp: number;
}
