import type { Instrument, Timeframe } from "../../domain/market-data.js";
import type { ProgramNode, InputDeclarationNode } from "../../domain/mql-importer/ast.js";
import type { MQLSourceDocument } from "../../domain/mql-importer/mql-source-document.js";
import type { MQLSemanticModel } from "../../domain/mql-importer/semantic-model.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { StrategyParameterDefinition, StrategyParameterType } from "../../domain/strategy-spec.js";
import type { UnsupportedSemantic, ApproximationRecord } from "../../domain/strategy-ir/unsupported.js";
import type { EntryIR } from "../../domain/strategy-ir/entry-exit-ir.js";
import type { IndicatorIR } from "../../domain/strategy-ir/indicator-ir.js";
import type { OrderTypeIR } from "../../domain/strategy-ir/order-ir.js";
import type { PriceReference } from "../../domain/strategy-ir/price-reference.js";
import type { PendingOrderManagementRuleIR, OrderTargetIR, ModificationConditionIR, PendingOrderManagementOperationIR } from "../../domain/strategy-ir/pending-order-management-ir.js";
import type { PendingOrderManagementCallSite } from "../../domain/mql-importer/semantic-model.js";
import { MQL_ORDER_TYPE_CONSTANT_MAP } from "../../domain/pending-order-management-policy.js";
import type { MQLImportReport, SourceToIRMapping } from "../../domain/mql-importer/import-report.js";
import { STRATEGY_IR_VERSION } from "../../domain/strategy-ir/version.js";
import { computeCanonicalHash } from "../determinism.js";
import { comparison, literal, indicatorOperand, type ComparisonOperator } from "../../domain/expression.js";
import { indicator, indicatorKey } from "../../domain/indicator-reference.js";
import { timeframeDurationMs } from "../fidelity/timeframe-duration.js";

export interface MQLImportOptions {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly instrument: Instrument;
  readonly executionTimeframe: Timeframe;
  readonly importedAt: number;
}

/**
 * Q0.10 — the subset of `POSITION_QUERY_FUNCTIONS` (semantic-analyzer.ts)
 * that are pure single-value ACCESSORS on an already-known order/position
 * (read one field, no iteration or selection), as opposed to
 * counting/selecting functions (`PositionsTotal`/`PositionSelect`/
 * `OrderSelect`/etc.) that indicate genuine custom position-management
 * logic. A breakeven/trailing/partial-close pattern necessarily calls one
 * of these to compute its trigger — they must NOT, by themselves, flip
 * the pyramiding/reversal-default heuristic to conservative (see the
 * `gatingPositionQueries` computation below, and
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md).
 */
/**
 * Q0.13 fix (additive, backward-compatible) — `OrderType()` is a pure
 * single-value ACCESSOR exactly like the four already listed here (reads
 * ONE field of an already-known/selected order, no iteration or
 * selection of its own) — it was simply never needed until this sprint's
 * own canonical pending-order-management pattern
 * (`if(OrderType()==OP_BUYSTOP) OrderDelete(ticket)`, Q0.13.8) made the
 * gap concrete: that single accessor call, with NO other genuinely
 * gating call present, was flipping `gatingPositionQueries.length > 0`
 * and forcing the CONSERVATIVE (REJECT/PLATFORM_DEFINED) pyramiding/
 * reversal branch — which then unconditionally fails
 * `checkReductionEligibility`'s Q0.9.16 pyramiding/reversal checks,
 * blocking the ENTIRE strategy for a reason structurally unrelated to
 * pending-order management. G01's real 17-call gating pattern (which
 * ALSO calls `OrderType()`, among many genuinely counting/selecting
 * calls) is unaffected — it still has plenty of other gating calls
 * (`PositionsTotal`/`PositionGetTicket`) and remains correctly BLOCKED.
 * See docs/Q0.13_EXISTING_ARCHITECTURE_AUDIT.md.
 */
const MANAGEMENT_ACCESSOR_FUNCTIONS = new Set(["OrderOpenPrice", "OrderLots", "OrderStopLoss", "OrderTakeProfit", "OrderType"]);

const MQL_TYPE_TO_PARAM_TYPE: Record<string, StrategyParameterType> = {
  int: "number", long: "number", double: "number", float: "number", short: "number", uint: "number", ulong: "number", short2: "number",
  bool: "boolean",
  string: "string",
};

function periodConstToTimeframe(period: string): Timeframe | undefined {
  const map: Record<string, Timeframe> = { PERIOD_M1: "M1", PERIOD_M5: "M5", PERIOD_M15: "M15", PERIOD_M30: "M30", PERIOD_H1: "H1", PERIOD_H4: "H4", PERIOD_D1: "D1", PERIOD_W1: "W1", PERIOD_MN1: "MN1" };
  return map[period];
}

function parameterFromInput(node: InputDeclarationNode): StrategyParameterDefinition | undefined {
  const type = MQL_TYPE_TO_PARAM_TYPE[node.declType];
  if (!type) return undefined;
  const raw = node.defaultValue.kind === "Literal" ? node.defaultValue.value : 0;
  const defaultValue = type === "boolean" ? Boolean(raw) : type === "string" ? String(raw) : Number(raw);
  return { key: node.name, type, defaultValue };
}

/**
 * Q0.8.19-21/24/40 — G01's real entry logic (Liquidity Sweep -> Displacement
 * -> MSS -> FVG -> Retest) is a multi-bar STATE MACHINE spanning several
 * #include modules, not a single boolean Expression. This IR has no
 * representation for cross-bar state machines (Q0.7's own documented
 * scope boundary — see docs/Q0.7_STRATEGY_IR.md's "deliberately narrower
 * than Q0.4's full scope"). Per Q0.8's own critical success criterion
 * ("if AT24 cannot faithfully represent something: DO NOT GUESS. Report
 * it. If the difference can materially change backtest results: BLOCK
 * execution."), the honest choice is a placeholder condition that always
 * evaluates false, paired with a BLOCKING UnsupportedSemantic — never a
 * fabricated condition that LOOKS executable.
 */
const UNREPRESENTABLE_CONDITION = comparison("==", literal(1), literal(0));

/**
 * Deduplicates indicators referenced by more than one reconstructed
 * condition (e.g. the same EMA used in both a BUY and a SELL entry),
 * keyed exactly like `indicatorKey()` so declared indicators always
 * match what conditions reference. Only ever called with `"named"`
 * entries in this file (the ones `buildRealConditionEntry` produces).
 */
function dedupeIndicators(indicators: readonly IndicatorIR[]): readonly IndicatorIR[] {
  const seen = new Map<string, IndicatorIR>();
  for (const ind of indicators) {
    if (ind.kind !== "named") continue;
    const key = indicatorKey(indicator(ind.family, ...ind.params));
    if (!seen.has(key)) seen.set(key, ind);
  }
  return [...seen.values()];
}

/**
 * Q0.8's central rule restated: this function assigns NO new trading
 * meaning of its own — every field below traces directly to something
 * `semantic-analyzer.ts` already recorded, or is explicitly marked
 * unresolved/approximated. It is a REDUCTION step (semantic model ->
 * IR shape), not a second semantic-interpretation pass.
 */
export function generateStrategyIR(
  document: MQLSourceDocument,
  program: ProgramNode,
  model: MQLSemanticModel,
  parseDiagnostics: readonly Diagnostic[],
  semanticDiagnostics: readonly Diagnostic[],
  options: MQLImportOptions,
): { ir: StrategyIR; report: MQLImportReport } {
  const unsupportedSemantics: UnsupportedSemantic[] = [];
  const approximations: ApproximationRecord[] = [];
  const sourceToIRMappings: SourceToIRMapping[] = [];

  function markUnsupported(feature: string, reason: string, severity: "INFO" | "WARNING" | "BLOCKING", executionImpact: string, line?: number): void {
    unsupportedSemantics.push({
      feature,
      reason,
      severity,
      executionImpact,
      ...(line !== undefined ? { sourceLocation: { line, sourceHash: document.sourceHash } } : {}),
    });
  }
  function markApproximation(feature: string, original: string, replacement: string, difference: string, impact: string): void {
    approximations.push({ feature, original, replacement, difference, impact });
  }
  function traceMapping(irFeature: string, sourceLine: number, sourceColumn: number): void {
    sourceToIRMappings.push({ irFeature, sourceLine, sourceColumn, sourceHash: document.sourceHash });
  }

  const inputNodes = program.body.filter((n): n is InputDeclarationNode => n.kind === "InputDeclaration");
  const parameters: StrategyParameterDefinition[] = [];
  for (const inp of inputNodes) {
    const param = parameterFromInput(inp);
    if (param) {
      parameters.push(param);
      traceMapping(`parameters.${param.key}`, inp.position.line, inp.position.column);
    } else {
      markUnsupported(`input ${inp.name} (${inp.declType})`, `no parameter-type mapping exists for MQL type "${inp.declType}"`, "INFO", "this input is not exposed as a StrategyParameterDefinition", inp.position.line);
    }
  }

  // --- Timeframes actually referenced (Q0.8.31/32) ---
  // Both `symbolTimeframeSites` (generic calls carrying a PERIOD_*
  // argument) AND `seriesReferences` (iClose/iOpen/CopyClose/etc., which
  // resolve to a series read BEFORE the generic detector ever runs — see
  // semantic-analyzer.ts's detectCall) can carry a timeframe. Missing
  // either would silently under-report real MTF usage.
  const referencedTimeframes = new Set<Timeframe>();
  for (const site of model.symbolTimeframeSites) {
    if (site.timeframeExpr) {
      const tf = periodConstToTimeframe(site.timeframeExpr);
      if (tf) referencedTimeframes.add(tf);
    }
  }
  for (const ref of model.seriesReferences) {
    if (ref.timeframeExpr) {
      const tf = periodConstToTimeframe(ref.timeframeExpr);
      if (tf) referencedTimeframes.add(tf);
    }
  }
  referencedTimeframes.add(options.executionTimeframe);
  const otherTimeframes = [...referencedTimeframes].filter((tf) => tf !== options.executionTimeframe);

  const hasNewBarSignal = model.newBarDetectionSites.length > 0;
  if (otherTimeframes.length > 0 && !hasNewBarSignal) {
    markUnsupported("multi-timeframe HTF availability", "additional timeframes are referenced but no new-bar gating could be proven", "BLOCKING", "HTF availability cannot be certified safe (Q0.7.20) without a provable new-bar boundary");
  } else if (otherTimeframes.length > 0) {
    markUnsupported(
      "multi-timeframe HTF availability",
      "HTF usage appears to be gated by a plausibly-named (but cross-file, unverified) new-bar check",
      "WARNING",
      "availability is recorded as HTF_CLOSE_AVAILABLE on trust in the naming convention, not independently proven",
    );
  }
  const timeframeSeries = [options.executionTimeframe, ...otherTimeframes].map((tf) => {
    const isExecution = tf === options.executionTimeframe;
    const role = isExecution ? ("EXECUTION" as const) : timeframeDurationMs(tf) > timeframeDurationMs(options.executionTimeframe) ? ("HIGHER" as const) : ("LOWER" as const);
    return { timeframe: tf, role, availabilityPolicy: "HTF_CLOSE_AVAILABLE" as const, alignmentPolicy: "CLOSE_ALIGNED" as const };
  });

  // --- Entries (Q0.8.19-21, Q0.9.11/38's provable-simple-condition reconstruction) ---
  const entries: EntryIR[] = [];
  const resolvedIndicators: IndicatorIR[] = [];
  const hasBuy = model.orderCalls.some((o) => o.side === "BUY");
  const hasSell = model.orderCalls.some((o) => o.side === "SELL");
  const riskPercentInput = inputNodes.find((n) => /risk.*percent/i.test(n.name));
  const sizingModel = riskPercentInput
    ? ({ method: "percent-equity-risk" as const, percent: riskPercentInput.defaultValue.kind === "Literal" ? Number(riskPercentInput.defaultValue.value) : 1 })
    : ({ method: "fixed-quantity" as const, quantity: 1 });
  if (riskPercentInput) {
    markApproximation(
      "position sizing method",
      `input "${riskPercentInput.name}" (percent-of-equity risk input) feeds an unresolved cross-file sizing function`,
      `PositionSizingMethod { method: "percent-equity-risk", percent: ${sizingModel.method === "percent-equity-risk" ? sizingModel.percent : 0} }`,
      "the actual lot-size FORMULA (including any broker volume-step rounding) lives in an unanalyzed #include and is not verified",
      "simulated position size may differ from the real EA's if the unresolved formula diverges from plain percent-equity-risk",
    );
  }

  /**
   * Q0.9.11/38 — the ONE provable shape this importer reconstructs into a
   * REAL Expression: `if (indicatorA <op> indicatorB) { <order> }`
   * (`semantic-analyzer.ts`'s `detectSimpleEntryCondition`). Everything
   * else (G01's real, multi-bar, cross-file state machine included)
   * falls back to the honest placeholder + BLOCKING semantic below,
   * unchanged from Q0.8.
   */
  function toConditionOperand(side: import("../../domain/mql-importer/semantic-model.js").EntryConditionOperand) {
    if (side.kind === "literal") return literal(side.value);
    resolvedIndicators.push({ kind: "named", family: side.ref.family, params: side.ref.params });
    return indicatorOperand(indicator(side.ref.family, ...side.ref.params));
  }

  /**
   * Q0.11.14 — resolves a pending-order price SOURCE-TEXT expression
   * (`OrderCallSite.limitPriceExpr`/`stopPriceExpr`) into a
   * `PriceReference`, narrowly: a bare numeric literal is `ABSOLUTE`;
   * `Bid`/`Ask` (MQL4's live price globals — not deterministically
   * computable in an OHLCV-only simulation, Q0.11.3's own rule) are
   * recorded `UNSUPPORTED`, never guessed at or silently dropped;
   * anything else (a variable bound to an unresolved cross-file formula)
   * resolves to `undefined` — honestly unresolved, matching Q0.9/Q0.10's
   * SL/TP arithmetic-reconstruction philosophy exactly.
   */
  function resolvePriceExprToReference(exprText: string | undefined): PriceReference | undefined {
    if (exprText === undefined) return undefined;
    const trimmed = exprText.trim();
    if (trimmed === "Bid") return { kind: "UNSUPPORTED", reason: "BID" };
    if (trimmed === "Ask") return { kind: "UNSUPPORTED", reason: "ASK" };
    const num = Number(trimmed);
    return Number.isFinite(num) ? { kind: "OPERAND", operand: literal(num) } : undefined;
  }

  /** Q0.11.14 — the ONE order-type/price-reference reduction for a given entry direction, reused by both the real-condition and placeholder entry builders below. */
  function buildOrderTypeFields(direction: "BUY" | "SELL"): { executionType: OrderTypeIR; limitPrice?: PriceReference; stopPrice?: PriceReference } {
    const orderCall = model.orderCalls.find((o) => o.side === direction && o.pendingOrderType !== undefined);
    const pendingOrderType = orderCall?.pendingOrderType ?? "MARKET";
    if (pendingOrderType === "MARKET") return { executionType: "MARKET" };
    const limitPrice = pendingOrderType === "LIMIT" || pendingOrderType === "STOP_LIMIT" ? resolvePriceExprToReference(orderCall?.limitPriceExpr) : undefined;
    const stopPrice = pendingOrderType === "STOP" || pendingOrderType === "STOP_LIMIT" ? resolvePriceExprToReference(orderCall?.stopPriceExpr) : undefined;
    const missingRequiredPrice = (pendingOrderType === "LIMIT" && limitPrice === undefined) || (pendingOrderType === "STOP" && stopPrice === undefined) || (pendingOrderType === "STOP_LIMIT" && (limitPrice === undefined || stopPrice === undefined));
    if (missingRequiredPrice || limitPrice?.kind === "UNSUPPORTED" || stopPrice?.kind === "UNSUPPORTED") {
      markUnsupported(
        `${pendingOrderType} order price`,
        missingRequiredPrice
          ? `a ${pendingOrderType} order's trigger/limit price could not be resolved to a literal or a recognized reference — it may be computed by an unresolved cross-file formula`
          : `a ${pendingOrderType} order references a live Bid/Ask price, which is not deterministically computable without a bid/ask feed (Q0.11.3)`,
        "BLOCKING",
        "this entry's executionType/limitPrice/stopPrice are left as detected but unresolved rather than fabricated",
      );
    }
    return { executionType: pendingOrderType, ...(limitPrice ? { limitPrice } : {}), ...(stopPrice ? { stopPrice } : {}) };
  }

  function buildRealConditionEntry(direction: "BUY" | "SELL", id: string): EntryIR | undefined {
    const site = model.simpleEntryConditions.find((s) => s.orderDirection === direction);
    if (!site) return undefined;
    return {
      id,
      direction,
      condition: comparison(site.operator as ComparisonOperator, toConditionOperand(site.left), toConditionOperand(site.right)),
      sizingModel,
      timing: "NEXT_BAR_OPEN",
      ...buildOrderTypeFields(direction),
    };
  }

  const buyEntry = hasBuy ? (buildRealConditionEntry("BUY", "entry-buy") ?? { id: "entry-buy", direction: "BUY" as const, condition: UNREPRESENTABLE_CONDITION, sizingModel, timing: "INTRABAR" as const, ...buildOrderTypeFields("BUY") }) : undefined;
  const sellEntry = hasSell ? (buildRealConditionEntry("SELL", "entry-sell") ?? { id: "entry-sell", direction: "SELL" as const, condition: UNREPRESENTABLE_CONDITION, sizingModel, timing: "INTRABAR" as const, ...buildOrderTypeFields("SELL") }) : undefined;
  if (buyEntry) entries.push(buyEntry);
  if (sellEntry) entries.push(sellEntry);
  if (entries.length === 0) {
    entries.push({ id: "entry-unrepresented", direction: "FLAT", condition: UNREPRESENTABLE_CONDITION, sizingModel, timing: "INTRABAR", executionType: "MARKET" });
  }

  const anyPlaceholderEntry = entries.some((e) => e.condition === UNREPRESENTABLE_CONDITION);
  if (anyPlaceholderEntry) {
    markUnsupported(
      "entry/exit signal logic",
      "the real entry sequence could not be proven to match the one entry-condition shape this importer reconstructs (`if (indicatorA <op> indicatorB) { order }`) — it may be a multi-bar state machine spanning several #include modules, or a comparison this importer cannot resolve to indicator operands",
      "BLOCKING",
      "the affected entries[].condition is a placeholder that always evaluates false — this IR cannot be executed until a future sprint extends condition reconstruction or adds cross-bar state-machine representation",
    );
  }

  // --- SL/TP (Q0.8.24, Q0.9.11/17's provable arithmetic reconstruction) ---
  // MQL's own convention: a literal 0/0.0 SL or TP argument means "not
  // set for this leg," not "stop-loss of exactly zero" — treating it as
  // "present" would misrepresent orders that deliberately omit one.
  const isMeaningfulPriceExpr = (expr: string | undefined): boolean => expr !== undefined && expr !== "0" && expr !== "0.0";
  const orderWithSLTP = model.orderCalls.find((o) => isMeaningfulPriceExpr(o.slExpr) && isMeaningfulPriceExpr(o.tpExpr));
  const hasSLTP = orderWithSLTP !== undefined;

  /** Q0.9.11/17 — the ONE provable reduction from source arithmetic to a real RiskSpecification leg; anything else (G01's real unresolved cross-file formula included) stays unresolved. */
  function bindingToRule(binding: import("../../domain/mql-importer/semantic-model.js").RiskLegBinding | undefined, kind: "stopLoss" | "takeProfit"): { stopLoss: { type: "fixed-distance"; distance: number } | { type: "atr-multiple"; atrMultiple: number; atrPeriod: number } } | { takeProfit: { type: "fixed-distance"; distance: number } } | undefined {
    if (!binding) return undefined;
    if (kind === "stopLoss") {
      return { stopLoss: binding.kind === "atr-multiple" ? { type: "atr-multiple", atrMultiple: binding.atrMultiple, atrPeriod: binding.atrPeriod } : { type: "fixed-distance", distance: binding.distance } };
    }
    // Q0.2's TakeProfitRule has no "atr-multiple" variant (only fixed-price/fixed-distance/risk-multiple) — an ATR-derived TP is recorded as fixed-distance using the SAME atrMultiple*atrPeriod-implied distance is not resolvable without a live ATR value, so it is intentionally left unresolved here and falls through to the existing BLOCKING path.
    return binding.kind === "fixed-distance" ? { takeProfit: { type: "fixed-distance", distance: binding.distance } } : undefined;
  }

  /**
   * Q0.10 fix — `resolvedIndicators` (below) was only ever populated from
   * ENTRY-CONDITION operands (`toConditionOperand`); an ATR indicator
   * referenced ONLY by a risk leg or a management rule (never by the
   * entry condition itself) silently never made it into `ir.indicators`,
   * even though `buildIndicatorSeriesFromIR` (Q0.9's simulation adapter)
   * requires it to be there to compute a real series. This affects SL/TP
   * atr-multiple rules exactly the same way it affects breakeven/trailing/
   * partial-close — registered here, once, for every binding site.
   */
  function registerAtrIndicatorIfNeeded(binding: import("../../domain/mql-importer/semantic-model.js").RiskLegBinding | undefined): void {
    if (binding?.kind === "atr-multiple") resolvedIndicators.push({ kind: "named", family: "ATR", params: [binding.atrPeriod] });
  }

  const slRule = orderWithSLTP ? bindingToRule(orderWithSLTP.slBinding, "stopLoss") : undefined;
  const tpRule = orderWithSLTP ? bindingToRule(orderWithSLTP.tpBinding, "takeProfit") : undefined;
  const sltpFullyResolved = hasSLTP && slRule !== undefined && tpRule !== undefined;
  if (orderWithSLTP) {
    registerAtrIndicatorIfNeeded(orderWithSLTP.slBinding);
    registerAtrIndicatorIfNeeded(orderWithSLTP.tpBinding);
  }

  if (hasSLTP && !sltpFullyResolved) {
    markUnsupported(
      "stop-loss / take-profit values",
      "SL/TP are computed by unresolved cross-file functions; the resulting price cannot be expressed as a StopLossRule/TakeProfitRule without resolving that formula",
      "BLOCKING",
      "risk.stopLoss/risk.takeProfit are left unset rather than fabricated",
    );
  }

  // --- Position management: breakeven / trailing / partial close / max holding (Q0.10.17) ---
  /** Converts the ONE resolved arithmetic shape (Q0.9's RiskLegBinding, reused unchanged) into Q0.2's own DistanceSpec — never a third representation of the same distance. */
  function bindingToDistanceSpec(binding: import("../../domain/mql-importer/semantic-model.js").RiskLegBinding): import("../../domain/risk-specification.js").DistanceSpec {
    return binding.kind === "atr-multiple" ? { mode: "atr-multiple", atrMultiple: binding.atrMultiple, atrPeriod: binding.atrPeriod } : { mode: "absolute", value: binding.distance };
  }

  const breakevenPattern = model.managementPatterns.find((p) => p.kind === "BREAKEVEN");
  const trailingPattern = model.managementPatterns.find((p) => p.kind === "TRAILING");
  const partialClosePattern = model.managementPatterns.find((p) => p.kind === "PARTIAL_CLOSE");
  const maxHoldingPattern = model.managementPatterns.find((p) => p.kind === "MAX_HOLDING");

  const breakevenRule = breakevenPattern?.triggerDistance && breakevenPattern.offsetOrDistance ? { trigger: bindingToDistanceSpec(breakevenPattern.triggerDistance), lockOffset: bindingToDistanceSpec(breakevenPattern.offsetOrDistance) } : undefined;
  const trailingStopRule = trailingPattern?.triggerDistance && trailingPattern.offsetOrDistance ? { activation: bindingToDistanceSpec(trailingPattern.triggerDistance), distance: bindingToDistanceSpec(trailingPattern.offsetOrDistance) } : undefined;
  const partialCloseRule = partialClosePattern?.triggerDistance && partialClosePattern.closePercent !== undefined ? { trigger: bindingToDistanceSpec(partialClosePattern.triggerDistance), closePercent: partialClosePattern.closePercent } : undefined;
  const maxHoldingRule = maxHoldingPattern?.maxDurationMs !== undefined ? { maxDurationMs: maxHoldingPattern.maxDurationMs } : undefined;
  if (breakevenPattern) {
    registerAtrIndicatorIfNeeded(breakevenPattern.triggerDistance);
    registerAtrIndicatorIfNeeded(breakevenPattern.offsetOrDistance);
  }
  if (trailingPattern) {
    registerAtrIndicatorIfNeeded(trailingPattern.triggerDistance);
    registerAtrIndicatorIfNeeded(trailingPattern.offsetOrDistance);
  }
  if (partialClosePattern) registerAtrIndicatorIfNeeded(partialClosePattern.triggerDistance);

  if (breakevenRule) markUnsupported("breakeven rule", "reconstructed from a provable `if (<price> - OrderOpenPrice() >= trigger) OrderModify(..., OrderOpenPrice() [+/- offset], ...)` source pattern", "WARNING", "the reconstruction assumes this is the ONLY place the stop is modified for this purpose — a second, unrecognized modify site elsewhere in the source would not be reflected");
  if (trailingStopRule) markUnsupported("trailing-stop rule", "reconstructed from a provable `if (<price> - OrderOpenPrice() >= trigger) OrderModify(..., <currentPrice> +/- distance, ...)` source pattern", "WARNING", "the reconstruction assumes this is the ONLY place the stop is modified for this purpose");
  if (partialCloseRule) markUnsupported("partial-close rule", "reconstructed from a provable `if (<price> - OrderOpenPrice() >= trigger) OrderClose(ticket, lots*fraction, ...)` source pattern", "WARNING", "only a single fractional close site is represented; a strategy with multiple distinct partial-close thresholds would only reflect the first one found");
  if (maxHoldingRule) markUnsupported("max-holding-period rule", "reconstructed from a provable `if (TimeCurrent() - OrderOpenTime() >= seconds) OrderClose(...)` source pattern", "WARNING", "assumes this is the strategy's only time-based exit condition");

  // --- Pending-order management (Q0.13) ---
  /** Q0.13.5 — mirrors `bindingToDistanceSpec` exactly (never a third distance representation); local because `PendingOrderManagementRuleIR`'s `DistanceSpec` fields need the identical conversion `bindingToDistanceSpec` (below, Q0.10) already performs for breakeven/trailing/partialClose. */
  function pendingMgmtBindingToDistanceSpec(binding: import("../../domain/mql-importer/semantic-model.js").RiskLegBinding): import("../../domain/risk-specification.js").DistanceSpec {
    return binding.kind === "atr-multiple" ? { mode: "atr-multiple", atrMultiple: binding.atrMultiple, atrPeriod: binding.atrPeriod } : { mode: "absolute", value: binding.distance };
  }

  function toTargetIR(site: PendingOrderManagementCallSite): OrderTargetIR {
    const orderTypeFilter = site.condition.kind === "ORDER_TYPE_FILTER" && site.condition.orderTypeConstant ? MQL_ORDER_TYPE_CONSTANT_MAP[site.condition.orderTypeConstant]?.orderType : undefined;
    const sideFilter = site.condition.kind === "ORDER_TYPE_FILTER" && site.condition.orderTypeConstant ? MQL_ORDER_TYPE_CONSTANT_MAP[site.condition.orderTypeConstant]?.side : undefined;
    return {
      kind: site.target.kind,
      provable: site.target.kind !== "UNKNOWN",
      ...(orderTypeFilter !== undefined ? { orderTypeFilter } : {}),
      ...(sideFilter !== undefined ? { sideFilter } : {}),
      ...(site.target.sourceExpr !== undefined ? { sourceExpr: site.target.sourceExpr } : {}),
    };
  }

  function toConditionIR(site: PendingOrderManagementCallSite): ModificationConditionIR {
    const c = site.condition;
    if (c.kind === "UNCONDITIONAL") return { kind: "ALWAYS", provable: true, ...(c.sourceExpr !== undefined ? { sourceExpr: c.sourceExpr } : {}) };
    if (c.kind === "ORDER_TYPE_FILTER") return { kind: "ORDER_TYPE_FILTER", provable: true, ...(c.orderTypeConstant !== undefined ? { orderTypeConstant: c.orderTypeConstant } : {}), ...(c.sourceExpr !== undefined ? { sourceExpr: c.sourceExpr } : {}) };
    if (c.kind === "FAVORABLE_DISTANCE" && c.favorableTriggerDistance) return { kind: "FAVORABLE_DISTANCE", provable: true, distance: pendingMgmtBindingToDistanceSpec(c.favorableTriggerDistance), ...(c.sourceExpr !== undefined ? { sourceExpr: c.sourceExpr } : {}) };
    return { kind: "UNKNOWN", provable: false, ...(c.sourceExpr !== undefined ? { sourceExpr: c.sourceExpr } : {}) };
  }

  /**
   * Q0.13.6/9/12 — only `OrderDelete`/`CTrade.OrderDelete` (-> CANCEL_PENDING)
   * and `OrderModify`/`CTrade.OrderModify` GUARDED by a provable
   * ORDER_TYPE_FILTER condition (which is the ONLY way this importer can
   * know, statically, whether the target is a LIMIT or a STOP without
   * guessing — Q0.13's own "never guess" rule) compile into a real
   * operation. `PositionModify`/`PositionClose`/`CTrade.PositionModify`/
   * `CTrade.PositionClose` are Q0.10's own domain (open-POSITION SL/TP,
   * already compiled above via `risk.breakeven`/`trailingStop`) — detected
   * and recorded here too (Q0.13.6's "never silently drop"), but with
   * operation UNKNOWN, so they are visible in IR/provenance without ever
   * being executed by two independent policies.
   */
  function toOperationIR(site: PendingOrderManagementCallSite): PendingOrderManagementOperationIR {
    if (site.functionName === "OrderDelete" || site.functionName === "CTrade.OrderDelete") {
      return { kind: "CANCEL_PENDING" };
    }
    if (site.functionName === "OrderModify" || site.functionName === "CTrade.OrderModify") {
      if (site.newPriceBinding && site.condition.kind === "ORDER_TYPE_FILTER" && site.condition.orderTypeConstant) {
        const mapped = MQL_ORDER_TYPE_CONSTANT_MAP[site.condition.orderTypeConstant];
        if (mapped) {
          const newDistanceFromClose = pendingMgmtBindingToDistanceSpec(site.newPriceBinding);
          return mapped.orderType === "STOP" ? { kind: "MODIFY_STOP", newDistanceFromClose } : { kind: "MODIFY_LIMIT", newDistanceFromClose };
        }
      }
      return { kind: "UNKNOWN" };
    }
    return { kind: "UNKNOWN" };
  }

  const pendingOrderManagementRules: PendingOrderManagementRuleIR[] = model.pendingOrderManagementCalls.map((site, index) => {
    const target = toTargetIR(site);
    const condition = toConditionIR(site);
    const operation = toOperationIR(site);
    const isPositionLevelCall = site.functionName === "PositionModify" || site.functionName === "PositionClose" || site.functionName === "CTrade.PositionModify" || site.functionName === "CTrade.PositionClose";
    const semanticFidelity: "EXACT" | "APPROXIMATED" | "UNKNOWN" = isPositionLevelCall ? "UNKNOWN" : target.provable && condition.provable && operation.kind !== "UNKNOWN" ? "EXACT" : "UNKNOWN";
    if (isPositionLevelCall) {
      markUnsupported(`pending-order management rule ${index} (${site.functionName})`, `"${site.functionName}" acts on an OPEN POSITION, not a pending order — Q0.10's existing breakeven/trailing/partial-close reconstruction is the correct home for this call, not Q0.13's pending-order policy (Q0.13.14's own risk/execution boundary)`, "INFO", "recorded for provenance only; never compiled into pendingOrderManagement's executable rules");
    } else if (semanticFidelity !== "EXACT") {
      // Q0.13.15 — WARNING, not BLOCKING: this specific RULE is what's blocked from execution
      // (excluded from `executableRules()`, see below), never the whole strategy. `BLOCKING`
      // severity here would trip `validateStrategyIR`'s own absolute "any BLOCKING
      // UnsupportedSemantic makes the whole IR execution-ineligible" rule (Q0.7.31, frozen) —
      // exactly the over-broad blast radius Q0.10's own breakeven/trailing/partialClose/
      // maxHoldingPeriod caveats already avoid by using WARNING for the identical situation
      // (a single management feature only partially/not resolved, not a fatal IR defect).
      markUnsupported(
        `pending-order management rule ${index} (${site.functionName})`,
        !target.provable
          ? `the order/position TARGET of this "${site.functionName}" call could not be resolved to a symbol or a ticket-shaped argument (Q0.13.5's documented scope boundary — no cross-statement OrderSelect/PositionSelect tracing is performed)`
          : !condition.provable
            ? `the condition guarding this "${site.functionName}" call is not one of the two provable shapes this importer reconstructs (an order-type filter or a favorable-distance trigger)`
            : `this "${site.functionName}" call's new price could not be resolved without first knowing the target order's own type (LIMIT vs STOP) — only a call guarded by a provable order-type filter can be compiled safely`,
        "WARNING",
        "this rule is recorded in pendingOrderManagement for provenance/audit but is EXCLUDED from the compiled, executable policy (executableRules()) — never approximated, never silently executed",
      );
    }
    return {
      id: `pending-mgmt-${index}`,
      target,
      condition,
      operation,
      semanticFidelity,
      sourceLine: site.position.line,
      sourceExpr: `${site.functionName}(...)`,
    };
  });

  // --- Account mode (Q0.8.22) ---
  markUnsupported("position accounting mode", "account mode is account-level broker configuration, not declared in EA source", "WARNING", 'assumed NETTING (MT5\'s common default) — never verified against the actual account');
  /**
   * Q0.10 refinement — a real, previously-undiscovered conflict: Q0.9's
   * "no custom position-management code" signal counted EVERY function in
   * `POSITION_QUERY_FUNCTIONS`, including `OrderOpenPrice`/`OrderLots`/
   * `OrderStopLoss`/`OrderTakeProfit` — pure single-value ACCESSORS that a
   * breakeven/trailing/partial-close pattern must call to compute its
   * trigger (see `isEntryPriceExpr`/`resolvePartialCloseFraction`). Under
   * the old, undifferentiated check, detecting breakeven at all
   * automatically flipped pyramiding/reversal to the conservative
   * REJECT/PLATFORM_DEFINED branch, permanently blocking the very
   * strategy this sprint set out to support. The real signal for "custom
   * logic that might override the platform's pyramiding/reversal default"
   * is COUNTING/SELECTING functions (iterate-or-choose-a-position), not
   * accessors that merely read a field of an already-known order/position
   * — G01's real, genuinely-conservative case uses `PositionsTotal`/
   * `PositionGetTicket` (both gating), so it is unaffected by this split.
   */
  const gatingPositionQueries = model.positionQueries.filter((q) => !MANAGEMENT_ACCESSOR_FUNCTIONS.has(q.functionName));
  if (gatingPositionQueries.length === 0) {
    markUnsupported("pyramiding/reversal behavior", "no custom position-selection/counting code was found, so the platform's own documented netting defaults (accumulate same-direction, reverse atomically) were assumed", "WARNING", "would be wrong if the deployed account's actual behavior differs from the documented default (e.g. a hedging-mode account)");
  }

  // --- Session (G01 uses a custom multi-session enum classifier, not a simple window list) ---
  const hasSessionInputs = inputNodes.some((n) => /session|asia|london|overlap|ny/i.test(n.name));
  if (hasSessionInputs) {
    markUnsupported("session filter", "source uses a custom multi-named-session classifier (ENUM-based) fed by input hour boundaries, not a simple allowed-window list", "WARNING", "session field is left unset rather than force-fit into SessionHoursRule's shape");
  }

  // --- Timezone (Q0.8.29/30) ---
  const usesLocalTime = model.sessionTimeCalls.some((c) => c.isLocalTime);
  const strategyTimezone = usesLocalTime ? "LOCAL_MACHINE_TIME_UNSAFE" : "UNSPECIFIED_BROKER_SERVER_TIME";
  markUnsupported(
    "strategy timezone",
    usesLocalTime ? "source calls TimeLocal() — depends on the executing machine's local clock" : "source uses TimeCurrent()/TimeToStruct() (broker/server time), which is not a fixed IANA zone",
    usesLocalTime ? "BLOCKING" : "WARNING",
    usesLocalTime ? "results are not reproducible across machines/timezones until this is resolved" : "must be confirmed against the actual broker's server timezone before live/backtest parity can be claimed",
  );

  // --- Repainting (Q0.8.35) ---
  const isRealtimeDependent = model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY" && u.functionName.includes("unconditional realtime"));
  const repaintingModel = isRealtimeDependent ? ("REALTIME_DEPENDENT" as const) : model.newBarDetectionSites.length > 0 ? ("NON_REPAINTING" as const) : ("UNKNOWN" as const);

  // --- Daily trade count (no RiskSpecification equivalent) ---
  const maxTradesInput = inputNodes.find((n) => /maxtradesperday/i.test(n.name));
  if (maxTradesInput) {
    markUnsupported("daily trade count limit", `input "${maxTradesInput.name}" limits ENTRIES PER DAY — RiskSpecification.dailyLossLimit covers realized LOSS, not trade COUNT`, "WARNING", "not represented in risk; a future sprint would need a new RiskSpecification field");
  }

  const magicNumberInput = inputNodes.find((n) => /magic/i.test(n.name));

  const strategyVersionFromProperty = document.properties.get("version") ?? options.strategyVersion;

  const provenanceUnsupported: UnsupportedSemantic[] = [
    ...unsupportedSemantics,
    ...model.unsupportedConstructs
      .filter((u) => u.category === "ICUSTOM" || u.category === "DLL_IMPORT" || u.category === "WEBREQUEST" || u.category === "EXTERNAL_FILE")
      .map((u) => ({ feature: u.functionName, reason: `"${u.functionName}" is a ${u.category} construct`, severity: "BLOCKING" as const, executionImpact: "cannot be executed by the simulation engine", sourceLocation: { line: u.position.line, sourceHash: document.sourceHash } })),
  ];

  // Q0.9's own fix to a real Q0.8 bug: "APPROXIMATED" must never be
  // claimed unless a concrete ApproximationRecord backs it (Q0.7.32 —
  // "an approximation must never be hidden," enforced structurally by
  // validateStrategyIRStructure()). A WARNING-level UnsupportedSemantic
  // that never rose to a formal approximation (e.g. "timezone could not
  // be verified") is SEMANTIC_EQUIVALENT, not APPROXIMATED — those are
  // genuinely different claims.
  const hasBlockingUnsupported = provenanceUnsupported.some((u) => u.severity === "BLOCKING");
  const semanticStatus = hasBlockingUnsupported ? ("UNSUPPORTED" as const) : approximations.length > 0 ? ("APPROXIMATED" as const) : provenanceUnsupported.length > 0 ? ("SEMANTIC_EQUIVALENT" as const) : ("EXACT" as const);

  const translationHash = computeCanonicalHash({ sourceHash: document.sourceHash, model, options });

  const ir: StrategyIR = {
    strategyId: options.strategyId,
    strategyVersion: strategyVersionFromProperty,
    sourcePlatform: model.dialect === "MQL5" ? "MT5_MQL5" : "MT4_MQL4",
    sourceLanguage: model.dialect,
    sourceVersion: model.dialect === "MQL5" ? "5" : "4",
    sourceHash: document.sourceHash,
    irVersion: STRATEGY_IR_VERSION,
    metadata: { name: document.fileName, description: document.properties.get("description") ?? "", createdAt: options.importedAt },
    instruments: [options.instrument],
    timeframes: [options.executionTimeframe, ...otherTimeframes],
    timeframeSeries,
    parameters,
    indicators: dedupeIndicators(resolvedIndicators),
    conditions: [],
    entries,
    exits: hasSLTP ? [{ id: "exit-sl", kind: "STOP_LOSS" }, { id: "exit-tp", kind: "TAKE_PROFIT" }] : [],
    positionManagement: {
      accountingMode: "NETTING",
      // Q0.9's own pyramiding/reversal-default refinement: absent any
      // custom position-state gating (PositionSelect/PositionsTotal/
      // OrderSelect/etc.), there is no custom logic that could override
      // the platform's own well-documented defaults — a plain repeat
      // same-direction order call simply ACCUMULATES onto the net
      // position, and an opposite-direction fill REVERSES atomically
      // (docs/Q0.7_PLATFORM_MATRIX.md, real cited platform facts, never a
      // guess) — exactly Q0.5's own engine behavior. When custom position
      // queries ARE present (G01's real case: 17 of them, explicitly
      // PREVENTING a second entry rather than accumulating or reversing),
      // that custom logic might override the default in ways this
      // importer cannot verify — stay conservative and record the
      // unresolved case instead.
      pyramiding:
        gatingPositionQueries.length === 0
          ? { allowPyramiding: true, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" }
          : { allowPyramiding: false, sameDirectionBehavior: "REJECT", oppositeDirectionBehavior: "REJECT" },
      reversal:
        gatingPositionQueries.length === 0
          ? { buyToSell: "REVERSE", sellToBuy: "REVERSE", platformDefaultDescription: "no custom position-selection/counting code detected — assumed to follow MT4/MT5's own documented netting-mode reversal default (atomic reduce-then-reopen)" }
          : { buyToSell: "PLATFORM_DEFINED", sellToBuy: "PLATFORM_DEFINED", platformDefaultDescription: `not determinable — ${gatingPositionQueries.length} custom position-selection/counting call(s) detected that may override the platform default in ways this importer cannot verify` },
    },
    timezone: { strategyTimezone },
    repaintingModel,
    realtimeHistoricalAsymmetry: { historicalVsRealtimeDiffers: isRealtimeDependent, barCloseVsIntrabarDiffers: isRealtimeDependent, ...(isRealtimeDependent ? { note: "entry trigger reads live bid/ask every tick, independent of bar-close state-machine progression" } : {}) },
    barCloseSemantics: isRealtimeDependent ? "INTRABAR" : "ON_BAR_CLOSE",
    priceSource: "CUSTOM",
    slTpReference: "ATR_DERIVED",
    risk: {
      sizing: sizingModel,
      ...(sltpFullyResolved ? { ...slRule, ...tpRule } : {}),
      ...(breakevenRule ? { breakeven: breakevenRule } : {}),
      ...(trailingStopRule ? { trailingStop: trailingStopRule } : {}),
      ...(partialCloseRule ? { partialClose: partialCloseRule } : {}),
      ...(maxHoldingRule ? { maxHoldingPeriod: maxHoldingRule } : {}),
    },
    execution: { declared: { fillModel: "intrabar-touch", costsExplicitlyZero: true }, platformDefaultsUsed: ["MQL5 CTrade market order execution (immediate, broker-determined fill); spread/slippage not modeled in source"] },
    dependencies: { symbols: [], timeframes: otherTimeframes },
    ...(pendingOrderManagementRules.length > 0 ? { pendingOrderManagement: { rules: pendingOrderManagementRules } } : {}),
    provenance: {
      sourcePlatform: model.dialect === "MQL5" ? "MT5_MQL5" : "MT4_MQL4",
      sourceHash: document.sourceHash,
      sourceVersion: model.dialect === "MQL5" ? "5" : "4",
      irVersion: STRATEGY_IR_VERSION,
      translationHash,
      semanticStatus,
      unsupportedSemantics: provenanceUnsupported,
      approximations,
    },
  };

  const allDiagnostics = [...parseDiagnostics, ...semanticDiagnostics];
  const report: MQLImportReport = {
    sourceHash: document.sourceHash,
    dialect: model.dialect,
    parsedConstructs: [...new Set(program.body.map((n) => n.kind))],
    recognizedIndicators: [...new Set(model.indicatorCalls.map((c) => c.functionName))],
    recognizedConditions: [...new Set(model.crossPatterns.map((c) => c.direction))],
    recognizedOrders: [...new Set(model.orderCalls.map((o) => o.style))],
    riskBehavior: [magicNumberInput ? `magic number input: ${magicNumberInput.name}` : "no magic number input found", ...(hasSLTP ? ["SL/TP attached to entry order (values unresolved)"] : [])],
    executionBehavior: [...new Set(model.eventHandlers.map((e) => e.kind))],
    unsupportedConstructs: [...new Set(model.unsupportedConstructs.map((u) => `${u.category}:${u.functionName}`))],
    diagnostics: allDiagnostics,
    sourceToIRMappings,
  };

  return { ir, report };
}
