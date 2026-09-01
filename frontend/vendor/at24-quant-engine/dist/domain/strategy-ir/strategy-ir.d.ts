import type { Instrument, Timeframe } from "../market-data.js";
import type { Expression } from "../expression.js";
import type { StrategyParameterDefinition } from "../strategy-spec.js";
import type { RiskSpecification } from "../risk-specification.js";
import type { SourcePlatform } from "./source.js";
import type { IndicatorIR } from "./indicator-ir.js";
import type { EntryIR, ExitIR } from "./entry-exit-ir.js";
import type { PositionAccountingMode, PyramidingPolicy, ReversalPolicy } from "./position-ir.js";
import type { SessionSemanticsIR, StrategyTimezoneModel } from "./session-timezone-ir.js";
import type { SeriesAvailability, RequestSecurityCapability } from "./mtf-ir.js";
import type { RepaintingModel, RealtimeHistoricalAsymmetry, BarCloseSemantics } from "./repainting-ir.js";
import type { PriceSourceKind, SLTPReferenceKind } from "./price-source-ir.js";
import type { ExecutionAssumptionsIR } from "./execution-assumptions-ir.js";
import type { StrategyIRProvenance } from "./strategy-ir-provenance.js";
import type { PendingOrderManagementIR } from "./pending-order-management-ir.js";
import { type ValidationResult } from "../validation-result.js";
export interface StrategyIRMetadata {
    readonly name: string;
    readonly description?: string;
    readonly author?: string;
    readonly tags?: readonly string[];
    readonly createdAt: number;
}
/** A reusable, named condition — the "conditions" library entries/exits may reference beyond their own inline condition. */
export interface NamedCondition {
    readonly id: string;
    readonly expression: Expression;
}
export interface PositionManagementIR {
    readonly accountingMode: PositionAccountingMode;
    readonly pyramiding: PyramidingPolicy;
    readonly reversal: ReversalPolicy;
}
/** Q0.4_STRATEGY_IR.md's "Symbol dependencies"/"Timeframe dependencies" — anything read BEYOND the strategy's own primary instrument/timeframe. */
export interface DependenciesIR {
    readonly symbols: readonly string[];
    readonly timeframes: readonly Timeframe[];
}
/**
 * Q0.7.1 — the canonical AT24 Universal Strategy IR. Sits BETWEEN a
 * source platform and Q0's `StrategySpec` (per docs/Q0.4_STRATEGY_IR.md's
 * architecture, now implemented): source parsing is mechanical
 * program-structure translation INTO this shape; reducing an IR down to a
 * `StrategySpec` for actual simulation is a SEPARATE, future semantic-
 * reduction step (not built in Q0.7 — see docs/Q0.7_TRANSLATION_CONTRACT.md).
 *
 * Deliberately narrower than Q0.4's full research scope: variables,
 * mutable state, loops, and arbitrary arithmetic expressions remain
 * OUT of scope (docs/Q0.4_STRATEGY_IR.md flagged these as needing
 * further design) — this IR covers exactly the concepts Q0.7's own
 * sections enumerate (indicators, conditions, entries/exits, orders,
 * position management, risk, sessions/timezone, MTF, repainting,
 * execution assumptions), which is what a translator needs to represent
 * TODAY's supported strategy shapes losslessly and flag everything else
 * as UnsupportedSemantic rather than silently drop it.
 */
export interface StrategyIR {
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly sourcePlatform: SourcePlatform;
    readonly sourceLanguage: string;
    readonly sourceVersion: string;
    readonly sourceHash: string;
    readonly irVersion: string;
    readonly metadata: StrategyIRMetadata;
    readonly instruments: readonly Instrument[];
    readonly timeframes: readonly Timeframe[];
    readonly timeframeSeries: readonly SeriesAvailability[];
    /** Q0.7.21 — Pine-style request.security()-shaped MTF reads, semantic representation only (no Pine parser exists). */
    readonly requestSecurityCalls?: readonly RequestSecurityCapability[];
    readonly parameters: readonly StrategyParameterDefinition[];
    readonly indicators: readonly IndicatorIR[];
    readonly conditions: readonly NamedCondition[];
    readonly entries: readonly EntryIR[];
    readonly exits: readonly ExitIR[];
    readonly positionManagement: PositionManagementIR;
    readonly session?: SessionSemanticsIR;
    readonly timezone: StrategyTimezoneModel;
    readonly repaintingModel: RepaintingModel;
    readonly realtimeHistoricalAsymmetry: RealtimeHistoricalAsymmetry;
    readonly barCloseSemantics: BarCloseSemantics;
    readonly priceSource: PriceSourceKind;
    readonly slTpReference: SLTPReferenceKind;
    readonly risk: RiskSpecification;
    readonly execution: ExecutionAssumptionsIR;
    readonly dependencies: DependenciesIR;
    readonly provenance: StrategyIRProvenance;
    /** Q0.13 CONTRACT CHANGE (additive): pending-order modify/cancel/replace behavior, distinct from `risk`'s existing breakeven/trailing/partialClose/maxHoldingPeriod (Q0.10 — those manage an OPEN POSITION, this manages a still-PENDING ORDER). Absent for every pre-Q0.13 IR — never defaulted to an empty policy vs. "not analyzed for this at all." */
    readonly pendingOrderManagement?: PendingOrderManagementIR;
}
/**
 * STRUCTURAL validation only (mirrors Q0's `validateStrategySpec`
 * pattern exactly) — identity non-empty, no duplicate ids, expressions
 * well-formed, RiskSpecification valid. The FULLER semantic pipeline
 * (MTF/lookahead/repainting/timezone/unsupported-semantics/execution-
 * compatibility — Q0.7.38) lives in
 * `runtime/strategy-ir/ir-validator.ts`'s `validateStrategyIR()`, which
 * calls this function first and then layers the semantic checks on top —
 * the same domain/runtime split every prior sprint has used.
 */
export declare function validateStrategyIRStructure(ir: StrategyIR): ValidationResult;
