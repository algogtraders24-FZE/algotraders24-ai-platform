import { timeframeDurationMs } from "./timeframe-duration.js";
/**
 * Q0.6.3 — derives the parent bar's (open, close] window from its own
 * timestamp (the established close-instant convention) and its
 * timeframe's fixed duration. Deterministic, pure — no lookup, no state.
 */
export function parentBarIdentity(bar) {
    const durationMs = timeframeDurationMs(bar.timeframe);
    return {
        symbol: bar.instrument.symbol,
        timeframe: bar.timeframe,
        openTimestamp: bar.timestamp - durationMs,
        closeTimestamp: bar.timestamp,
    };
}
