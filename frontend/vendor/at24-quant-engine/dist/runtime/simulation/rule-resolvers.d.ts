import type { PositionSizingMethod, StopLossRule, TakeProfitRule } from "../../domain/risk-specification.js";
type Direction = "BUY" | "SELL";
/**
 * Resolves a StopLossRule/TakeProfitRule (Q0.2/Q0.3) into a concrete
 * price, given an assumed entry price. Throws — rather than returning a
 * RiskViolation — when required context (an ATR value) is missing,
 * matching the same "missing required context is a caller integration
 * error" pattern Q0.3's resolveDistanceSpec already established.
 */
export declare function resolveStopLossPrice(rule: StopLossRule | undefined, direction: Direction, entryPrice: number, atrValue: number | undefined): number | undefined;
export declare function resolveTakeProfitPrice(rule: TakeProfitRule | undefined, direction: Direction, entryPrice: number, stopLossPrice: number | undefined): number | undefined;
export interface SizingParams {
    readonly entryPrice: number;
    readonly stopLossPrice?: number;
    readonly equity: number;
}
/**
 * KNOWN LIMITATION (documented, not silently guessed — see
 * docs/Q0.5_EXECUTION_MODEL.md): "atr-based" position sizing
 * (`{ method: "atr-based", atrMultiple, atrPeriod }`) was defined at the
 * RiskSpecification contract level in Q0.2 without ever specifying an
 * operational quantity formula — there is no risk-percent field to
 * normalize against, unlike "percent-equity-risk". Rather than invent an
 * undocumented formula, Q0.5 throws a clear, explicit error for this
 * sizing method. fixed-quantity, fixed-lot, and percent-equity-risk are
 * fully resolved.
 */
export declare function resolvePositionSize(sizing: PositionSizingMethod, params: SizingParams): number;
export {};
