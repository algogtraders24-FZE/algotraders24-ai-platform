import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { ExecutionCompatibilityReport } from "../../domain/strategy-ir/execution-compatibility.js";
/**
 * Q0.7.39 — checks a StrategyIR's declared features against what
 * `runtime/simulation/simulation-engine.ts` (Q0.5, frozen) and
 * `runtime/fidelity/multi-fidelity-engine.ts` (Q0.6, frozen) actually
 * implement TODAY. Every row below traces to a specific, documented
 * fact from those sprints' own docs (docs/Q0.5_EXECUTION_MODEL.md,
 * docs/Q0.5_POSITION_ACCOUNT.md, docs/Q0.6_D2_D3_EXECUTION.md) — this
 * function does not guess engine capability, it encodes what those
 * sprints already documented as shipped vs. a known limitation.
 */
export declare function computeExecutionCompatibility(ir: StrategyIR, targetFidelity: SimulationFidelity): ExecutionCompatibilityReport;
