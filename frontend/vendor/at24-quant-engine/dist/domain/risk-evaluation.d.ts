import type { Instrument } from "./market-data.js";
import type { RiskSpecification } from "./risk-specification.js";
import type { OrderTypeIR } from "./strategy-ir/order-ir.js";
export type RiskViolationCode = "INVALID_SIZE" | "MAX_POSITION" | "MAX_SIMULTANEOUS_POSITIONS" | "DAILY_LOSS_LIMIT" | "MAX_HOLDING_PERIOD" | "SESSION_RESTRICTION" | "EXPOSURE_LIMIT" | "INVALID_STOP" | "INVALID_TARGET" | "INVALID_RISK_DISTANCE" | "BREAKEVEN_CONSTRAINT" | "TRAILING_CONSTRAINT" | "PARTIAL_CLOSE_CONSTRAINT";
export type RiskViolationSeverity = "BLOCKING" | "WARNING";
/**
 * A closed, structured "how did it fail" taxonomy — deliberately separate
 * from `code` ("what kind of rule") so no violation is ever reported with
 * only a free-form message (Q0.3.3's "no free-form-only error reporting").
 */
export type RiskViolationReason = "BELOW_MINIMUM" | "EXCEEDS_MAXIMUM" | "AT_OR_BEYOND_LIMIT" | "INVALID_NUMERIC_VALUE" | "INVALID_CONFIGURATION" | "MISSING_REQUIRED_VALUE" | "INVALID_DIRECTION_RELATIVE_TO_ENTRY" | "OUTSIDE_ALLOWED_WINDOW";
export interface RiskViolation {
    readonly code: RiskViolationCode;
    readonly severity: RiskViolationSeverity;
    readonly message: string;
    readonly relevantValue: number | string | boolean | null;
    readonly configuredLimit: number | string | boolean | null;
    readonly reason: RiskViolationReason;
}
export interface RiskConstraintResult {
    readonly passed: boolean;
    readonly violation?: RiskViolation;
}
/**
 * Q0.10 CONTRACT CHANGE (additive, backward-compatible): `MOVE_STOP`
 * gained an optional `sourceRule`, identifying WHICH management policy
 * produced this stop move (breakeven and trailing both map to the same
 * `MOVE_STOP` action type, and were previously indistinguishable to any
 * caller). `pipeline.ts`'s `evaluateManagement()` always populates it;
 * any pre-Q0.10 hand-built `RiskAction` literal omitting it remains valid
 * since the field is optional. See docs/Q0.10_POSITION_MANAGEMENT.md.
 */
/**
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): `ALLOW_ENTRY`
 * gained `orderType`/`limitPrice`/`stopPrice`, all optional. Absent
 * `orderType` means MARKET (Q0.5's original, only-ever-produced value,
 * unchanged) — every pre-Q0.11 `{type:"ALLOW_ENTRY"}` literal remains
 * valid. `limitPrice`/`stopPrice` are already-RESOLVED concrete numbers
 * (a `PriceReference` is resolved to one, via
 * `runtime/strategy-ir/price-reference-resolver.ts`, before `evaluateRisk()`
 * is ever called — Risk Evaluation itself has no opinion on HOW a price
 * reference resolves, only WHAT the resolved number is). See
 * docs/Q0.11_ORDER_SEMANTICS.md.
 */
export type RiskAction = {
    readonly type: "NO_ACTION";
} | {
    readonly type: "ALLOW_ENTRY";
    readonly orderType?: OrderTypeIR;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
} | {
    readonly type: "REJECT_ENTRY";
} | {
    readonly type: "MOVE_STOP";
    readonly newStopPrice: number;
    readonly sourceRule?: "BREAKEVEN" | "TRAILING";
} | {
    readonly type: "PARTIAL_CLOSE";
    readonly closePercent: number;
} | {
    readonly type: "FORCE_EXIT_REQUIRED";
    readonly reasonCode: "MAX_HOLDING_PERIOD";
};
export type RiskEvaluationOutcome = "ALLOWED" | "MODIFIED" | "REJECTED";
/**
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): added
 * `orderType`/`limitPrice`/`stopPrice`, all optional, mirroring
 * `RiskAction.ALLOW_ENTRY`'s own extension — `evaluateEntry()`
 * (`runtime/risk/pipeline.ts`) passes these straight through into the
 * action it returns, unexamined (Risk Evaluation validates the entry's
 * SIZE/GEOMETRY, never its order-type choice, matching Q0.3's existing
 * "Specification vs Evaluation vs Execution" separation).
 */
export interface ProposedEntry {
    readonly quantity: number;
    readonly entryPrice: number;
    readonly stopLoss?: number;
    readonly takeProfit?: number;
    readonly orderType?: OrderTypeIR;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
}
export interface ExistingPosition {
    readonly quantity: number;
    readonly entryPrice: number;
    readonly entryTimestamp: number;
    readonly currentPrice: number;
    readonly currentStopLoss?: number;
    readonly currentAtr?: number;
    readonly barsHeld?: number;
    readonly partialCloseAlreadyTriggered?: boolean;
}
export interface PortfolioContext {
    readonly openPositionCount: number;
}
export interface DailyLossContext {
    readonly realizedPnlToday: number;
    readonly equityAtDayStart: number;
}
/**
 * A single input drives either an ENTRY evaluation (`proposedEntry` set,
 * `existingPosition` absent) or a MANAGEMENT evaluation of an already-open
 * position (`existingPosition` set, `proposedEntry` absent) — the same
 * shape and the same `evaluateRisk()` entry point serve both, since a
 * future backtester needs to call this uniformly every bar for both
 * "should I enter" and "what should happen to this open position"
 * questions. See docs/Q0.3_RISK_ARCHITECTURE.md.
 */
export interface RiskEvaluationInput {
    readonly asOf: number;
    readonly riskSpecification: RiskSpecification;
    readonly instrument: Instrument;
    readonly direction: "BUY" | "SELL";
    readonly proposedEntry?: ProposedEntry;
    readonly existingPosition?: ExistingPosition;
    readonly portfolio: PortfolioContext;
    readonly dailyLoss: DailyLossContext;
}
export interface RiskEvaluationResult {
    readonly outcome: RiskEvaluationOutcome;
    readonly action: RiskAction;
    readonly violations: readonly RiskViolation[];
    readonly evaluatedAt: number;
}
