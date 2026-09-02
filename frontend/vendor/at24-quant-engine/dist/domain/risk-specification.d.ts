import { type ValidationResult } from "./validation-result.js";
export type PositionSizingMethod = {
    readonly method: "fixed-quantity";
    readonly quantity: number;
} | {
    readonly method: "fixed-lot";
    readonly lots: number;
} | {
    readonly method: "percent-equity-risk";
    readonly percent: number;
} | {
    readonly method: "atr-based";
    readonly atrMultiple: number;
    readonly atrPeriod: number;
};
export type StopLossRule = {
    readonly type: "fixed-price";
    readonly price: number;
} | {
    readonly type: "fixed-distance";
    readonly distance: number;
} | {
    readonly type: "atr-multiple";
    readonly atrMultiple: number;
    readonly atrPeriod: number;
};
export type TakeProfitRule = {
    readonly type: "fixed-price";
    readonly price: number;
} | {
    readonly type: "fixed-distance";
    readonly distance: number;
} | {
    readonly type: "risk-multiple";
    readonly rMultiple: number;
};
/**
 * A price/profit distance expressed one of three ways, shared by
 * breakeven/trailing/partial-close so their semantics stay consistent.
 * "absolute" = raw price units (same units as the instrument's quote price,
 * e.g. $3.00 for XAUUSD). "percentage" = percent of entry price (0-100].
 * "atr-multiple" = multiple of ATR(atrPeriod) at entry time.
 */
export type DistanceSpec = {
    readonly mode: "absolute";
    readonly value: number;
} | {
    readonly mode: "percentage";
    readonly value: number;
} | {
    readonly mode: "atr-multiple";
    readonly atrMultiple: number;
    readonly atrPeriod: number;
};
/**
 * Move the stop-loss to breakeven once price has moved `trigger` in the
 * position's favor. `lockOffset` is how far past entry the new stop sits
 * (mode "absolute" value 0 = exactly at entry; a positive value locks in
 * that much profit instead).
 */
export interface BreakevenRule {
    readonly trigger: DistanceSpec;
    readonly lockOffset: DistanceSpec;
}
/**
 * Once price has moved `activation` in the position's favor, trail the
 * stop `distance` behind the current price.
 */
export interface TrailingStopRule {
    readonly activation: DistanceSpec;
    readonly distance: DistanceSpec;
}
/**
 * Once price has moved `trigger` in the position's favor, close
 * `closePercent` (0, 100] of the remaining position size.
 */
export interface PartialCloseRule {
    readonly trigger: DistanceSpec;
    readonly closePercent: number;
}
export interface SessionWindow {
    readonly startHour: number;
    readonly startMinute: number;
    readonly endHour: number;
    readonly endMinute: number;
}
/** New positions may only be opened within one of `windows`, all in `timezone` (IANA name, e.g. "UTC"). */
export interface SessionHoursRule {
    readonly timezone: string;
    readonly windows: readonly SessionWindow[];
}
/**
 * A position must be closed once EITHER limit is reached, whichever comes
 * first. At least one of `maxBars`/`maxDurationMs` must be set.
 */
export interface MaxHoldingPeriodRule {
    readonly maxBars?: number;
    readonly maxDurationMs?: number;
}
/**
 * Once the current trading day's REALIZED loss reaches this limit, no new
 * positions may be opened for the remainder of that day. Deliberately
 * excludes unrealized/floating P&L — this is a specification of the field's
 * meaning only; evaluating it against actual trades is a future Risk
 * Evaluation concern, not this contract's job (see Q0.2.8's explicit
 * Specification/Evaluation/Execution separation).
 */
export type DailyLossLimit = {
    readonly mode: "percent-equity";
    readonly percent: number;
} | {
    readonly mode: "fixed-amount";
    readonly amount: number;
};
/**
 * Strategy/runtime-level risk contract only. This is NOT wired to the
 * M-Series Risk Engine (frontend/services/ai/.../risk-engine.service.ts, or
 * the Python m5-risk-analysis engine) — see ADR-006 / Q0.6. A future
 * RiskAdapter is the only allowed bridge, and it is not built here.
 *
 * Q0.2 CONTRACT CHANGE (additive, backward-compatible): added breakeven,
 * trailingStop, partialClose, sessionHours, maxHoldingPeriod,
 * maxSimultaneousPositions, dailyLossLimit — all optional, all
 * specification-only (no evaluation logic; see docs/Q0.2_CONTRACT_FREEZE.md
 * and docs/Q0.2_RESEARCH_FOUNDATION.md for full field-by-field semantics).
 */
export interface RiskSpecification {
    readonly sizing: PositionSizingMethod;
    readonly maxPositionSize?: number;
    readonly maxExposure?: number;
    readonly stopLoss?: StopLossRule;
    readonly takeProfit?: TakeProfitRule;
    readonly breakeven?: BreakevenRule;
    readonly trailingStop?: TrailingStopRule;
    readonly partialClose?: PartialCloseRule;
    readonly sessionHours?: SessionHoursRule;
    readonly maxHoldingPeriod?: MaxHoldingPeriodRule;
    readonly maxSimultaneousPositions?: number;
    readonly dailyLossLimit?: DailyLossLimit;
}
export declare function validatePositionSizingMethod(sizing: PositionSizingMethod): ValidationResult;
export declare function validateDistanceSpec(spec: DistanceSpec, path: string): ValidationResult;
export declare function validateRiskSpecification(spec: RiskSpecification): ValidationResult;
