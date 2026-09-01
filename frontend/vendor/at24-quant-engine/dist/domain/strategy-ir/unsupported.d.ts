import type { SourceLocation } from "./source.js";
/** Q0.7.31 — BLOCKING means the strategy cannot be safely executed at all; WARNING/INFO are advisory. */
export type UnsupportedSeverity = "INFO" | "WARNING" | "BLOCKING";
export interface UnsupportedSemantic {
    readonly feature: string;
    readonly sourceLocation?: SourceLocation;
    readonly reason: string;
    readonly severity: UnsupportedSeverity;
    readonly executionImpact: string;
}
/**
 * Q0.7.32 — an explicit, NEVER-hidden record of a best-effort substitution.
 * `original` describes the source construct; `replacement` describes
 * AT24's closest supported equivalent; `difference`/`impact` are required,
 * not optional, so an approximation can never be recorded without saying
 * what it cost.
 */
export interface ApproximationRecord {
    readonly feature: string;
    readonly original: string;
    readonly replacement: string;
    readonly difference: string;
    readonly impact: string;
    readonly sourceLocation?: SourceLocation;
}
