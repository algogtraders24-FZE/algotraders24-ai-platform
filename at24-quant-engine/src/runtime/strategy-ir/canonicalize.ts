import type { Expression, Operand } from "../../domain/expression.js";
import type { StrategyIR, NamedCondition } from "../../domain/strategy-ir/strategy-ir.js";
import type { EntryIR, ExitIR } from "../../domain/strategy-ir/entry-exit-ir.js";
import { canonicalStringify } from "../determinism.js";

/**
 * Q0.7.36 — deterministic STRUCTURAL canonicalization only. `A AND B` and
 * `B AND A` (both commutative operators) canonicalize to the same operand
 * ORDER and therefore hash identically; `A > B` and `B < A` do NOT (a
 * comparison's left/right are not interchangeable — reordering them
 * would be an unsafe algebraic transformation, which Q0.7.36 explicitly
 * forbids). No boolean-algebra simplification is performed (e.g. `A AND
 * A` is never reduced to `A`, `NOT (NOT A)` is never reduced to `A`) —
 * only stable reordering of operands whose ORDER carries no semantic
 * meaning.
 */
export function canonicalizeExpression(expr: Expression): Expression {
  switch (expr.type) {
    case "comparison":
      return { ...expr, left: canonicalizeOperand(expr.left), right: canonicalizeOperand(expr.right) };
    case "boolean-reference":
      return expr;
    case "logical": {
      const canonicalChildren = expr.operands.map(canonicalizeExpression);
      if (expr.operator === "NOT") return { ...expr, operands: canonicalChildren };
      const sorted = [...canonicalChildren].sort((a, b) => compareByCanonicalKey(a, b));
      return { ...expr, operands: sorted };
    }
  }
}

function canonicalizeOperand(operand: Operand): Operand {
  return operand;
}

function compareByCanonicalKey(a: unknown, b: unknown): number {
  const ka = canonicalStringify(a);
  const kb = canonicalStringify(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function canonicalizeNamedCondition(c: NamedCondition): NamedCondition {
  return { ...c, expression: canonicalizeExpression(c.expression) };
}

function canonicalizeEntry(entry: EntryIR): EntryIR {
  return { ...entry, condition: canonicalizeExpression(entry.condition), ...(entry.trigger ? { trigger: canonicalizeExpression(entry.trigger) } : {}) };
}

function canonicalizeExit(exit: ExitIR): ExitIR {
  return { ...exit, ...(exit.condition ? { condition: canonicalizeExpression(exit.condition) } : {}) };
}

/**
 * Applies canonicalizeExpression to every Expression-bearing field of a
 * StrategyIR (conditions/entries/exits) and stably sorts every OTHER
 * order-independent collection (indicators, parameters, timeframes,
 * dependencies) by a canonical key — so two IRs differing only in
 * construction/array order hash identically. Entry/exit/condition IDs
 * are NOT reordered relative to each other (their own array order can be
 * semantically meaningful for tie-breaking in a future reducer), only
 * their INTERNAL expression trees are canonicalized.
 */
export function canonicalizeStrategyIR(ir: StrategyIR): StrategyIR {
  return {
    ...ir,
    conditions: ir.conditions.map(canonicalizeNamedCondition),
    entries: ir.entries.map(canonicalizeEntry),
    exits: ir.exits.map(canonicalizeExit),
    indicators: [...ir.indicators].sort((a, b) => compareByCanonicalKey(a, b)),
    dependencies: {
      symbols: [...ir.dependencies.symbols].sort(),
      timeframes: [...ir.dependencies.timeframes].sort(),
    },
  };
}
