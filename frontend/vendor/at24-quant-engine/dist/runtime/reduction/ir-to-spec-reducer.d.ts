import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { ReductionResult } from "../../domain/reduction/reduction-result.js";
/**
 * Q0.9.1/2 — a PURE function: `ir` (and every object reachable from it —
 * risk, execution, entries, exits) is read only, never mutated, never
 * returned by reference into a mutable shape. Q0.9.3/4's eligibility gate
 * (`checkReductionEligibility`) runs first and unconditionally — if it
 * finds even one blocking reason, this function returns `status:
 * "BLOCKED"` with NO `strategySpec` at all (Q0.9.2: the reducer must not
 * invent missing behavior — a blocked reduction has nothing to hand back
 * except why).
 */
export declare function reduceStrategyIRToSpec(ir: StrategyIR): ReductionResult;
