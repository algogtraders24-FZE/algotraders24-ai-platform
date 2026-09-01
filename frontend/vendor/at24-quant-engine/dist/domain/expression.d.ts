import type { IndicatorReference } from "./indicator-reference.js";
import { type SeriesOffsetRef } from "./strategy-ir/series.js";
import { type ValidationResult } from "./validation-result.js";
export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==" | "!=" | "cross_above" | "cross_below";
export type LogicalOperator = "AND" | "OR" | "NOT";
/**
 * Q0.7.7/8 (additive, Q0/Q0.2 UNCHANGED): the "indicator" and "literal"
 * variants and their existing shapes are exactly as Q0.2 froze them — no
 * existing field changed meaning, no existing code path is affected. A
 * NEW "series" variant is added for raw price-series references with an
 * explicit bar offset (`Close[1]`, never an implicit array index — see
 * strategy-ir/series.ts). `indicator`'s existing `ref` field carries no
 * offset itself; a Strategy IR wanting `EMA[1]` uses `indicatorOperand()`
 * unchanged for `EMA[0]` (the existing, only-ever-supported behavior) or
 * builds a comparison against `previousIndicatorValues` (Q0.2's existing
 * mechanism) — this file does not need an indicator-offset variant of its
 * own because that mechanism already exists and is reused, not duplicated.
 */
export type Operand = {
    readonly kind: "indicator";
    readonly ref: IndicatorReference;
} | {
    readonly kind: "literal";
    readonly value: number | boolean;
} | {
    readonly kind: "series";
    readonly ref: SeriesOffsetRef;
};
export interface ComparisonExpression {
    readonly type: "comparison";
    readonly operator: ComparisonOperator;
    readonly left: Operand;
    readonly right: Operand;
}
export interface LogicalExpression {
    readonly type: "logical";
    readonly operator: LogicalOperator;
    readonly operands: readonly Expression[];
}
/** A bare boolean-valued indicator used directly as a condition, e.g. `Breakout == true`. */
export interface BooleanReferenceExpression {
    readonly type: "boolean-reference";
    readonly ref: IndicatorReference;
}
export type Expression = ComparisonExpression | LogicalExpression | BooleanReferenceExpression;
export declare function literal(value: number | boolean): Operand;
export declare function indicatorOperand(ref: IndicatorReference): Operand;
/** Q0.7.8 (additive): a raw price-series operand at an explicit bar offset — e.g. `seriesOperand("CLOSE", 1)` for `Close[1]`. */
export declare function seriesOperand(series: SeriesOffsetRef["series"], offset: number): Operand;
export declare function comparison(operator: ComparisonOperator, left: Operand, right: Operand): ComparisonExpression;
export declare function and(...operands: readonly Expression[]): LogicalExpression;
export declare function or(...operands: readonly Expression[]): LogicalExpression;
export declare function not(operand: Expression): LogicalExpression;
export declare function booleanReference(ref: IndicatorReference): BooleanReferenceExpression;
export declare function validateExpression(expr: Expression, path?: string): ValidationResult;
