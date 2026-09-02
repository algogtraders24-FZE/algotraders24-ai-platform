import type { Expression } from "../../domain/expression.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
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
export declare function canonicalizeExpression(expr: Expression): Expression;
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
export declare function canonicalizeStrategyIR(ir: StrategyIR): StrategyIR;
