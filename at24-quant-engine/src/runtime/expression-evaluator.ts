import type { ComparisonExpression, Expression, Operand } from "../domain/expression.js";
import { indicatorKey } from "../domain/indicator-reference.js";
import type { MarketState } from "../domain/market-state.js";
import type { OHLCVBar } from "../domain/market-data.js";
import type { SeriesOffsetRef } from "../domain/strategy-ir/series.js";

/**
 * Q0.7.6/8 — resolves a series[offset] reference against the bars a
 * MarketState carries (`bars[bars.length-1]` = current bar, per Q0.5's
 * established convention). `indexFromEnd` lets resolvePreviousOperand
 * below reuse this for "one bar further back than the ref's own offset"
 * without a second lookup function.
 */
function resolveSeriesValue(ref: SeriesOffsetRef, bars: readonly OHLCVBar[], indexFromEnd: number): number {
  const idx = bars.length - 1 - indexFromEnd;
  if (idx < 0) {
    throw new Error(`series "${ref.series}[${ref.offset}]": not enough history (only ${bars.length} bar(s) available)`);
  }
  const bar = bars[idx]!;
  switch (ref.series) {
    case "OPEN":
      return bar.open;
    case "HIGH":
      return bar.high;
    case "LOW":
      return bar.low;
    case "CLOSE":
      return bar.close;
    case "VOLUME":
      return bar.volume;
    default:
      throw new Error(`series "${ref.series}" is a RESERVED field (Q0.7.6) — not available on OHLCVBar; requires a future data-detail sprint`);
  }
}

/**
 * Q0.11 CONTRACT CHANGE (additive, zero behavior change): exported —
 * previously module-private. `runtime/strategy-ir/price-reference-resolver.ts`
 * reuses this exact function for the ABSOLUTE/CLOSE/OPEN/HIGH/LOW/
 * INDICATOR_VALUE cases of a LIMIT/STOP order's `PriceReference`, rather
 * than re-implementing operand resolution a second time. No existing
 * caller or behavior is affected — only the export keyword changed.
 */
export function resolveOperand(operand: Operand, state: MarketState): number | boolean {
  if (operand.kind === "literal") return operand.value;
  if (operand.kind === "series") return resolveSeriesValue(operand.ref, state.bars, operand.ref.offset);
  const key = indicatorKey(operand.ref);
  const value = state.indicatorValues.get(key);
  if (value === undefined) {
    throw new Error(`MarketState is missing indicator value for "${key}"`);
  }
  return value;
}

/**
 * Returns the operand's value as of the PREVIOUS observation, or undefined
 * if unavailable. A literal's "previous value" is itself (constants do not
 * change over time). An indicator's previous value comes only from
 * `previousIndicatorValues` — never from re-deriving it some other way —
 * so "no prior observation" is representable and distinct from "value is 0".
 * A series operand's previous value is the same series shifted one bar
 * further back than its own offset (`Close[1]`'s previous value is
 * `Close[2]` relative to the current evaluation instant).
 */
function resolvePreviousOperand(operand: Operand, state: MarketState): number | boolean | undefined {
  if (operand.kind === "literal") return operand.value;
  if (operand.kind === "series") {
    const idx = state.bars.length - 2 - operand.ref.offset;
    return idx < 0 ? undefined : resolveSeriesValue(operand.ref, state.bars, operand.ref.offset + 1);
  }
  const key = indicatorKey(operand.ref);
  return state.previousIndicatorValues?.get(key);
}

function compareValues(operator: string, left: number | boolean, right: number | boolean): boolean {
  switch (operator) {
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      throw new Error(`Unknown comparison operator "${operator}"`);
  }
}

/**
 * cross_above(A, B): previous A <= B AND current A > B.
 * cross_below(A, B): previous A >= B AND current A < B.
 *
 * Deliberately requires an explicit previous observation. If either side's
 * previous value is unavailable (first observation / insufficient history),
 * the result is a defined `false` — a cross cannot have happened without a
 * prior data point to cross from, and this must never throw, since "not
 * enough history yet" is normal runtime state, not a data/spec bug (unlike
 * a missing CURRENT indicator value, which still throws above).
 */
function evaluateCross(expr: ComparisonExpression, state: MarketState): boolean {
  const currentLeft = resolveOperand(expr.left, state) as number;
  const currentRight = resolveOperand(expr.right, state) as number;
  const previousLeft = resolvePreviousOperand(expr.left, state);
  const previousRight = resolvePreviousOperand(expr.right, state);

  if (previousLeft === undefined || previousRight === undefined) return false;

  if (expr.operator === "cross_above") {
    return (previousLeft as number) <= (previousRight as number) && currentLeft > currentRight;
  }
  return (previousLeft as number) >= (previousRight as number) && currentLeft < currentRight;
}

export function evaluateExpression(expr: Expression, state: MarketState): boolean {
  switch (expr.type) {
    case "comparison":
      if (expr.operator === "cross_above" || expr.operator === "cross_below") {
        return evaluateCross(expr, state);
      }
      return compareValues(expr.operator, resolveOperand(expr.left, state), resolveOperand(expr.right, state));
    case "boolean-reference":
      return resolveOperand({ kind: "indicator", ref: expr.ref }, state) === true;
    case "logical": {
      switch (expr.operator) {
        case "AND":
          return expr.operands.every((child) => evaluateExpression(child, state));
        case "OR":
          return expr.operands.some((child) => evaluateExpression(child, state));
        case "NOT": {
          const [only] = expr.operands;
          if (only === undefined) throw new Error("NOT expression has no operand");
          return !evaluateExpression(only, state);
        }
      }
    }
  }
}
