import type { SpreadModel } from "../../domain/reality-models.js";
/**
 * The two D1 spread implementations for Q0.5. The default simulation
 * configuration must never silently imply a realistic spread (Q0.5.13) —
 * a caller must explicitly choose ZeroSpread (and accept that choice) or
 * FixedSpread(value); there is no unlabeled default anywhere in the
 * orchestrator that falls back to either.
 */
export declare const ZeroSpread: SpreadModel & {
    readonly name: string;
};
export declare function createFixedSpread(value: number): SpreadModel & {
    readonly name: string;
};
