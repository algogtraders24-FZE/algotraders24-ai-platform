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
import { validatePendingOrderManagementPolicy } from "../pending-order-management-policy.js";
import { type ValidationResult, ok, fail, combine } from "../validation-result.js";
import { validateExpression } from "../expression.js";
import { validateRiskSpecification } from "../risk-specification.js";
import { validateExecutionSpecification } from "../execution-specification.js";
import { validateStrategyVersionString } from "../strategy-spec.js";

const KNOWN_ORDER_TYPES = new Set(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);

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

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
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
export function validateStrategyIRStructure(ir: StrategyIR): ValidationResult {
  const results: ValidationResult[] = [];

  if (!ir.strategyId.trim()) results.push(fail("strategyId must not be empty"));
  if (!ir.metadata.name.trim()) results.push(fail("metadata.name must not be empty"));
  if (!ir.sourceHash.trim()) results.push(fail("sourceHash must not be empty"));
  if (!ir.irVersion.trim()) results.push(fail("irVersion must not be empty"));
  if (ir.instruments.length === 0) results.push(fail("instruments must contain at least one Instrument"));
  if (ir.timeframes.length === 0) results.push(fail("timeframes must contain at least one Timeframe"));
  if (ir.entries.length === 0) results.push(fail("entries must contain at least one EntryIR"));

  const entryDupes = findDuplicates(ir.entries.map((e) => e.id));
  if (entryDupes.length > 0) results.push(fail(`duplicate entry ids: ${entryDupes.join(", ")}`));
  const exitDupes = findDuplicates(ir.exits.map((e) => e.id));
  if (exitDupes.length > 0) results.push(fail(`duplicate exit ids: ${exitDupes.join(", ")}`));
  const conditionDupes = findDuplicates(ir.conditions.map((c) => c.id));
  if (conditionDupes.length > 0) results.push(fail(`duplicate condition ids: ${conditionDupes.join(", ")}`));

  ir.entries.forEach((entry, i) => {
    results.push(validateExpression(entry.condition, `entries[${i}](${entry.id}).condition`));
    if (entry.trigger) results.push(validateExpression(entry.trigger, `entries[${i}](${entry.id}).trigger`));
  });
  ir.exits.forEach((exit, i) => {
    if (exit.condition) results.push(validateExpression(exit.condition, `exits[${i}](${exit.id}).condition`));
  });
  ir.conditions.forEach((c, i) => {
    results.push(validateExpression(c.expression, `conditions[${i}](${c.id})`));
  });

  results.push(validateRiskSpecification(ir.risk));
  results.push(validateExecutionSpecification(ir.execution.declared));
  // Q0.13 — structurally identical shape to PendingOrderManagementPolicy (see pending-order-management-ir.ts's doc comment); reused, never a second validator.
  if (ir.pendingOrderManagement) results.push(validatePendingOrderManagementPolicy(ir.pendingOrderManagement));
  results.push(validateStrategyVersionString(ir.strategyVersion));

  if (!ir.timezone.strategyTimezone.trim()) results.push(fail("timezone.strategyTimezone must be set explicitly (Q0.7.18) — never inferred from the host machine"));

  if (ir.provenance.sourcePlatform !== ir.sourcePlatform) {
    results.push(fail("provenance.sourcePlatform must match the top-level sourcePlatform field"));
  }
  if (ir.provenance.sourceHash !== ir.sourceHash) {
    results.push(fail("provenance.sourceHash must match the top-level sourceHash field (source/IR identity mismatch)"));
  }
  if (ir.provenance.semanticStatus === "APPROXIMATED" && ir.provenance.approximations.length === 0) {
    results.push(fail('provenance.semanticStatus is "APPROXIMATED" but provenance.approximations is empty — an approximation must never be hidden (Q0.7.32)'));
  }

  ir.entries.forEach((entry, i) => {
    if (!KNOWN_ORDER_TYPES.has(entry.executionType)) {
      results.push(fail(`entries[${i}](${entry.id}).executionType "${entry.executionType}" is not a recognized OrderTypeIR`));
    }
  });

  ir.parameters.forEach((param) => {
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      results.push(fail(`parameter "${param.key}": min must be <= max`));
    }
  });

  if (
    (ir.positionManagement.reversal.buyToSell === "PLATFORM_DEFINED" || ir.positionManagement.reversal.sellToBuy === "PLATFORM_DEFINED") &&
    !ir.positionManagement.reversal.platformDefaultDescription?.trim()
  ) {
    results.push(fail('positionManagement.reversal declares "PLATFORM_DEFINED" without a platformDefaultDescription — ambiguous platform semantics must be named, never left unexplained (Q0.7.16/30)'));
  }

  // Q1.5.4 — maxPositions/maxEntries structural validation. The current
  // PositionAccountingMode is NETTING-only (position-accounting-mode.ts) —
  // a single Position object per instrument, always — so `maxPositions`
  // (a count of CONCURRENTLY open positions) has no meaningful value below
  // 1: `maxPositions < 1` would mean "never allow the one position NETTING
  // always produces," which is not a real, satisfiable policy, so it is
  // rejected here as invalid configuration rather than silently accepted
  // and never enforced. `maxPositions >= 1` is valid but, under NETTING,
  // has no runtime effect beyond what the engine already guarantees
  // structurally (see docs/Q1.5_PYRAMIDING_POLICY.md) — genuine
  // `maxPositions > 1` enforcement requires HEDGING, not implemented here.
  if (ir.positionManagement.pyramiding.maxPositions !== undefined && ir.positionManagement.pyramiding.maxPositions < 1) {
    results.push(fail(`positionManagement.pyramiding.maxPositions must be >= 1, got ${ir.positionManagement.pyramiding.maxPositions} (NETTING mode always has exactly one position per instrument when open)`));
  }
  if (ir.positionManagement.pyramiding.maxEntries !== undefined && ir.positionManagement.pyramiding.maxEntries < 1) {
    results.push(fail(`positionManagement.pyramiding.maxEntries must be >= 1, got ${ir.positionManagement.pyramiding.maxEntries} (an open position always has at least one entry fill)`));
  }

  return combine(...results);
}
