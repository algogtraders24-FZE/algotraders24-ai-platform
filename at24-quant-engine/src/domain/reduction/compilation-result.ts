import type { StrategyIR } from "../strategy-ir/strategy-ir.js";
import type { StrategySpec } from "../strategy-spec.js";
import type { IRValidationResult } from "../strategy-ir/mtf-ir.js";
import type { ExecutionCompatibilityReport } from "../strategy-ir/execution-compatibility.js";
import type { ReductionResult } from "./reduction-result.js";
import type { SimulationFidelity } from "../fidelity/simulation-fidelity.js";
import type { MultiFidelityProvenance } from "../fidelity/fidelity-provenance.js";

/**
 * Q0.9.30 — the full record of one IR->StrategySpec compilation attempt.
 * `strategySpec` mirrors `reductionReport.strategySpec` (present iff the
 * reduction was not BLOCKED) — kept as its own top-level field so a
 * caller never has to reach into the reduction report just to check
 * "did this compile."
 */
export interface StrategyCompilationResult {
  readonly ir: StrategyIR;
  readonly strategySpec?: StrategySpec;
  readonly reductionReport: ReductionResult;
  readonly validationReport: IRValidationResult;
  readonly compatibilityReport: ExecutionCompatibilityReport;
  readonly resultHash: string;
}

/**
 * Q0.9.45 — the record of actually RUNNING a successfully-compiled
 * strategy through the simulation engine (Q0.5/Q0.6). `compilationHash`
 * ties this back to the exact `StrategyCompilationResult` that produced
 * the `StrategySpec` being executed.
 */
export interface CompilationSimulationResult {
  readonly compilationHash: string;
  readonly strategySpecHash: string;
  readonly simulationResultHash: string;
  readonly fidelity: SimulationFidelity;
  readonly provenance: MultiFidelityProvenance;
}
