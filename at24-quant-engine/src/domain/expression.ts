import type { IndicatorReference } from "./indicator-reference.js";
import { type SeriesOffsetRef, validateSeriesOffset } from "./strategy-ir/series.js";
import { type ValidationResult, ok, fail, combine } from "./validation-result.js";

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
export type Operand =
  | { readonly kind: "indicator"; readonly ref: IndicatorReference }
  | { readonly kind: "literal"; readonly value: number | boolean }
  | { readonly kind: "series"; readonly ref: SeriesOffsetRef };

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

export function literal(value: number | boolean): Operand {
  return { kind: "literal", value };
}

export function indicatorOperand(ref: IndicatorReference): Operand {
  return { kind: "indicator", ref };
}

/** Q0.7.8 (additive): a raw price-series operand at an explicit bar offset — e.g. `seriesOperand("CLOSE", 1)` for `Close[1]`. */
export function seriesOperand(series: SeriesOffsetRef["series"], offset: number): Operand {
  return { kind: "series", ref: { series, offset } };
}

export function comparison(operator: ComparisonOperator, left: Operand, right: Operand): ComparisonExpression {
  return { type: "comparison", operator, left, right };
}

export function and(...operands: readonly Expression[]): LogicalExpression {
  return { type: "logical", operator: "AND", operands };
}

export function or(...operands: readonly Expression[]): LogicalExpression {
  return { type: "logical", operator: "OR", operands };
}

export function not(operand: Expression): LogicalExpression {
  return { type: "logical", operator: "NOT", operands: [operand] };
}

export function booleanReference(ref: IndicatorReference): BooleanReferenceExpression {
  return { type: "boolean-reference", ref };
}

/**
 * Q0.7.9 (additive): rejects a negative (future) series offset, e.g. a
 * raw transcription of `Close[-1]`. Never coerces it into something
 * executable — a source construct that genuinely needs a future offset
 * has no valid Operand representation at all and must surface as an
 * UnsupportedSemantic record upstream (domain/strategy-ir/unsupported.ts),
 * not silently clamp to 0 here.
 */
function validateOperand(operand: Operand, path: string): ValidationResult {
  if (operand.kind !== "series") return ok();
  return validateSeriesOffset(operand.ref) ? ok() : fail(`${path}: series offset must be a non-negative integer, got ${operand.ref.offset} (future offsets are rejected, never silently clamped)`);
}

export function validateExpression(expr: Expression, path = "expression"): ValidationResult {
  switch (expr.type) {
    case "comparison":
      return combine(validateOperand(expr.left, `${path}.left`), validateOperand(expr.right, `${path}.right`));
    case "boolean-reference":
      return ok();
    case "logical": {
      const arityError =
        expr.operator === "NOT" && expr.operands.length !== 1
          ? fail(`${path}: NOT must have exactly 1 operand, got ${expr.operands.length}`)
          : expr.operator !== "NOT" && expr.operands.length < 2
            ? fail(`${path}: ${expr.operator} must have at least 2 operands, got ${expr.operands.length}`)
            : ok();
      const childResults = expr.operands.map((child, i) => validateExpression(child, `${path}.operands[${i}]`));
      return combine(arityError, ...childResults);
    }
  }
}
