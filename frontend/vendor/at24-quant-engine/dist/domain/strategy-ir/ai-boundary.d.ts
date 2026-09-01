import type { Expression } from "../expression.js";
import type { RiskSpecification } from "../risk-specification.js";
import type { ExecutionSpecification } from "../execution-specification.js";
import type { Instrument, Timeframe } from "../market-data.js";
import type { IndicatorIR } from "./indicator-ir.js";
/**
 * Q0.7.46/47 — what an AI generator is allowed to hand to the compiler.
 * DELIBERATELY has NO confidence/probability/score field anywhere in this
 * shape (Q0.7.47's explicit rule) — an AI's degree of certainty about its
 * own output is never part of canonical execution semantics. AI output
 * MUST first become a StrategyIR (via compileAIStrategyToIR(), runtime/
 * strategy-ir/) — it is never submitted directly to the simulation engine
 * (ADR-004, restated here for the IR layer specifically).
 */
export interface AIStrategyCompilerInput {
    readonly intent: string;
    readonly instruments: readonly Instrument[];
    readonly timeframes: readonly Timeframe[];
    readonly indicators: readonly IndicatorIR[];
    readonly entryConditions: readonly {
        readonly direction: "BUY" | "SELL";
        readonly condition: Expression;
    }[];
    readonly exitConditions: readonly {
        readonly condition: Expression;
        readonly appliesTo?: "BUY" | "SELL";
    }[];
    readonly risk: RiskSpecification;
    readonly executionAssumptions: ExecutionSpecification;
}
