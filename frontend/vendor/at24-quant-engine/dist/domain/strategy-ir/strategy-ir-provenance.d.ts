import type { SourcePlatform, SemanticFidelity } from "./source.js";
import type { UnsupportedSemantic, ApproximationRecord } from "./unsupported.js";
/**
 * Q0.7.52 — StrategyIR-level provenance, distinct from (and never a
 * modification of) Q0.5/Q0.6's SimulationProvenance/MultiFidelityProvenance
 * (which describe a SIMULATION RUN's identity, not a STRATEGY
 * TRANSLATION's). A future sprint wiring a compiled StrategyIR into an
 * actual simulation would carry BOTH: this provenance describes "where
 * this StrategySpec's semantics came from," Q0.5/Q0.6's describes "how
 * this particular run executed it."
 */
export interface StrategyIRProvenance {
    readonly sourcePlatform: SourcePlatform;
    readonly sourceHash: string;
    readonly sourceVersion: string;
    readonly irVersion: string;
    readonly translationHash: string;
    readonly semanticStatus: SemanticFidelity;
    readonly unsupportedSemantics: readonly UnsupportedSemantic[];
    readonly approximations: readonly ApproximationRecord[];
}
