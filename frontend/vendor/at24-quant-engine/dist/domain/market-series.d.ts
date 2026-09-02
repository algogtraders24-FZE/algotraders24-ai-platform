import type { Instrument, OHLCVBar, Timeframe } from "./market-data.js";
import { type ValidationResult } from "./validation-result.js";
/**
 * A validated, ordered sequence of bars for one instrument/timeframe.
 * Deliberately independent of market.db, any broker/provider API, or
 * M-Series — constructed only from in-memory bars (production data or
 * synthetic golden fixtures), per Q0.2.6.
 */
export interface MarketSeries {
    readonly instrument: Instrument;
    readonly timeframe: Timeframe;
    readonly bars: readonly OHLCVBar[];
}
/**
 * Checks chronological ordering (strictly increasing timestamps),
 * duplicate timestamps, per-bar instrument/timeframe consistency with the
 * series, and OHLC validity (high >= low, open/close within [low, high],
 * volume >= 0).
 */
export declare function validateMarketSeries(series: MarketSeries): ValidationResult;
/** Deterministic, explicit chronological iteration (bars are assumed pre-validated). */
export declare function iterateChronologically(series: MarketSeries): Generator<OHLCVBar>;
export interface TimestampGap {
    readonly afterIndex: number;
    readonly expectedIntervalMs: number;
    readonly actualIntervalMs: number;
}
/**
 * Informational only — NOT a validation failure. A gap wider than
 * `expectedIntervalMs` may be a legitimate weekend/holiday/session break,
 * not corrupt data, so this is reported for the caller to judge, never
 * thrown from validateMarketSeries().
 */
export declare function detectTimestampGaps(series: MarketSeries, expectedIntervalMs: number): readonly TimestampGap[];
