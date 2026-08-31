import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { StrategyCompilationResult } from "../../domain/reduction/compilation-result.js";
import type { ReductionResult } from "../../domain/reduction/reduction-result.js";
import { validateStrategyIR } from "../strategy-ir/ir-validator.js";
import { computeExecutionCompatibility } from "../strategy-ir/execution-compatibility-engine.js";
import { computeCanonicalIRHash } from "../strategy-ir/ir-hash.js";
import { computeSemanticStrategyHash } from "../identity.js";
import { computeCanonicalHash } from "../determinism.js";
import { reduceStrategyIRToSpec } from "./ir-to-spec-reducer.js";

/**
 * Q0.9.31 — bumped whenever the REDUCTION RULES change (not the IR
 * schema — that is `STRATEGY_IR_VERSION`, Q0.7 — and not the simulation
 * engine — that is Q0.5/Q0.6's own `RUNTIME_VERSION`). A future sprint
 * relaxing or tightening `checkReductionEligibility()`'s rules bumps
 * this, so two compilations of the IDENTICAL IR under different reducer
 * rules are never mistaken for the same compilation.
 */
export const REDUCER_VERSION = "0.1.0";

/**
 * Q0.9.31 — deterministic, includes only semantic facts: the IR's own
 * canonical hash (Q0.7, unmodified), the reduced StrategySpec's semantic
 * hash (Q0.2's `computeSemanticStrategyHash`, reused — `null` when
 * BLOCKED, itself a semantic fact), the reducer version, and the
 * resulting status. Excludes timestamps, random ids, and any other
 * non-semantic metadata — there are none here to exclude in the first
 * place, since every input already went through the same discipline
 * upstream (Q0.7's `computeCanonicalIRHash` already excludes
 * `strategyId`/`metadata`).
 */
export function computeCompilationHash(ir: StrategyIR, reduction: ReductionResult): string {
  const irHash = computeCanonicalIRHash(ir);
  const specHash = reduction.strategySpec ? computeSemanticStrategyHash(reduction.strategySpec) : null;
  return computeCanonicalHash({ irHash, specHash, reducerVersion: REDUCER_VERSION, status: reduction.status });
}

/**
 * Q0.9.30 — the single orchestrator: IR validation (Q0.7, unmodified) +
 * execution compatibility (Q0.7, unmodified) + reduction
 * (`reduceStrategyIRToSpec`, this sprint) + a deterministic hash tying
 * all three together. Never calls into Q0.5/Q0.6's simulation engine
 * itself — that boundary is `simulation-adapter.ts`'s `compileToSimulation()`,
 * kept deliberately separate so compiling a strategy never implicitly
 * requires having market data on hand.
 */
export function compileStrategy(ir: StrategyIR, targetFidelity: SimulationFidelity = "D1_OHLC"): StrategyCompilationResult {
  const validationReport = validateStrategyIR(ir);
  const compatibilityReport = computeExecutionCompatibility(ir, targetFidelity);
  const reductionReport = reduceStrategyIRToSpec(ir);
  const resultHash = computeCompilationHash(ir, reductionReport);

  return {
    ir,
    ...(reductionReport.strategySpec !== undefined ? { strategySpec: reductionReport.strategySpec } : {}),
    reductionReport,
    validationReport,
    compatibilityReport,
    resultHash,
  };
}
