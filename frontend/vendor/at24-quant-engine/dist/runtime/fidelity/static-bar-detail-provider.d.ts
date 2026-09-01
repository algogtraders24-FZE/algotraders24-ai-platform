import type { OHLCVBar, Timeframe } from "../../domain/market-data.js";
import type { BarDetailProvider } from "../../domain/fidelity/bar-detail.js";
/**
 * Q0.6.2 — an in-memory BarDetailProvider over a pre-loaded, fully
 * chronological child-bar array (e.g. every M5 bar for a symbol). This is
 * the reference implementation exercised by Q0.6's own tests; a future
 * sprint wiring a real data source implements the SAME BarDetailProvider
 * interface, never a parallel one (Q0.6.48).
 *
 * Filtering is by TIMESTAMP WINDOW ONLY — `(parent.openTimestamp,
 * parent.closeTimestamp]` — so a provider loaded with children spanning
 * MANY parent intervals (including future ones relative to the interval
 * being queried) structurally cannot leak a later parent's children into
 * an earlier query: the boundary check excludes them regardless of what
 * else is in the backing array (Q0.6.23/24).
 */
export declare function createStaticBarDetailProvider(childBars: readonly OHLCVBar[], childTimeframe: Timeframe, providerId?: string): BarDetailProvider;
