import type { OHLCVBar, Timeframe } from "../market-data.js";
import type { ParentBarIdentity } from "./parent-bar.js";

export interface BarDetailQuery {
  readonly parent: ParentBarIdentity;
  readonly childTimeframe: Timeframe;
}

export type DetailStatus = "COMPLETE" | "PARTIAL" | "MISSING";

/**
 * Q0.6.2 — the result of asking a BarDetailProvider for lower-timeframe
 * bars inside one parent interval. `bars` is ALWAYS the raw, unmodified
 * data the provider holds — never synthesized (Q0.6.6/Q0.6.38: no
 * synthetic bars, anywhere, ever).
 */
export type BarDetailResult =
  | { readonly status: "COMPLETE"; readonly bars: readonly OHLCVBar[] }
  | { readonly status: "PARTIAL"; readonly bars: readonly OHLCVBar[]; readonly reason: string }
  | { readonly status: "MISSING"; readonly bars: readonly []; readonly reason: string };

/**
 * The seam between "the engine needs lower-timeframe detail for this
 * parent bar" and "wherever that detail actually lives" (Q0.6.48 — not
 * coupled to any specific platform/broker/provider). `getDetail` MUST be
 * a pure function of its query and the provider's own fixed dataset —
 * never the wall clock, never randomness (Q0.6's determinism boundary
 * extends to this interface).
 */
export interface BarDetailProvider {
  readonly providerId: string;
  getDetail(query: BarDetailQuery): BarDetailResult;
}
