import type { Timeframe } from "../market-data.js";
import type { SimulationProvenance } from "../simulation/provenance.js";
import type { SimulationFidelity } from "./simulation-fidelity.js";
import type { DetailCoverage } from "./detail-coverage.js";
import type { FidelityQuality } from "./fidelity-quality.js";
/**
 * Q0.6.29 — additively extends Q0.5's frozen SimulationProvenance (never
 * modifies it: this is a NEW interface that `extends` it). Every field
 * Q0.5 already populates stays populated identically; these are the
 * fidelity-specific facts Q0.5 had no reason to know about.
 */
export interface MultiFidelityProvenance extends SimulationProvenance {
    readonly simulationFidelity: SimulationFidelity;
    readonly parentTimeframe: Timeframe;
    readonly detailTimeframe?: Timeframe;
    readonly detailProviderIdentity?: string;
    readonly detailCoverage: DetailCoverage;
    readonly fidelityQuality: FidelityQuality;
}
