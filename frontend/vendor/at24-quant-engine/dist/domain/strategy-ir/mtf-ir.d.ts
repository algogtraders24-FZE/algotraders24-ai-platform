import type { Timeframe } from "../market-data.js";
/** Q0.7.19 — which role a timeframe plays for this strategy. Multiple series may share a role in principle, but EXECUTION is always exactly one timeframe (matches Q0.5's single-timeframe SimulationConfig). */
export type TimeframeRole = "EXECUTION" | "SIGNAL" | "HIGHER" | "LOWER";
/**
 * Q0.7.20 — CANONICAL RULE (CRITICAL, restated from Q0.4_LOOKAHEAD_REPAINTING.md's
 * HTF-leakage section): an HTF observation becomes available to a
 * lower-timeframe evaluation only at the instant the HTF bar CLOSES,
 * never before. `HTF_OPEN_AVAILABLE`/`INTRABAR_AVAILABLE` exist ONLY to
 * let a translator RECORD that a source platform's construct claims
 * earlier availability (so it can be flagged UNSUPPORTED/BLOCKING, per
 * Q0.7.21) — they are never a validator-approved execution mode.
 */
export type HTFAvailabilityPolicy = "HTF_CLOSE_AVAILABLE" | "HTF_OPEN_AVAILABLE" | "INTRABAR_AVAILABLE";
/** Q0.7.19 — how a lower-timeframe evaluation instant maps onto a higher-timeframe series' own bar boundaries. */
export type AlignmentPolicy = "CLOSE_ALIGNED" | "OPEN_ALIGNED" | "CUSTOM";
export interface SeriesAvailability {
    readonly timeframe: Timeframe;
    readonly role: TimeframeRole;
    readonly availabilityPolicy: HTFAvailabilityPolicy;
    readonly alignmentPolicy: AlignmentPolicy;
}
/**
 * Q0.7.21 — semantic representation for Pine-style `request.security()`
 * calls, WITHOUT a Pine parser (explicitly deferred). `lookahead` mirrors
 * Pine's own `barmerge.lookahead_on`/`lookahead_off` parameter — recorded
 * so a validator can reject `lookahead_on` outright (it is the unsafe
 * direction Q0.4 researched and AT24 never adopts as an execution mode,
 * only as a recorded, always-BLOCKING source fact) rather than silently
 * treating it as equivalent to `lookahead_off`.
 */
export interface RequestSecurityCapability {
    readonly sourceTimeframe: Timeframe;
    readonly requestedTimeframe: Timeframe;
    readonly lookahead: "ON" | "OFF";
    readonly gapsFilled: boolean;
    readonly confirmedOnly: boolean;
}
/**
 * Q0.7.38's "execution compatibility" result shape for the IR validator
 * specifically (distinct from execution-compatibility.ts's
 * ExecutionCompatibilityReport, which checks against the SIMULATION
 * ENGINE's capabilities — this one is the validator's own pass/fail
 * verdict). `executionEligible` is FALSE whenever `blockingReasons` is
 * non-empty, even if `valid` is true — Q0.7.22's explicit rule that a
 * strategy with unresolved repainting semantics (or any other BLOCKING
 * unsupported semantic) must never receive a clean "validated for
 * execution" status, independent of whether it is otherwise
 * structurally well-formed.
 */
export interface IRValidationResult {
    readonly valid: boolean;
    readonly errors: readonly string[];
    readonly executionEligible: boolean;
    readonly blockingReasons: readonly string[];
}
