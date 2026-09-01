import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { ParityReport } from "../../domain/strategy-ir/parity.js";
/**
 * Q0.7.49/50 — feature-by-feature structural comparison between two IRs
 * translated from (presumably) equivalent source strategies on two
 * platforms. Every difference is reported explicitly (Q0.7.49's rule) —
 * this function never collapses "probably fine" differences silently.
 * Categorization is a simple, deterministic rule set, not a similarity
 * score: EXECUTION_DIFFERENCE for anything touching how orders/positions
 * behave, PLATFORM_DIFFERENCE for anything touching bar-timing/
 * repainting/sessions/timezone (platform-behavior facts, not strategy
 * logic), DATA_DIFFERENCE for indicator/series inputs, SEMANTIC_PARITY
 * when both sides are non-empty but structurally different in a way this
 * function cannot further classify, UNSUPPORTED when either side has a
 * BLOCKING unsupported semantic touching the feature.
 */
export declare function compareParity(left: StrategyIR, right: StrategyIR): ParityReport;
