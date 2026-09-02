import type { SourcePlatform } from "./source.js";
/**
 * Q0.12.1/2/3/4/5/6 — the dedicated pending-order-fill contract this
 * sprint adds. Every field is either a closed enum (when the research
 * genuinely supports a firm classification) or a documentation string
 * (when the honest answer is platform/broker-dependent detail rather
 * than a clean category) — never a guessed enum value where the
 * evidence doesn't support one. `UNKNOWN` is a real, first-class value
 * here, not an omission: Q0.4's own research did not pin down every
 * platform's exact pending-order touch/penetration behavior with the
 * same confidence as, say, Pine's documented default — marking those
 * `UNKNOWN` is the honest answer, not a gap to silently fill in.
 */
export type LimitFillStrictness = "TOUCH_SUFFICIENT" | "PENETRATION_REQUIRED" | "UNKNOWN";
export type StopTriggerStrictness = "TOUCH_TRIGGER" | "PENETRATION_TRIGGER" | "TICK_DEPENDENT" | "BAR_APPROXIMATION" | "UNKNOWN";
export type GapThroughModel = "FILL_AT_TRIGGER" | "FILL_AT_OPEN" | "FILL_AT_AVAILABLE_PRICE" | "UNRESOLVED";
export type BidAskRequirement = "NOT_REQUIRED" | "REQUIRED" | "OPTIONAL" | "UNKNOWN";
export type HistoricalExecutionModel = "BAR" | "INTRABAR" | "TICK" | "LOWER_TIMEFRAME_RECONSTRUCTION" | "BROKER_SIDE_SIMULATION" | "PLATFORM_SPECIFIC_SYNTHETIC" | "UNKNOWN";
export interface PendingOrderFillSemantics {
    readonly limitTouchBehavior: LimitFillStrictness;
    /** Free text: what "penetration" means when required (e.g. "N ticks past the level", "any nonzero amount", "unspecified — broker/version-dependent"). */
    readonly limitPenetrationBehavior: string;
    readonly stopTriggerBehavior: StopTriggerStrictness;
    readonly gapThroughBehavior: GapThroughModel;
    /** Free text: is the fill price ever claimed to equal the trigger/limit level exactly, or does the platform document/imply a possible divergence (e.g. slippage, gap)? */
    readonly triggerFillRelationship: string;
    readonly historicalExecutionModel: HistoricalExecutionModel;
    readonly bidAskRequirement: BidAskRequirement;
    /** Free text: what intrabar detail (if any) the platform's own backtester can use, and any documented caps/limitations on it. */
    readonly intrabarRequirement: string;
}
/**
 * Q0.7.40 — a SEMANTIC REFERENCE, not a parser implementation (explicitly
 * out of scope). Every cell below is a real, cited fact reused from
 * Q0.4's actual platform research (docs/Q0.4_PLATFORM_R&D.md,
 * docs/Q0.4_PLATFORM_DECISIONS.md, docs/Q0.4_PINE_SEMANTICS.md) — this
 * file does not invent platform behavior, it structures what was already
 * researched into a queryable shape for the IR validator and translators.
 *
 * Q0.12 CONTRACT CHANGE (additive field, all six existing entries
 * updated): added `pendingOrderFill` — no existing field's value or
 * meaning changed.
 */
export interface PlatformSemanticProfile {
    readonly platform: SourcePlatform;
    readonly accountMode: string;
    readonly orderModel: string;
    readonly positionModel: string;
    readonly barTiming: string;
    readonly mtf: string;
    readonly repainting: string;
    readonly slTp: string;
    readonly trailing: string;
    readonly partialClose: string;
    readonly sessions: string;
    readonly timezone: string;
    readonly fees: string;
    readonly spread: string;
    readonly slippage: string;
    readonly intrabar: string;
    readonly historicalRealtime: string;
    readonly pendingOrderFill: PendingOrderFillSemantics;
}
export declare const PLATFORM_SEMANTIC_MATRIX: readonly PlatformSemanticProfile[];
export declare function getPlatformProfile(platform: SourcePlatform): PlatformSemanticProfile | undefined;
/**
 * Q0.12.13 — bumped whenever ANY execution-semantic rule in
 * `PLATFORM_SEMANTIC_MATRIX` changes (a field's value, a new field, or a
 * reclassification of an existing platform) — never bumped for pure
 * prose/wording edits that don't change a documented semantic claim.
 */
export declare const PLATFORM_SEMANTIC_PROFILE_VERSION = "1.0.0";
/**
 * Q0.12.13/38 — a single canonical hash over the ENTIRE semantic matrix
 * plus its version, so that changing any platform's execution semantics
 * (including adding a new platform) changes this hash deterministically.
 * Reused wherever a result's provenance needs to prove WHICH semantic
 * understanding of the source platform was in effect (Q0.12.41) —
 * never a second, divergent hash of the same concept.
 */
export declare function computeSemanticProfileHash(): string;
