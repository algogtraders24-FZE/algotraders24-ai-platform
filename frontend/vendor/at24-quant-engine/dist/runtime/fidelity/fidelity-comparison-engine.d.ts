import type { MultiFidelitySimulationResult } from "../../domain/fidelity/fidelity-simulation-result.js";
import type { FidelityComparison } from "../../domain/fidelity/fidelity-comparison.js";
/**
 * Q0.6.32-35 — compares two MultiFidelitySimulationResults produced from
 * the SAME bars/strategySpec/config (differing only in fidelity). Trades
 * are matched positionally: under NETTING, a finer fidelity can only
 * refine WHEN/AT-WHAT-PRICE an existing trade happened, never conjure an
 * unrelated trade ahead of another — index i of one ledger corresponds
 * to index i of the other for as long as both ledgers have that index.
 */
export declare function compareFidelities(baseline: MultiFidelitySimulationResult, compared: MultiFidelitySimulationResult): FidelityComparison;
