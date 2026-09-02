import type { MarketSeries } from "../domain/market-series.js";
import type { OHLCVBar } from "../domain/market-data.js";
/**
 * Enforces point-in-time access over a MarketSeries: at cursor time T,
 * only bars with timestamp <= T are visible. This is a safety primitive,
 * NOT a backtester (Q0.2.7) — it never simulates signals, orders, or
 * fills, it only answers "what data may logic see right now."
 *
 * `availableBars()` is a pure filter over the series' bars — deterministic
 * by construction, so `reset()` followed by the same `advanceTo()` calls
 * always reproduces identical results. Deliberately O(n) per call rather
 * than binary-search-optimized: correctness first (Q0.2.22), the series
 * sizes used in research/testing don't warrant the added complexity yet.
 */
export declare class TimeFrontier {
    private readonly series;
    private cursor;
    constructor(series: MarketSeries, initialCursor?: number);
    advanceTo(timestamp: number): void;
    reset(initialCursor?: number): void;
    currentCursor(): number;
    availableBars(): readonly OHLCVBar[];
}
