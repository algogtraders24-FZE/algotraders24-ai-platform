import type { SourcePlatform } from "./source.js";
/** Q0.7.50 — how a single observed difference between two platforms' translated IR is classified. */
export type ParityDifferenceCategory = "EXACT_PARITY" | "SEMANTIC_PARITY" | "EXECUTION_DIFFERENCE" | "DATA_DIFFERENCE" | "PLATFORM_DIFFERENCE" | "UNSUPPORTED" | "UNKNOWN";
export interface ParityFeatureDiff {
    readonly feature: string;
    readonly category: ParityDifferenceCategory;
    readonly leftValue: string;
    readonly rightValue: string;
    readonly note?: string;
}
/**
 * Q0.7.49 — the result of translating equivalent source strategies from
 * two platforms into AT24 IR and comparing them feature-by-feature. Any
 * difference must be explicitly reported (Q0.7.49's explicit rule) — a
 * ParityReport with zero `differences` is the only honest way to claim
 * two platforms' strategies are equivalent.
 */
export interface ParityReport {
    readonly leftPlatform: SourcePlatform;
    readonly rightPlatform: SourcePlatform;
    readonly leftIrHash: string;
    readonly rightIrHash: string;
    readonly identical: boolean;
    readonly differences: readonly ParityFeatureDiff[];
}
