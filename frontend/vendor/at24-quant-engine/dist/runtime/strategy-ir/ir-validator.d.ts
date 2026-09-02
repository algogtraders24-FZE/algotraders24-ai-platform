import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { IRValidationResult } from "../../domain/strategy-ir/mtf-ir.js";
/**
 * Q0.7.37/38 — the full validation pipeline: structural validity
 * (domain/strategy-ir/strategy-ir.ts's validateStrategyIRStructure)
 * first, then the semantic checks Q0.7.38 enumerates (MTF/lookahead,
 * repainting, unsupported semantics — timezone/symbols/timeframes/
 * indicators/parameters/conditions/orders/risk/execution are already
 * covered by the structural pass, since RiskSpecification/Expression
 * validation is reused directly, never reimplemented).
 *
 * `executionEligible` is the Q0.7.22-mandated distinction: a
 * STRUCTURALLY valid IR (no errors) can still be execution-INELIGIBLE
 * if repainting is unresolved or a BLOCKING unsupported semantic exists
 * — "valid" and "safe to execute" are deliberately different questions.
 */
export declare function validateStrategyIR(ir: StrategyIR): IRValidationResult;
