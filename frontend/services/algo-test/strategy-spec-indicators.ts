// services/algo-test/strategy-spec-indicators.ts
// Live Execution (Paper) - Phase 1. Walks every entry/exit rule's own
// condition tree to recover the distinct indicators a compiled
// StrategySpec actually references. This is the ONLY way to rebuild that
// list once only `compiledSpec` (not the original AI-compiler schema
// input parsed.value.indicators) is available - e.g. on a LATER HTTP
// request, after the original compile call's own closures are long gone.
// Output shape mirrors nl-strategy-compiler.service.ts's own
// buildIndicatorSeriesFromCompiledIndicators() input exactly, so the two
// are always used together, never with a second, independently-derived
// indicator list.
import type { Expression, Operand, StrategySpec } from "at24-quant-engine";

export interface IndicatorRef {
  readonly family: string;
  readonly params: readonly number[];
}

function numericParams(params: readonly (number | string)[]): number[] {
  return params.filter((p): p is number => typeof p === "number");
}

function collectFromOperand(op: Operand, out: Map<string, IndicatorRef>): void {
  if (op.kind !== "indicator") return;
  if (op.ref.name === "PRICE") return; // reserved pseudo-indicator, never declared (see schema.ts's own rule)
  const params = numericParams(op.ref.params);
  out.set(`${op.ref.name}(${params.join(",")})`, { family: op.ref.name, params });
}

function collectFromExpression(expr: Expression, out: Map<string, IndicatorRef>): void {
  if (expr.type === "comparison") {
    collectFromOperand(expr.left, out);
    collectFromOperand(expr.right, out);
    return;
  }
  if (expr.type === "boolean-reference") {
    if (expr.ref.name === "PRICE") return;
    const params = numericParams(expr.ref.params);
    out.set(`${expr.ref.name}(${params.join(",")})`, { family: expr.ref.name, params });
    return;
  }
  // "logical"
  for (const child of expr.operands) collectFromExpression(child, out);
}

export function collectStrategyIndicatorRefs(spec: StrategySpec): IndicatorRef[] {
  const out = new Map<string, IndicatorRef>();
  for (const rule of spec.entryRules) collectFromExpression(rule.condition, out);
  for (const rule of spec.exitRules) collectFromExpression(rule.condition, out);
  return [...out.values()];
}
