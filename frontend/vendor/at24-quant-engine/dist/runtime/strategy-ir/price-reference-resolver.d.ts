import type { PriceReference } from "../../domain/strategy-ir/price-reference.js";
import type { MarketState } from "../../domain/market-state.js";
/**
 * Q0.11.3 — the ONE resolver from a `PriceReference` to a concrete
 * number, reused by both the simulation adapter (order creation) and any
 * future validation/preview tooling — never a second implementation.
 * `OPERAND` reuses `resolveOperand` (Q0's own expression-evaluator,
 * exported additively for exactly this purpose) rather than
 * re-implementing series/indicator/literal resolution. Throws (never
 * silently approximates) for `UNSUPPORTED` and for any operand that
 * resolves to a boolean where a price number was required.
 */
export declare function resolvePriceReference(ref: PriceReference, state: MarketState): number;
