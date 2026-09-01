import type { OHLCVBar } from "../../domain/market-data.js";
import type { ParentBarIdentity } from "../../domain/fidelity/parent-bar.js";
/**
 * Q0.6.3 — derives the parent bar's (open, close] window from its own
 * timestamp (the established close-instant convention) and its
 * timeframe's fixed duration. Deterministic, pure — no lookup, no state.
 */
export declare function parentBarIdentity(bar: OHLCVBar): ParentBarIdentity;
