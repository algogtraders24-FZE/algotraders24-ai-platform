/**
 * The two D1 spread implementations for Q0.5. The default simulation
 * configuration must never silently imply a realistic spread (Q0.5.13) —
 * a caller must explicitly choose ZeroSpread (and accept that choice) or
 * FixedSpread(value); there is no unlabeled default anywhere in the
 * orchestrator that falls back to either.
 */
export const ZeroSpread = {
    name: "ZeroSpread",
    computeSpread: () => 0,
};
export function createFixedSpread(value) {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`FixedSpread: value must be a finite number >= 0, got ${value}`);
    }
    return {
        name: `FixedSpread(${value})`,
        computeSpread: () => value,
    };
}
