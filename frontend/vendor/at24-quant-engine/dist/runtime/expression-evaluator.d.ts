import type { Expression, Operand } from "../domain/expression.js";
import type { MarketState } from "../domain/market-state.js";
/**
 * Q0.11 CONTRACT CHANGE (additive, zero behavior change): exported —
 * previously module-private. `runtime/strategy-ir/price-reference-resolver.ts`
 * reuses this exact function for the ABSOLUTE/CLOSE/OPEN/HIGH/LOW/
 * INDICATOR_VALUE cases of a LIMIT/STOP order's `PriceReference`, rather
 * than re-implementing operand resolution a second time. No existing
 * caller or behavior is affected — only the export keyword changed.
 */
export declare function resolveOperand(operand: Operand, state: MarketState): number | boolean;
export declare function evaluateExpression(expr: Expression, state: MarketState): boolean;
