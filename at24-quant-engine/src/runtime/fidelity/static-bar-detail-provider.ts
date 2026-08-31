import type { OHLCVBar, Timeframe } from "../../domain/market-data.js";
import type { BarDetailProvider, BarDetailQuery, BarDetailResult } from "../../domain/fidelity/bar-detail.js";
import { expectedChildCount, isValidChildTimeframe } from "./timeframe-duration.js";

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
export function createStaticBarDetailProvider(childBars: readonly OHLCVBar[], childTimeframe: Timeframe, providerId = "StaticBarDetailProvider"): BarDetailProvider {
  const sorted = [...childBars].sort((a, b) => a.timestamp - b.timestamp);

  return {
    providerId,
    getDetail(query: BarDetailQuery): BarDetailResult {
      if (query.childTimeframe !== childTimeframe) {
        return { status: "MISSING", bars: [], reason: `provider only holds "${childTimeframe}" data, "${query.childTimeframe}" was requested` };
      }
      const { openTimestamp, closeTimestamp } = query.parent;
      const inWindow = sorted.filter(
        (b) => b.instrument.symbol === query.parent.symbol && b.timestamp > openTimestamp && b.timestamp <= closeTimestamp,
      );

      if (inWindow.length === 0) {
        return { status: "MISSING", bars: [], reason: `no "${childTimeframe}" bars found in (${openTimestamp}, ${closeTimestamp}]` };
      }

      if (!isValidChildTimeframe(query.parent.timeframe, childTimeframe)) {
        return { status: "PARTIAL", bars: inWindow, reason: `"${childTimeframe}" is not an exact-multiple detail timeframe for parent "${query.parent.timeframe}"; coverage cannot be verified as complete` };
      }

      const expected = expectedChildCount(query.parent.timeframe, childTimeframe);
      if (inWindow.length < expected) {
        return { status: "PARTIAL", bars: inWindow, reason: `found ${inWindow.length}/${expected} expected "${childTimeframe}" bars for this parent interval` };
      }
      return { status: "COMPLETE", bars: inWindow };
    },
  };
}
