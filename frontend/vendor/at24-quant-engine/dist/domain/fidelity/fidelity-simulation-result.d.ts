import type { SimulationResult } from "../simulation/simulation-result.js";
import type { MultiFidelityProvenance } from "./fidelity-provenance.js";
/**
 * Q0.6.30 — a SimulationResult whose `provenance` is the fidelity-aware
 * superset. Since `provenance` genuinely differs field-for-field between
 * fidelities (simulationFidelity, detailCoverage, fidelityQuality all
 * vary), `resultHash` (computed the same way as Q0.5's, over every field
 * except itself) necessarily differs across D1/D2/D3 even when the
 * underlying trades happen to be priced identically.
 */
export interface MultiFidelitySimulationResult extends SimulationResult {
    readonly provenance: MultiFidelityProvenance;
}
