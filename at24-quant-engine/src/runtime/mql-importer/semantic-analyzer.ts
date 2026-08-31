import type {
  ProgramNode,
  FunctionDeclarationNode,
  StatementNode,
  ExpressionNode,
  CallExpressionNode,
  GlobalVariableDeclarationNode,
} from "../../domain/mql-importer/ast.js";
import type { SourcePosition } from "../../domain/mql-importer/token.js";
import type { Diagnostic } from "../../domain/mql-importer/diagnostic.js";
import { diagnostic } from "../../domain/mql-importer/diagnostic.js";
import type {
  MQLSemanticModel,
  MQLEventHandler,
  MQLEventKind,
  BarTickMode,
  NewBarDetectionSite,
  SeriesReferenceSite,
  IndicatorCallSite,
  CrossPatternSite,
  StateVariableSite,
  OrderCallSite,
  PositionQuerySite,
  ModifyCallSite,
  PartialCloseCallSite,
  SessionTimeCallSite,
  SymbolTimeframeSite,
  UnsupportedConstructSite,
  UnsupportedCategory,
  SimpleEntryConditionSite,
  IndicatorReferenceValue,
  ManagementPatternSite,
  RiskLegBinding,
  PendingOrderManagementCallSite,
  PendingOrderManagementFunctionName,
  PendingOrderTargetSite,
  PendingOrderConditionSite,
} from "../../domain/mql-importer/semantic-model.js";
import type { PriceSeriesField } from "../../domain/strategy-ir/series.js";
import type { NamedIndicatorFamily } from "../../domain/strategy-ir/indicator-ir.js";
import type { MQLDialect } from "../../domain/mql-importer/mql-source-document.js";

const MQL5_EVENT_MAP: Record<string, MQLEventKind> = {
  OnInit: "MQL5_ONINIT",
  OnDeinit: "MQL5_ONDEINIT",
  OnTick: "MQL5_ONTICK",
  OnTimer: "MQL5_ONTIMER",
  OnTrade: "MQL5_ONTRADE",
  OnTradeTransaction: "MQL5_ONTRADETRANSACTION",
};
const MQL4_EVENT_MAP: Record<string, MQLEventKind> = { init: "MQL4_INIT", start: "MQL4_START", deinit: "MQL4_DEINIT" };

const SERIES_IDENTIFIERS: Record<string, PriceSeriesField> = { Close: "CLOSE", Open: "OPEN", High: "HIGH", Low: "LOW", Volume: "VOLUME" };
const SERIES_FUNCTIONS: Record<string, PriceSeriesField> = {
  iClose: "CLOSE", iOpen: "OPEN", iHigh: "HIGH", iLow: "LOW", iVolume: "VOLUME",
  CopyClose: "CLOSE", CopyOpen: "OPEN", CopyHigh: "HIGH", CopyLow: "LOW",
};
/** Only the two GENERIC (multi-output) indicators use a fixed name->family mapping — iMA/iRSI/iATR are handled with dedicated per-function logic in `detectCall` (family from `method` for iMA; a real single `period` argument for all three). */
const INDICATOR_FUNCTIONS: Record<string, NamedIndicatorFamily | undefined> = { iMACD: "MACD", iBands: "BOLLINGER_BANDS" };
const POSITION_QUERY_FUNCTIONS = new Set([
  "PositionsTotal", "PositionSelect", "PositionGetTicket", "PositionGetString", "PositionGetInteger", "PositionGetDouble",
  "OrdersTotal", "OrderSelect", "OrderType", "OrderLots", "OrderOpenPrice", "OrderStopLoss", "OrderTakeProfit",
  "HistorySelect", "HistoryDealSelect", "HistoryDealGetInteger", "HistoryDealGetDouble", "HistoryDealGetString",
]);
const SESSION_TIME_FUNCTIONS = new Set(["Hour", "TimeHour", "TimeToStruct", "DayOfWeek", "TimeCurrent", "TimeLocal"]);
const ACCOUNT_FUNCTIONS = new Set(["AccountInfoDouble", "AccountBalance", "AccountEquity", "AccountMargin", "AccountFreeMargin"]);
const BROKER_CONSTRAINT_TOKENS = new Set(["SYMBOL_TRADE_STOPS_LEVEL", "SYMBOL_TRADE_FREEZE_LEVEL", "SYMBOL_VOLUME_MIN", "SYMBOL_VOLUME_MAX", "SYMBOL_VOLUME_STEP"]);

function calleeName(callee: ExpressionNode): string | undefined {
  if (callee.kind === "Identifier") return callee.name;
  if (callee.kind === "MemberExpression") return callee.property;
  return undefined;
}
function argText(arg: ExpressionNode | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg.kind === "Identifier") return arg.name;
  if (arg.kind === "Literal") return String(arg.value);
  if (arg.kind === "UnaryExpression") return `${arg.operator}${argText(arg.argument) ?? ""}`;
  return undefined;
}
function isSymbolOrTimeframeLiteralish(arg: ExpressionNode | undefined): boolean {
  if (!arg) return false;
  return arg.kind === "Identifier" || arg.kind === "Literal";
}

class SemanticAnalyzer {
  readonly diagnostics: Diagnostic[] = [];
  readonly eventHandlers: MQLEventHandler[] = [];
  readonly barTickModesByFunction = new Map<string, BarTickMode>();
  readonly newBarDetectionSites: NewBarDetectionSite[] = [];
  readonly seriesReferences: SeriesReferenceSite[] = [];
  readonly indicatorCalls: IndicatorCallSite[] = [];
  readonly crossPatterns: CrossPatternSite[] = [];
  readonly orderCalls: OrderCallSite[] = [];
  readonly positionQueries: PositionQuerySite[] = [];
  readonly modifyCalls: ModifyCallSite[] = [];
  readonly partialCloseCalls: PartialCloseCallSite[] = [];
  readonly sessionTimeCalls: SessionTimeCallSite[] = [];
  readonly symbolTimeframeSites: SymbolTimeframeSite[] = [];
  readonly unsupportedConstructs: UnsupportedConstructSite[] = [];
  readonly simpleEntryConditions: SimpleEntryConditionSite[] = [];
  readonly managementPatterns: ManagementPatternSite[] = [];
  readonly pendingOrderManagementCalls: PendingOrderManagementCallSite[] = [];
  readonly globalReadPositions = new Map<string, SourcePosition[]>();
  readonly globalWritePositions = new Map<string, SourcePosition[]>();
  /** Q0.13 — `"${line}:${column}"` keys of pending-order-management calls already recorded via the CONDITIONAL detector (`detectPendingOrderManagementConditional`, which runs before the consequent is walked) — prevents `detectCall`'s own unconditional-case fallback from double-booking the SAME call site once the generic traversal reaches it. */
  private readonly recordedPendingManagementPositions = new Set<string>();
  private readonly functionsReadingBidAsk = new Set<string>();
  /** Per-function (reset in analyzeFunction): a local variable's LAST-assigned indicator call, e.g. `double fast = iMA(...)`. Never carried across functions. */
  private variableIndicatorBindings = new Map<string, IndicatorReferenceValue>();
  /** Per-function (reset in analyzeFunction): a local variable's LAST-assigned SL/TP-shaped arithmetic, e.g. `double sl = bid - atr*2.0`. Never carried across functions. */
  private variableRiskBindings = new Map<string, import("../../domain/mql-importer/semantic-model.js").RiskLegBinding>();

  constructor(
    private readonly dialect: MQLDialect,
    private readonly globals: readonly GlobalVariableDeclarationNode[],
    private readonly functions: readonly FunctionDeclarationNode[],
    private readonly inputDefaults: ReadonlyMap<string, number> = new Map(),
  ) {
    for (const g of globals) {
      for (const d of g.declarators) {
        this.globalReadPositions.set(d.name, []);
        this.globalWritePositions.set(d.name, []);
      }
    }
  }

  private pushUnsupported(category: UnsupportedCategory, functionName: string, position: SourcePosition): void {
    this.unsupportedConstructs.push({ category, functionName, position });
  }

  private recordGlobalAccess(name: string, position: SourcePosition, isWrite: boolean): void {
    const map = isWrite ? this.globalWritePositions : this.globalReadPositions;
    map.get(name)?.push(position);
  }

  analyzeFunction(fn: FunctionDeclarationNode): void {
    if (MQL5_EVENT_MAP[fn.name]) this.eventHandlers.push({ kind: MQL5_EVENT_MAP[fn.name]!, functionName: fn.name, position: fn.position });
    if (MQL4_EVENT_MAP[fn.name]) this.eventHandlers.push({ kind: MQL4_EVENT_MAP[fn.name]!, functionName: fn.name, position: fn.position });

    const mode = this.classifyBarTickMode(fn);
    this.barTickModesByFunction.set(fn.name, mode);

    this.variableIndicatorBindings = new Map(); // never carried across functions
    this.variableRiskBindings = new Map();
    this.walkStatement(fn.body, fn.name, false);
  }

  /** A direct recognized-indicator CallExpression, e.g. `iMA(...)`/`iRSI(...)` — the same recognition `detectCall` uses, factored out so binding-tracking and direct-operand resolution share one source of truth. */
  /** The single source of truth for "what NamedIndicatorFamily (if any) does this call resolve to, with what params" — shared by `detectCall`'s recording logic and `indicatorCallValue`'s binding-tracking logic, so the two can never silently diverge. */
  private resolveIndicatorCallReference(expr: CallExpressionNode): IndicatorReferenceValue | undefined {
    const name = calleeName(expr.callee);
    if (!name) return undefined;
    if (name === "iMA") {
      const methodArg = argText(expr.args[4]);
      const family: NamedIndicatorFamily | undefined = methodArg === "MODE_EMA" ? "EMA" : methodArg === "MODE_SMA" ? "SMA" : undefined;
      if (!family) return undefined;
      return { family, params: [this.resolveNumericArg(expr.args[2])] };
    }
    if (name === "iRSI" || name === "iATR") {
      return { family: name === "iRSI" ? "RSI" : "ATR", params: [this.resolveNumericArg(expr.args[2])] };
    }
    const genericFamily = INDICATOR_FUNCTIONS[name];
    if (!genericFamily) return undefined;
    return { family: genericFamily, params: expr.args.map((a) => argText(a) ?? "?") };
  }

  private indicatorCallValue(expr: ExpressionNode): IndicatorReferenceValue | undefined {
    if (expr.kind !== "CallExpression") return undefined;
    return this.resolveIndicatorCallReference(expr);
  }

  /** Resolves a call argument to a number: a literal number as-is, or an Identifier matching a declared `input`'s own literal default value (a real, provable resolution — never a guess) — else the raw source text, which downstream (the simulation adapter) treats as unresolvable rather than crashing. */
  private resolveNumericArg(arg: ExpressionNode | undefined): number | string {
    if (!arg) return "?";
    if (arg.kind === "Literal" && typeof arg.value === "number") return arg.value;
    if (arg.kind === "Identifier") {
      const fromInput = this.inputDefaults.get(arg.name);
      if (fromInput !== undefined) return fromInput;
    }
    return argText(arg) ?? "?";
  }

  /** Q0.9.11/38 — resolves an operand to an indicator reference either directly (a call) or via a local variable's last-assigned indicator call. Never resolves across functions, never guesses. */
  private resolveIndicatorOperand(expr: ExpressionNode): IndicatorReferenceValue | undefined {
    const direct = this.indicatorCallValue(expr);
    if (direct) return direct;
    if (expr.kind === "Identifier") return this.variableIndicatorBindings.get(expr.name);
    return undefined;
  }

  /** Records `name`'s indicator binding if `valueExpr` is a recognized indicator call — used for both `type name = iMA(...)` declarations and `name = iMA(...)` assignments. */
  private recordIndicatorBindingIfApplicable(name: string, valueExpr: ExpressionNode): void {
    const value = this.indicatorCallValue(valueExpr);
    if (value) this.variableIndicatorBindings.set(name, value);
    const riskLeg = this.resolveRiskLegBinding(valueExpr);
    if (riskLeg) this.variableRiskBindings.set(name, riskLeg);
  }

  /** `<atrVar> * <literal>` or `<literal> * <atrVar>`, where `<atrVar>` is bound to a recognized ATR indicator call. */
  private resolveAtrMultipleTerm(expr: ExpressionNode): { atrMultiple: number; atrPeriod: number } | undefined {
    if (expr.kind !== "BinaryExpression" || expr.operator !== "*") return undefined;
    for (const [a, b] of [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ] as const) {
      if (a.kind === "Identifier" && b.kind === "Literal" && typeof b.value === "number") {
        const binding = this.variableIndicatorBindings.get(a.name);
        if (binding?.family === "ATR") {
          const period = typeof binding.params[0] === "number" ? binding.params[0] : Number(binding.params[0]);
          if (Number.isFinite(period)) return { atrMultiple: b.value, atrPeriod: period };
        }
      }
    }
    return undefined;
  }

  /** Q0.9.11/17 — `<price> ± <literal>` (fixed-distance) or `<price> ± (<atrVar>*<literal>)` (atr-multiple). The ONLY two arithmetic shapes this importer reconstructs into a real risk rule. */
  private resolveRiskLegBinding(expr: ExpressionNode): import("../../domain/mql-importer/semantic-model.js").RiskLegBinding | undefined {
    if (expr.kind !== "BinaryExpression" || (expr.operator !== "+" && expr.operator !== "-")) return undefined;
    for (const side of [expr.left, expr.right]) {
      const atrTerm = this.resolveAtrMultipleTerm(side);
      if (atrTerm) return { kind: "atr-multiple", ...atrTerm };
    }
    for (const side of [expr.left, expr.right]) {
      if (side.kind === "Literal" && typeof side.value === "number") return { kind: "fixed-distance", distance: Math.abs(side.value) };
    }
    return undefined;
  }

  private readonly comparisonOperators = new Set([">", ">=", "<", "<=", "==", "!="]);

  /** Resolves one side of a comparison to either a recognized indicator reference or a plain numeric literal — never anything else (never a guess). */
  private resolveEntryConditionOperand(expr: ExpressionNode): import("../../domain/mql-importer/semantic-model.js").EntryConditionOperand | undefined {
    const indicatorRef = this.resolveIndicatorOperand(expr);
    if (indicatorRef) return { kind: "indicator", ref: indicatorRef };
    if (expr.kind === "Literal" && typeof expr.value === "number") return { kind: "literal", value: expr.value };
    return undefined;
  }

  /** Q0.9.11/38 — the ONE provable "simple entry condition" shape: `if (indicatorA <op> indicatorB)` or `if (indicator <op> literal) { <order call> }`, requiring at least one recognized indicator side (never a bare literal-vs-literal comparison). */
  private detectSimpleEntryCondition(test: ExpressionNode, consequent: StatementNode): void {
    if (test.kind !== "BinaryExpression" || !this.comparisonOperators.has(test.operator)) return;
    const left = this.resolveEntryConditionOperand(test.left);
    const right = this.resolveEntryConditionOperand(test.right);
    if (!left || !right) return;
    if (left.kind === "literal" && right.kind === "literal") return;
    const direction = this.findOrderDirectionIn(consequent);
    if (!direction) return;
    this.simpleEntryConditions.push({ operator: test.operator, left, right, orderDirection: direction, position: test.position });
  }

  /** A shallow, recursive scan for the FIRST resolvable BUY/SELL order call inside a statement — independent of `detectCall`'s side-effecting array, so ordering never matters. */
  private findOrderDirectionIn(stmt: StatementNode): "BUY" | "SELL" | undefined {
    let found: "BUY" | "SELL" | undefined;
    const visitExpr = (e: ExpressionNode): void => {
      if (found) return;
      if (e.kind === "CallExpression") {
        const name = calleeName(e.callee);
        // Q0.11.14 — the six MQL5 CTrade pending-order methods are entry order calls exactly
        // like Buy/Sell; findOrderDirectionIn must recognize them too, or an `if` whose ONLY
        // order call is e.g. `g_trade.BuyStop(...)` would never be recognized as an entry
        // condition at all (its direction would stay unresolved, forcing the honest
        // UNREPRESENTABLE-condition fallback even though the pattern IS provable).
        if ((name === "Buy" || name === "Sell" || name === "BuyLimit" || name === "SellLimit" || name === "BuyStop" || name === "SellStop" || name === "BuyStopLimit" || name === "SellStopLimit") && e.callee.kind === "MemberExpression") {
          found = name.startsWith("Buy") ? "BUY" : "SELL";
          return;
        }
        if (name === "OrderSend") {
          const cmd = argText(e.args[1]);
          if (cmd?.startsWith("OP_BUY")) found = "BUY";
          else if (cmd?.startsWith("OP_SELL")) found = "SELL";
          return;
        }
        e.args.forEach(visitExpr);
      } else if (e.kind === "BinaryExpression" || e.kind === "AssignmentExpression") {
        visitExpr(e.kind === "BinaryExpression" ? e.left : e.target);
        visitExpr(e.kind === "BinaryExpression" ? e.right : e.value);
      } else if (e.kind === "UnaryExpression") visitExpr(e.argument);
      else if (e.kind === "ConditionalExpression") {
        visitExpr(e.test);
        visitExpr(e.consequent);
        visitExpr(e.alternate);
      }
    };
    const visitStmt = (s: StatementNode): void => {
      if (found) return;
      if (s.kind === "BlockStatement") s.body.forEach(visitStmt);
      else if (s.kind === "IfStatement") {
        visitStmt(s.consequent);
        if (s.alternate) visitStmt(s.alternate);
      } else if (s.kind === "ExpressionStatement") visitExpr(s.expression);
      else if (s.kind === "VariableDeclarationStatement") s.declarators.forEach((d) => d.initializer && visitExpr(d.initializer));
    };
    visitStmt(stmt);
    return found;
  }

  /** `OrderOpenPrice()` (MQL4) or `PositionGetDouble(POSITION_PRICE_OPEN)` (MQL5) — the two ways source refers to "this position's entry price". */
  private isEntryPriceExpr(e: ExpressionNode): boolean {
    if (e.kind !== "CallExpression") return false;
    const name = calleeName(e.callee);
    if (name === "OrderOpenPrice") return true;
    if (name === "PositionGetDouble" && e.args.some((a) => argText(a)?.includes("POSITION_PRICE_OPEN"))) return true;
    return false;
  }

  /**
   * Q0.10.17 — resolves an `OrderModify`/`PositionModify` new-SL argument
   * into a distance binding PLUS whether that distance is measured from
   * ENTRY price (-> breakeven) or from something else, i.e. current price
   * (-> trailing). Bare `OrderOpenPrice()` (no arithmetic at all) is a
   * zero-offset breakeven. Reuses the exact same `<price> ± <literal>` /
   * `<price> ± (<atrVar>*<literal>)` shapes `resolveRiskLegBinding` already
   * proves for SL/TP legs — never a second arithmetic formula.
   */
  private resolveManagementDistance(expr: ExpressionNode): { binding: RiskLegBinding; baseIsEntryPrice: boolean } | undefined {
    if (this.isEntryPriceExpr(expr)) return { binding: { kind: "fixed-distance", distance: 0 }, baseIsEntryPrice: true };
    if (expr.kind !== "BinaryExpression" || (expr.operator !== "+" && expr.operator !== "-")) return undefined;
    const baseIsEntryPrice = this.isEntryPriceExpr(expr.left) || this.isEntryPriceExpr(expr.right);
    const binding = this.resolveRiskLegBinding(expr);
    if (!binding) return undefined;
    return { binding, baseIsEntryPrice };
  }

  /** `<currentPrice> - OrderOpenPrice() >= <literal>` or `OrderOpenPrice() - <currentPrice> >= <literal>` — the ONE provable "favorable move trigger" shape, shared by breakeven/trailing/partial-close detection. */
  private resolveFavorableTriggerDistance(test: ExpressionNode): number | undefined {
    if (test.kind !== "BinaryExpression" || (test.operator !== ">=" && test.operator !== ">")) return undefined;
    if (test.right.kind !== "Literal" || typeof test.right.value !== "number") return undefined;
    if (test.left.kind !== "BinaryExpression" || test.left.operator !== "-") return undefined;
    const leftIsEntry = this.isEntryPriceExpr(test.left.left);
    const rightIsEntry = this.isEntryPriceExpr(test.left.right);
    if (leftIsEntry === rightIsEntry) return undefined; // both or neither reference entry price -> not provable
    return test.right.value;
  }

  /** `TimeCurrent() - OrderOpenTime() >= <literalSeconds>` (MQL4) or `... - PositionGetInteger(POSITION_TIME) >= ...` (MQL5). Returns the duration in ms. */
  private resolveHoldingDurationTrigger(test: ExpressionNode): number | undefined {
    if (test.kind !== "BinaryExpression" || (test.operator !== ">=" && test.operator !== ">")) return undefined;
    if (test.right.kind !== "Literal" || typeof test.right.value !== "number") return undefined;
    if (test.left.kind !== "BinaryExpression" || test.left.operator !== "-") return undefined;
    const leftName = test.left.left.kind === "CallExpression" ? calleeName(test.left.left.callee) : undefined;
    const rightName = test.left.right.kind === "CallExpression" ? calleeName(test.left.right.callee) : undefined;
    if (leftName !== "TimeCurrent") return undefined;
    if (rightName !== "OrderOpenTime" && rightName !== "PositionGetInteger") return undefined;
    return test.right.value * 1000;
  }

  /** `<lotsVar> * <literal in (0,1)>` or `<literal> * <lotsVar>`, where `<lotsVar>` is bound to `OrderLots()`/`PositionGetDouble(POSITION_VOLUME)`. Returns a 0-100 percentage. */
  private resolvePartialCloseFraction(volumeExpr: ExpressionNode): number | undefined {
    if (volumeExpr.kind !== "BinaryExpression" || volumeExpr.operator !== "*") return undefined;
    const isLotsExpr = (e: ExpressionNode): boolean => {
      if (e.kind !== "CallExpression") return false;
      const name = calleeName(e.callee);
      if (name === "OrderLots") return true;
      if (name === "PositionGetDouble" && e.args.some((a) => argText(a)?.includes("POSITION_VOLUME"))) return true;
      return false;
    };
    for (const [a, b] of [
      [volumeExpr.left, volumeExpr.right],
      [volumeExpr.right, volumeExpr.left],
    ] as const) {
      if (isLotsExpr(a) && b.kind === "Literal" && typeof b.value === "number" && b.value > 0 && b.value < 1) {
        return b.value * 100;
      }
    }
    return undefined;
  }

  /** A shallow, recursive scan for the FIRST call to one of `names` inside a statement, returning the CallExpression node itself (so its arguments can be resolved further) — same traversal shape as `findOrderDirectionIn`. */
  private findCallIn(stmt: StatementNode, names: ReadonlySet<string>): CallExpressionNode | undefined {
    let found: CallExpressionNode | undefined;
    const visitExpr = (e: ExpressionNode): void => {
      if (found) return;
      if (e.kind === "CallExpression") {
        const name = calleeName(e.callee);
        if (name && names.has(name)) {
          found = e;
          return;
        }
        e.args.forEach(visitExpr);
      } else if (e.kind === "BinaryExpression" || e.kind === "AssignmentExpression") {
        visitExpr(e.kind === "BinaryExpression" ? e.left : e.target);
        visitExpr(e.kind === "BinaryExpression" ? e.right : e.value);
      } else if (e.kind === "UnaryExpression") visitExpr(e.argument);
    };
    const visitStmt = (s: StatementNode): void => {
      if (found) return;
      if (s.kind === "BlockStatement") s.body.forEach(visitStmt);
      else if (s.kind === "IfStatement") {
        visitStmt(s.consequent);
        if (s.alternate) visitStmt(s.alternate);
      } else if (s.kind === "ExpressionStatement") visitExpr(s.expression);
    };
    visitStmt(stmt);
    return found;
  }

  private static readonly MODIFY_FUNCTIONS = new Set(["OrderModify", "PositionModify"]);
  private static readonly CLOSE_FUNCTIONS = new Set(["OrderClose", "PositionClosePartial", "PositionClose"]);

  /**
   * Q0.10.17 — the top-level position-management pattern detector, hooked
   * into every `if` statement walked (mirroring `detectSimpleEntryCondition`).
   * Tries, in order: BREAKEVEN/TRAILING via a modify call's new-SL
   * argument, then PARTIAL_CLOSE via a fractional close volume — both
   * behind the SAME favorable-move trigger shape — then MAX_HOLDING via
   * the independent time-based trigger shape. Never records more than one
   * pattern per `if` (the first provable match wins); an `if` matching
   * none of these shapes contributes nothing here (Q0.8's existing
   * `modifyCalls`/`partialCloseCalls` detection still records the raw
   * call site regardless, so nothing is silently lost from the model).
   */
  private detectManagementPattern(test: ExpressionNode, consequent: StatementNode): void {
    const triggerDistance = this.resolveFavorableTriggerDistance(test);
    if (triggerDistance !== undefined) {
      const modifyCall = this.findCallIn(consequent, SemanticAnalyzer.MODIFY_FUNCTIONS);
      if (modifyCall) {
        const slArgIndex = calleeName(modifyCall.callee) === "OrderModify" ? 2 : 1;
        const slArgExpr = modifyCall.args[slArgIndex];
        const resolved = slArgExpr ? this.resolveManagementDistance(slArgExpr) : undefined;
        if (resolved) {
          this.managementPatterns.push({
            kind: resolved.baseIsEntryPrice ? "BREAKEVEN" : "TRAILING",
            triggerDistance: { kind: "fixed-distance", distance: triggerDistance },
            offsetOrDistance: resolved.binding,
            position: test.position,
          });
          return;
        }
      }

      const closeCall = this.findCallIn(consequent, new Set(["OrderClose", "PositionClosePartial"]));
      if (closeCall) {
        const volumeArgExpr = closeCall.args[1];
        const percent = volumeArgExpr ? this.resolvePartialCloseFraction(volumeArgExpr) : undefined;
        if (percent !== undefined) {
          this.managementPatterns.push({
            kind: "PARTIAL_CLOSE",
            triggerDistance: { kind: "fixed-distance", distance: triggerDistance },
            closePercent: percent,
            position: test.position,
          });
          return;
        }
      }
    }

    const holdingMs = this.resolveHoldingDurationTrigger(test);
    if (holdingMs !== undefined) {
      const fullClose = this.findCallIn(consequent, SemanticAnalyzer.CLOSE_FUNCTIONS);
      if (fullClose) {
        this.managementPatterns.push({ kind: "MAX_HOLDING", maxDurationMs: holdingMs, position: test.position });
      }
    }
  }

  // -------------------------------------------------------------------
  // Q0.13 — pending-order management detection (OrderModify/OrderDelete/
  // PositionModify/PositionClose, both MQL4-bare and MQL5-CTrade-method
  // call shapes). Additive: touches NONE of the existing modifyCalls/
  // managementPatterns/positionQueries logic above.
  // -------------------------------------------------------------------

  private static readonly PENDING_MGMT_CALL_NAMES = new Set(["OrderModify", "OrderDelete", "PositionModify", "PositionClose"]);

  /** Best-effort, non-authoritative source-text reconstruction for provenance/display only — never used for semantic decisions (those always go through the typed AST directly). */
  private describeExpr(e: ExpressionNode): string {
    switch (e.kind) {
      case "Identifier":
        return e.name;
      case "Literal":
        return String(e.value);
      case "UnaryExpression":
        return `${e.operator}${this.describeExpr(e.argument)}`;
      case "BinaryExpression":
        return `${this.describeExpr(e.left)} ${e.operator} ${this.describeExpr(e.right)}`;
      case "AssignmentExpression":
        return `${this.describeExpr(e.target)} ${e.operator} ${this.describeExpr(e.value)}`;
      case "CallExpression":
        return `${calleeName(e.callee) ?? "?"}(${e.args.map((a) => this.describeExpr(a)).join(", ")})`;
      case "MemberExpression":
        return `${this.describeExpr(e.object)}.${e.property}`;
      case "IndexExpression":
        return `${this.describeExpr(e.object)}[${this.describeExpr(e.index)}]`;
      case "ConditionalExpression":
        return `${this.describeExpr(e.test)} ? ${this.describeExpr(e.consequent)} : ${this.describeExpr(e.alternate)}`;
    }
  }

  /** `OrderType() == <OP_CONST>` / `PositionGetInteger(POSITION_TYPE) == <CONST>`, either operand order — the ONE structural order-type filter shape this importer reconstructs (Q0.13.8). */
  private resolveOrderTypeFilter(test: ExpressionNode): string | undefined {
    if (test.kind !== "BinaryExpression" || test.operator !== "==") return undefined;
    const isTypeQuery = (e: ExpressionNode): boolean => e.kind === "CallExpression" && (calleeName(e.callee) === "OrderType" || (calleeName(e.callee) === "PositionGetInteger" && e.args.some((a) => argText(a)?.includes("POSITION_TYPE"))));
    const constText = (e: ExpressionNode): string | undefined => (e.kind === "Identifier" ? e.name : undefined);
    if (isTypeQuery(test.left)) return constText(test.right);
    if (isTypeQuery(test.right)) return constText(test.left);
    return undefined;
  }

  /** Q0.13.5 — structural-only target resolution: never traces an earlier `OrderSelect`/`PositionSelect` call forward (see semantic-model.ts's `PendingOrderTargetSite` doc comment for the exact, documented scope boundary). */
  private resolvePendingOrderTarget(argExpr: ExpressionNode | undefined): PendingOrderTargetSite {
    if (!argExpr) return { kind: "UNKNOWN" };
    if (argExpr.kind === "Identifier" && argExpr.name === "_Symbol") return { kind: "SYMBOL", sourceExpr: argExpr.name };
    if (argExpr.kind === "CallExpression" && calleeName(argExpr.callee) === "Symbol") return { kind: "SYMBOL", sourceExpr: "Symbol()" };
    if (argExpr.kind === "Literal" && typeof argExpr.value === "string") return { kind: "SYMBOL", sourceExpr: String(argExpr.value) };
    if (argExpr.kind === "Identifier") return { kind: "TICKET", sourceExpr: argExpr.name };
    const text = argText(argExpr);
    return { kind: "UNKNOWN", ...(text !== undefined ? { sourceExpr: text } : {}) };
  }

  private resolvePendingOrderCondition(test: ExpressionNode): PendingOrderConditionSite {
    const orderTypeConstant = this.resolveOrderTypeFilter(test);
    if (orderTypeConstant !== undefined) return { kind: "ORDER_TYPE_FILTER", orderTypeConstant, sourceExpr: this.describeExpr(test) };
    const triggerDistance = this.resolveFavorableTriggerDistance(test);
    if (triggerDistance !== undefined) return { kind: "FAVORABLE_DISTANCE", favorableTriggerDistance: { kind: "fixed-distance", distance: triggerDistance }, sourceExpr: this.describeExpr(test) };
    return { kind: "UNKNOWN", sourceExpr: this.describeExpr(test) };
  }

  /**
   * Q0.13.6/7 — the literal call name IS the classification; never
   * collapsed. `targetArgIndex` is arg 0 for every one of these calls
   * (ticket-or-symbol always comes first). `priceArgIndex`/
   * `expirationArgIndex` are set ONLY for OrderModify (its pending-order
   * price/expiration arguments) — MQL4's bare `OrderModify(ticket, price,
   * sl, tp, expiration, [color])` vs MQL5's `CTrade::OrderModify(ticket,
   * price, sl, tp, type_time, expiration, stoplimit)` have the SAME price
   * position (arg 1) but a DIFFERENT expiration position (arg 4 vs arg
   * 5) — never assumed identical merely because the function name matches.
   */
  private classifyPendingManagementCall(callExpr: CallExpressionNode): { functionName: PendingOrderManagementFunctionName; targetArgIndex: number; priceArgIndex?: number; expirationArgIndex?: number } | undefined {
    const name = calleeName(callExpr.callee);
    if (!name) return undefined;
    const isMethodCall = callExpr.callee.kind === "MemberExpression";
    if (name === "OrderDelete") return { functionName: isMethodCall ? "CTrade.OrderDelete" : "OrderDelete", targetArgIndex: 0 };
    if (name === "PositionClose") return { functionName: isMethodCall ? "CTrade.PositionClose" : "PositionClose", targetArgIndex: 0 };
    if (name === "PositionModify") return { functionName: isMethodCall ? "CTrade.PositionModify" : "PositionModify", targetArgIndex: 0 };
    if (name === "OrderModify") {
      return isMethodCall
        ? { functionName: "CTrade.OrderModify", targetArgIndex: 0, priceArgIndex: 1, expirationArgIndex: 5 }
        : { functionName: "OrderModify", targetArgIndex: 0, priceArgIndex: 1, expirationArgIndex: 4 };
    }
    return undefined;
  }

  private buildPendingOrderManagementCallSite(callExpr: CallExpressionNode, classified: NonNullable<ReturnType<SemanticAnalyzer["classifyPendingManagementCall"]>>, condition: PendingOrderConditionSite): PendingOrderManagementCallSite {
    const target = this.resolvePendingOrderTarget(callExpr.args[classified.targetArgIndex]);
    const priceArgExpr = classified.priceArgIndex !== undefined ? callExpr.args[classified.priceArgIndex] : undefined;
    const newPriceExpr = priceArgExpr !== undefined ? argText(priceArgExpr) : undefined;
    const newPriceBinding = priceArgExpr !== undefined ? this.resolveRiskLegBinding(priceArgExpr) : undefined;
    const newExpirationExprRaw = classified.expirationArgIndex !== undefined ? argText(callExpr.args[classified.expirationArgIndex]) : undefined;
    const newExpirationExpr = newExpirationExprRaw !== undefined && newExpirationExprRaw !== "0" ? newExpirationExprRaw : undefined;
    return {
      functionName: classified.functionName,
      target,
      condition,
      ...(newPriceExpr !== undefined ? { newPriceExpr } : {}),
      ...(newPriceBinding !== undefined ? { newPriceBinding } : {}),
      ...(newExpirationExpr !== undefined ? { newExpirationExpr } : {}),
      position: callExpr.position,
    };
  }

  /**
   * Q0.13.8 — the CONDITIONAL detector, hooked into every `if` walked
   * (mirrors `detectManagementPattern`'s established pattern exactly),
   * running BEFORE the consequent is generically walked so it can pull
   * the call's own arguments directly via `findCallIn` — never relying on
   * `detectCall`'s later, unconditional-case traversal to have already
   * fired. Marks the call's position as "already recorded" so the
   * unconditional fallback in `detectCall` never double-books it.
   */
  private detectPendingOrderManagementConditional(test: ExpressionNode, consequent: StatementNode): void {
    const callExpr = this.findCallIn(consequent, SemanticAnalyzer.PENDING_MGMT_CALL_NAMES);
    if (!callExpr) return;
    const classified = this.classifyPendingManagementCall(callExpr);
    if (!classified) return;
    this.recordedPendingManagementPositions.add(`${callExpr.position.line}:${callExpr.position.column}`);
    const condition = this.resolvePendingOrderCondition(test);
    this.pendingOrderManagementCalls.push(this.buildPendingOrderManagementCallSite(callExpr, classified, condition));
  }

  /** The UNCONDITIONAL case — a top-level call to one of these four functions with no enclosing `if` at all (a real, fully-provable case, never "unknown"). Called from `detectCall`'s own dispatch. */
  private recordUnconditionalPendingManagementIfNeeded(expr: CallExpressionNode, _pos: SourcePosition): void {
    const key = `${expr.position.line}:${expr.position.column}`;
    if (this.recordedPendingManagementPositions.has(key)) return;
    const classified = this.classifyPendingManagementCall(expr);
    if (!classified) return;
    this.pendingOrderManagementCalls.push(this.buildPendingOrderManagementCallSite(expr, classified, { kind: "UNCONDITIONAL" }));
  }

  private classifyBarTickMode(fn: FunctionDeclarationNode): BarTickMode {
    if (fn.name === "OnTimer") return "TIMER";
    if (fn.name === "OnTrade" || fn.name === "OnTradeTransaction") return "TRADE_EVENT";
    if (fn.name === "OnTick" || fn.name === "start") return "TICK"; // never assumed to mean bar-close (Q0.8.9) — refined below once new-bar sites are known
    return "UNKNOWN";
  }

  /** Q0.8.36 — does this LOCALLY-DEFINED function's body read live bid/ask anywhere (transitively, one hop)? */
  private functionReadsBidAsk(fnName: string): boolean {
    if (this.functionsReadingBidAsk.has(fnName)) return true;
    const fn = this.functions.find((f) => f.name === fnName);
    if (!fn) return false;
    let found = false;
    const visitExpr = (e: ExpressionNode): void => {
      if (e.kind === "CallExpression") {
        const name = calleeName(e.callee);
        if (name === "SymbolInfoDouble" && e.args.some((a) => argText(a) === "SYMBOL_BID" || argText(a) === "SYMBOL_ASK")) found = true;
        visitExpr(e.callee);
        e.args.forEach(visitExpr);
      } else if (e.kind === "BinaryExpression" || e.kind === "AssignmentExpression") {
        visitExpr(e.kind === "BinaryExpression" ? e.left : e.target);
        visitExpr(e.kind === "BinaryExpression" ? e.right : e.value);
      } else if (e.kind === "UnaryExpression") visitExpr(e.argument);
      else if (e.kind === "MemberExpression") visitExpr(e.object);
      else if (e.kind === "IndexExpression") {
        visitExpr(e.object);
        visitExpr(e.index);
      } else if (e.kind === "ConditionalExpression") {
        visitExpr(e.test);
        visitExpr(e.consequent);
        visitExpr(e.alternate);
      }
    };
    const visitStmt = (s: StatementNode): void => {
      if (s.kind === "BlockStatement") s.body.forEach(visitStmt);
      else if (s.kind === "IfStatement") {
        visitExpr(s.test);
        visitStmt(s.consequent);
        if (s.alternate) visitStmt(s.alternate);
      } else if (s.kind === "ForStatement") {
        if (s.init) visitStmt(s.init);
        if (s.test) visitExpr(s.test);
        if (s.update) visitExpr(s.update);
        visitStmt(s.body);
      } else if (s.kind === "ExpressionStatement") visitExpr(s.expression);
      else if (s.kind === "ReturnStatement" && s.argument) visitExpr(s.argument);
      else if (s.kind === "VariableDeclarationStatement") s.declarators.forEach((d) => d.initializer && visitExpr(d.initializer));
    };
    visitStmt(fn.body);
    if (found) this.functionsReadingBidAsk.add(fnName);
    return found;
  }

  /** Q0.8.23's "top-level, unconditional call" detection for the realtime-dependency heuristic (Q0.8.35). */
  private checkUnconditionalRealtimeCalls(fnName: string, body: readonly StatementNode[]): void {
    if (fnName !== "OnTick" && fnName !== "start") return;
    for (const stmt of body) {
      if (stmt.kind === "ExpressionStatement" && stmt.expression.kind === "CallExpression") {
        const name = calleeName(stmt.expression.callee);
        if (name && this.functionReadsBidAsk(name)) {
          this.pushUnsupported("ACCOUNT_DEPENDENCY", `${name} (unconditional realtime bid/ask read in ${fnName})`, stmt.position);
        }
      }
    }
  }

  private walkStatement(stmt: StatementNode, fnName: string, _guardedByNewBar: boolean): void {
    switch (stmt.kind) {
      case "BlockStatement":
        this.checkUnconditionalRealtimeCalls(fnName, stmt.body);
        stmt.body.forEach((s) => this.walkStatement(s, fnName, _guardedByNewBar));
        return;
      case "IfStatement": {
        const guardsNewBar = this.testLooksLikeNewBarGuard(stmt.test, fnName);
        this.detectSimpleEntryCondition(stmt.test, stmt.consequent);
        this.detectManagementPattern(stmt.test, stmt.consequent);
        this.detectPendingOrderManagementConditional(stmt.test, stmt.consequent);
        this.walkExpression(stmt.test, fnName);
        this.walkStatement(stmt.consequent, fnName, guardsNewBar);
        if (stmt.alternate) this.walkStatement(stmt.alternate, fnName, _guardedByNewBar);
        return;
      }
      case "ForStatement":
        if (stmt.init) this.walkStatement(stmt.init, fnName, _guardedByNewBar);
        if (stmt.test) this.walkExpression(stmt.test, fnName);
        if (stmt.update) this.walkExpression(stmt.update, fnName);
        this.walkStatement(stmt.body, fnName, _guardedByNewBar);
        return;
      case "ExpressionStatement":
        this.walkExpression(stmt.expression, fnName);
        return;
      case "ReturnStatement":
        if (stmt.argument) this.walkExpression(stmt.argument, fnName);
        return;
      case "VariableDeclarationStatement":
        stmt.declarators.forEach((d) => {
          if (d.initializer) {
            this.recordIndicatorBindingIfApplicable(d.name, d.initializer);
            this.walkExpression(d.initializer, fnName);
          }
        });
        return;
      case "UnparsedStatement":
        return;
    }
  }

  private testLooksLikeNewBarGuard(test: ExpressionNode, fnName: string): boolean {
    if (test.kind !== "CallExpression") return false;
    const name = calleeName(test.callee);
    if (!name) return false;
    const isCustomNewBar = /newbar/i.test(name);
    if (isCustomNewBar) {
      this.newBarDetectionSites.push({ pattern: "CUSTOM_FUNCTION_CALL", provable: false, calleeName: name, position: test.position });
      this.diagnostics.push(diagnostic("NEW_BAR_UNPROVABLE", `"${name}" (called in ${fnName}) looks like a new-bar check by name, but its body is not analyzed by this importer (likely defined in an #include) — cannot prove new-bar semantics`, "WARNING", test.position));
      return true; // treated as a plausible new-bar guard for the realtime-dependency heuristic, even though unproven
    }
    return false;
  }

  private walkExpression(expr: ExpressionNode, fnName: string): void {
    switch (expr.kind) {
      case "BinaryExpression":
        this.detectTimeComparisonNewBar(expr, fnName);
        this.detectCrossPattern(expr, fnName);
        this.walkExpression(expr.left, fnName);
        this.walkExpression(expr.right, fnName);
        return;
      case "AssignmentExpression":
        // A bare identifier target (`g_x = 5`) is WRITE-ONLY — walking it
        // again as a generic expression would double-count it as a READ
        // too (Identifier case below records reads). A non-identifier
        // target (`arr[g_index] = 5`) genuinely may contain reads (e.g.
        // `g_index`), so it is still walked normally.
        if (expr.target.kind === "Identifier") {
          this.recordGlobalAccess(expr.target.name, expr.position, true);
          this.recordIndicatorBindingIfApplicable(expr.target.name, expr.value);
        } else this.walkExpression(expr.target, fnName);
        this.walkExpression(expr.value, fnName);
        return;
      case "UnaryExpression":
        this.walkExpression(expr.argument, fnName);
        return;
      case "ConditionalExpression":
        this.walkExpression(expr.test, fnName);
        this.walkExpression(expr.consequent, fnName);
        this.walkExpression(expr.alternate, fnName);
        return;
      case "MemberExpression":
        this.walkExpression(expr.object, fnName);
        return;
      case "IndexExpression":
        this.detectSeriesIndex(expr, fnName);
        this.walkExpression(expr.object, fnName);
        this.walkExpression(expr.index, fnName);
        return;
      case "CallExpression":
        this.detectCall(expr, fnName);
        this.walkExpression(expr.callee, fnName);
        expr.args.forEach((a) => this.walkExpression(a, fnName));
        return;
      case "Identifier":
        if (this.globalReadPositions.has(expr.name)) this.recordGlobalAccess(expr.name, expr.position, false);
        return;
      case "Literal":
        return;
    }
  }

  /** `Time[0] != lastTime`-shaped comparison — Q0.8.10's TIME_COMPARISON pattern. */
  private detectTimeComparisonNewBar(expr: import("../../domain/mql-importer/ast.js").BinaryExpressionNode, _fnName: string): void {
    if (expr.operator !== "!=" && expr.operator !== "==") return;
    const isTimeIndex = (e: ExpressionNode) => e.kind === "IndexExpression" && e.object.kind === "Identifier" && e.object.name === "Time";
    if (isTimeIndex(expr.left) || isTimeIndex(expr.right)) {
      this.newBarDetectionSites.push({ pattern: "TIME_COMPARISON", provable: true, position: expr.position });
    }
  }

  /** Q0.8.16 — ONLY the provable `A[1] <= B[1] && A[0] > B[0]` (or inverse) shape; never a rewrite of an arbitrary comparison. */
  private detectCrossPattern(expr: import("../../domain/mql-importer/ast.js").BinaryExpressionNode, _fnName: string): void {
    if (expr.operator !== "&&") return;
    const l = expr.left;
    const r = expr.right;
    if (l.kind !== "BinaryExpression" || r.kind !== "BinaryExpression") return;
    const seriesKey = (e: ExpressionNode): string | undefined => {
      if (e.kind === "IndexExpression" && e.object.kind === "Identifier") return e.object.name;
      if (e.kind === "CallExpression") return calleeName(e.callee);
      return undefined;
    };
    const offsetOf = (e: ExpressionNode): number | undefined => (e.kind === "IndexExpression" && e.index.kind === "Literal" && typeof e.index.value === "number" ? e.index.value : undefined);

    const prevOk = (l.operator === "<=" || l.operator === ">=") && offsetOf(l.left) === 1 && offsetOf(l.right) === 1;
    const currOk = (r.operator === ">" || r.operator === "<") && offsetOf(r.left) === 0 && offsetOf(r.right) === 0;
    if (!prevOk || !currOk) return;
    const sameA = seriesKey(l.left) === seriesKey(r.left);
    const sameB = seriesKey(l.right) === seriesKey(r.right);
    if (!sameA || !sameB) return;

    const direction = l.operator === "<=" && r.operator === ">" ? "cross_above" : l.operator === ">=" && r.operator === "<" ? "cross_below" : undefined;
    if (!direction) return;
    this.crossPatterns.push({ direction, leftExpr: seriesKey(l.left) ?? "?", rightExpr: seriesKey(l.right) ?? "?", position: expr.position });
  }

  private detectSeriesIndex(expr: import("../../domain/mql-importer/ast.js").IndexExpressionNode, _fnName: string): void {
    if (expr.object.kind !== "Identifier") return;
    const series = SERIES_IDENTIFIERS[expr.object.name];
    if (!series) return;

    if (expr.index.kind === "UnaryExpression" && expr.index.operator === "-") {
      this.diagnostics.push(diagnostic("FUTURE_SHIFT_REJECTED", `${expr.object.name}[-...] is a future (negative) offset — rejected, never silently clamped (Q0.8.12/34)`, "BLOCKING", expr.position));
      return;
    }
    if (expr.index.kind !== "Literal" || typeof expr.index.value !== "number" || !Number.isInteger(expr.index.value) || expr.index.value < 0) {
      this.diagnostics.push(diagnostic("NON_LITERAL_SHIFT", `${expr.object.name}[...] offset is not a provable non-negative integer literal`, "WARNING", expr.position));
      return;
    }
    this.seriesReferences.push({ series, offset: expr.index.value, sourceFunction: `${expr.object.name}[]`, position: expr.position });
  }

  private detectCall(expr: CallExpressionNode, fnName: string): void {
    const name = calleeName(expr.callee);
    if (!name) return;
    const pos = expr.position;

    // Unsupported / blocking categories (Q0.8.37/38/41) — checked first, always.
    if (name === "iCustom") return this.pushUnsupported("ICUSTOM", name, pos);
    if (name === "WebRequest") return this.pushUnsupported("WEBREQUEST", name, pos);
    if (name === "FileOpen" || name === "FileWrite" || name === "FileRead") return this.pushUnsupported("EXTERNAL_FILE", name, pos);

    // Series-fetching functions (Q0.8.11)
    if (SERIES_FUNCTIONS[name]) {
      const lastArgText = argText(expr.args[expr.args.length - 1]);
      const offset = lastArgText !== undefined && !Number.isNaN(Number(lastArgText)) ? Number(lastArgText) : 0;
      const symbolExpr = expr.args[0] && isSymbolOrTimeframeLiteralish(expr.args[0]) ? argText(expr.args[0]) : undefined;
      const timeframeExpr = expr.args[1] && isSymbolOrTimeframeLiteralish(expr.args[1]) ? argText(expr.args[1]) : undefined;
      this.seriesReferences.push({
        series: SERIES_FUNCTIONS[name]!,
        offset,
        sourceFunction: name,
        ...(symbolExpr !== undefined ? { symbolExpr } : {}),
        ...(timeframeExpr !== undefined ? { timeframeExpr } : {}),
        position: pos,
      });
      return;
    }
    if (name === "CopyRates" || name === "iTime") {
      this.newBarDetectionSites.push({ pattern: name === "CopyRates" ? "COPYRATES_CALL" : "ITIME_CALL", provable: true, calleeName: name, position: pos });
      return;
    }

    // Indicators (Q0.8.13/14/15) — iMA's FAMILY comes from its `method`
    // argument (MODE_SMA/MODE_EMA/...), never a fixed mapping (a real bug
    // this sprint's own end-to-end testing caught: iMA was previously
    // hardcoded to "SMA" regardless of the method actually passed).
    // iRSI/iATR have a single `period` argument at a known position;
    // iMACD/iBands remain generically parameterized (their multi-output
    // shape has no single-period runtime mapping regardless — see
    // docs/Q0.9_SIMULATION_BRIDGE.md).
    if (name === "iMA" || name === "iRSI" || name === "iATR" || name === "iMACD" || name === "iBands") {
      const resolved = this.resolveIndicatorCallReference(expr);
      if (!resolved) {
        this.pushUnsupported("UNKNOWN_INDICATOR", `${name} with unrecognized or unresolvable method`, pos);
        return;
      }
      const role = this.dialect === "MQL5" ? "HANDLE_CREATION" : "DIRECT_READ";
      this.indicatorCalls.push({ functionName: name, recognizedFamily: resolved.family, role, parameters: resolved.params.map(String), position: pos });
      return;
    }
    if (name === "CopyBuffer") {
      const bufferIndex = expr.args[1]?.kind === "Literal" && typeof expr.args[1].value === "number" ? expr.args[1].value : undefined;
      this.indicatorCalls.push({
        functionName: name,
        role: "BUFFER_COPY",
        ...(expr.args[0]?.kind === "Identifier" ? { handleVariable: expr.args[0].name } : {}),
        ...(bufferIndex !== undefined ? { bufferIndex } : {}),
        parameters: expr.args.map((a) => argText(a) ?? "?"),
        position: pos,
      });
      return;
    }

    // Orders (Q0.8.19/20/21) — MQL4's OrderSend(symbol, cmd, volume, price, slippage, stoploss, takeprofit, comment, magic, expiration, color).
    if (name === "OrderSend") {
      const cmd = argText(expr.args[1]);
      // Q0.11.14 — OP_BUYLIMIT/OP_SELLLIMIT and OP_BUYSTOP/OP_SELLSTOP must be checked BEFORE the
      // plain OP_BUY/OP_SELL prefix match below (which would otherwise also match them).
      const isLimit = cmd === "OP_BUYLIMIT" || cmd === "OP_SELLLIMIT";
      const isStop = cmd === "OP_BUYSTOP" || cmd === "OP_SELLSTOP";
      const side = cmd?.startsWith("OP_BUY") ? "BUY" : cmd?.startsWith("OP_SELL") ? "SELL" : undefined;
      const pendingOrderType: "MARKET" | "LIMIT" | "STOP" | undefined = isLimit ? "LIMIT" : isStop ? "STOP" : side !== undefined ? "MARKET" : undefined;
      const volumeExpr = argText(expr.args[2]);
      const priceExpr = argText(expr.args[3]);
      const slExpr = argText(expr.args[5]);
      const tpExpr = argText(expr.args[6]);
      const commentExpr = argText(expr.args[7]);
      const slBinding = slExpr !== undefined ? this.variableRiskBindings.get(slExpr) : undefined;
      const tpBinding = tpExpr !== undefined ? this.variableRiskBindings.get(tpExpr) : undefined;
      this.orderCalls.push({
        style: "OrderSend",
        ...(side !== undefined ? { side } : {}),
        ...(pendingOrderType !== undefined ? { pendingOrderType } : {}),
        ...(volumeExpr !== undefined ? { volumeExpr } : {}),
        ...(priceExpr !== undefined ? { priceExpr } : {}),
        // MQL4's OrderSend has ONE "price" argument, reused by the platform itself as either the
        // market reference price (OP_BUY/OP_SELL) or the pending trigger price (LIMIT/STOP) —
        // this importer never overloads its OWN fields, so the SAME source expression is recorded
        // into whichever of limitPriceExpr/stopPriceExpr matches the detected pending order kind.
        ...(isLimit && priceExpr !== undefined ? { limitPriceExpr: priceExpr } : {}),
        ...(isStop && priceExpr !== undefined ? { stopPriceExpr: priceExpr } : {}),
        ...(slExpr !== undefined ? { slExpr } : {}),
        ...(tpExpr !== undefined ? { tpExpr } : {}),
        ...(slBinding !== undefined ? { slBinding } : {}),
        ...(tpBinding !== undefined ? { tpBinding } : {}),
        ...(commentExpr !== undefined ? { commentExpr } : {}),
        position: pos,
      });
      return;
    }
    if ((name === "Buy" || name === "Sell") && expr.callee.kind === "MemberExpression") {
      const volumeExpr = argText(expr.args[0]);
      const priceExpr = argText(expr.args[2]);
      const slExpr = argText(expr.args[3]);
      const tpExpr = argText(expr.args[4]);
      const commentExpr = argText(expr.args[5]);
      const slBinding = slExpr !== undefined ? this.variableRiskBindings.get(slExpr) : undefined;
      const tpBinding = tpExpr !== undefined ? this.variableRiskBindings.get(tpExpr) : undefined;
      this.orderCalls.push({
        style: name === "Buy" ? "CTrade.Buy" : "CTrade.Sell",
        side: name === "Buy" ? "BUY" : "SELL",
        pendingOrderType: "MARKET",
        ...(volumeExpr !== undefined ? { volumeExpr } : {}),
        ...(priceExpr !== undefined ? { priceExpr } : {}),
        ...(slExpr !== undefined ? { slExpr } : {}),
        ...(tpExpr !== undefined ? { tpExpr } : {}),
        ...(slBinding !== undefined ? { slBinding } : {}),
        ...(tpBinding !== undefined ? { tpBinding } : {}),
        ...(commentExpr !== undefined ? { commentExpr } : {}),
        position: pos,
      });
      return;
    }
    // Q0.11.14 — MQL5 CTrade pending-order methods, previously undetected entirely.
    // Signatures: BuyLimit/SellLimit/BuyStop/SellStop(volume, price, symbol="", sl=0, tp=0, ...);
    // BuyStopLimit/SellStopLimit(volume, price, stoplimit, symbol="", sl=0, tp=0, ...).
    if ((name === "BuyLimit" || name === "SellLimit" || name === "BuyStop" || name === "SellStop") && expr.callee.kind === "MemberExpression") {
      const side: "BUY" | "SELL" = name.startsWith("Buy") ? "BUY" : "SELL";
      const pendingOrderType: "LIMIT" | "STOP" = name.endsWith("Limit") ? "LIMIT" : "STOP";
      const volumeExpr = argText(expr.args[0]);
      const priceExpr = argText(expr.args[1]);
      const slExpr = argText(expr.args[3]);
      const tpExpr = argText(expr.args[4]);
      const slBinding = slExpr !== undefined ? this.variableRiskBindings.get(slExpr) : undefined;
      const tpBinding = tpExpr !== undefined ? this.variableRiskBindings.get(tpExpr) : undefined;
      this.orderCalls.push({
        style: `CTrade.${name}` as import("../../domain/mql-importer/semantic-model.js").MQLOrderStyle,
        side,
        pendingOrderType,
        ...(volumeExpr !== undefined ? { volumeExpr } : {}),
        ...(pendingOrderType === "LIMIT" && priceExpr !== undefined ? { limitPriceExpr: priceExpr } : {}),
        ...(pendingOrderType === "STOP" && priceExpr !== undefined ? { stopPriceExpr: priceExpr } : {}),
        ...(slExpr !== undefined ? { slExpr } : {}),
        ...(tpExpr !== undefined ? { tpExpr } : {}),
        ...(slBinding !== undefined ? { slBinding } : {}),
        ...(tpBinding !== undefined ? { tpBinding } : {}),
        position: pos,
      });
      return;
    }
    if ((name === "BuyStopLimit" || name === "SellStopLimit") && expr.callee.kind === "MemberExpression") {
      const side: "BUY" | "SELL" = name.startsWith("Buy") ? "BUY" : "SELL";
      const volumeExpr = argText(expr.args[0]);
      const stopPriceExpr = argText(expr.args[1]);
      const limitPriceExpr = argText(expr.args[2]);
      const slExpr = argText(expr.args[4]);
      const tpExpr = argText(expr.args[5]);
      const slBinding = slExpr !== undefined ? this.variableRiskBindings.get(slExpr) : undefined;
      const tpBinding = tpExpr !== undefined ? this.variableRiskBindings.get(tpExpr) : undefined;
      this.orderCalls.push({
        style: `CTrade.${name}` as import("../../domain/mql-importer/semantic-model.js").MQLOrderStyle,
        side,
        pendingOrderType: "STOP_LIMIT",
        ...(volumeExpr !== undefined ? { volumeExpr } : {}),
        ...(limitPriceExpr !== undefined ? { limitPriceExpr } : {}),
        ...(stopPriceExpr !== undefined ? { stopPriceExpr } : {}),
        ...(slExpr !== undefined ? { slExpr } : {}),
        ...(tpExpr !== undefined ? { tpExpr } : {}),
        ...(slBinding !== undefined ? { slBinding } : {}),
        ...(tpBinding !== undefined ? { tpBinding } : {}),
        position: pos,
      });
      return;
    }

    // Position/order state queries (Q0.8.23)
    if (POSITION_QUERY_FUNCTIONS.has(name)) {
      this.positionQueries.push({ functionName: name, position: pos });
      return;
    }

    // Modify / partial close (Q0.8.25/26)
    if (name === "OrderModify" || name === "PositionModify") {
      this.modifyCalls.push({ functionName: name, classification: "UNKNOWN", position: pos });
      this.recordUnconditionalPendingManagementIfNeeded(expr, pos);
      return;
    }
    // Q0.13.6/7 — OrderDelete/PositionClose have no Q0.8-era generic bucket at all: a bare,
    // unguarded `PositionClose(ticket)` previously fell through all the way to
    // UNRESOLVED_CROSS_FILE_CALL below — a real, narrow, pre-existing gap fixed additively here
    // (see docs/Q0.13_EXISTING_ARCHITECTURE_AUDIT.md).
    if (name === "OrderDelete" || name === "PositionClose") {
      this.recordUnconditionalPendingManagementIfNeeded(expr, pos);
      return;
    }
    if (name === "OrderClose" && expr.args.length >= 2) {
      const volumeExpr = argText(expr.args[1]);
      this.partialCloseCalls.push({ functionName: name, ...(volumeExpr !== undefined ? { volumeExpr } : {}), position: pos });
      return;
    }
    if (name === "PositionClosePartial") {
      const volumeExpr = argText(expr.args[1]);
      this.partialCloseCalls.push({ functionName: name, ...(volumeExpr !== undefined ? { volumeExpr } : {}), position: pos });
      return;
    }

    // Session/timezone (Q0.8.29/30)
    if (SESSION_TIME_FUNCTIONS.has(name)) {
      const isLocalTime = name === "TimeLocal";
      if (isLocalTime) this.diagnostics.push(diagnostic("LOCAL_TIME_USED", "TimeLocal() depends on the machine's local clock, not broker/server time or UTC — recorded as platform-dependent, never silently treated as UTC (Q0.8.30)", "WARNING", pos));
      this.sessionTimeCalls.push({ functionName: name, isLocalTime, position: pos });
      return;
    }

    // Symbol/timeframe-carrying calls (Q0.8.31/32/33) — any call whose args include a PERIOD_* constant or _Symbol/Symbol().
    const periodArg = expr.args.find((a) => a.kind === "Identifier" && a.name.startsWith("PERIOD_"));
    const symbolArg = expr.args.find((a) => (a.kind === "Identifier" && a.name === "_Symbol") || (a.kind === "CallExpression" && calleeName(a.callee) === "Symbol"));
    if (periodArg || symbolArg) {
      this.symbolTimeframeSites.push({
        functionName: name,
        ...(symbolArg ? { symbolExpr: argText(symbolArg) ?? "_Symbol" } : {}),
        ...(periodArg && periodArg.kind === "Identifier" ? { timeframeExpr: periodArg.name } : {}),
        position: pos,
      });
    }

    // Account/broker dependencies (Q0.8.39)
    if (ACCOUNT_FUNCTIONS.has(name)) {
      this.pushUnsupported("ACCOUNT_DEPENDENCY", name, pos);
      return;
    }
    if ((name === "SymbolInfoInteger" || name === "SymbolInfoDouble") && expr.args.some((a) => a.kind === "Identifier" && BROKER_CONSTRAINT_TOKENS.has(a.name))) {
      this.pushUnsupported("BROKER_CONSTRAINT_DEPENDENCY", name, pos);
      return;
    }
    // A live bid/ask read is a fully-understood MQL built-in (already
    // separately surfaced via the realtime-dependency heuristic above,
    // Q0.8.35) — not an unresolved cross-file call.
    if (name === "SymbolInfoDouble" && expr.args.some((a) => a.kind === "Identifier" && (a.name === "SYMBOL_BID" || a.name === "SYMBOL_ASK"))) {
      return;
    }

    // A call to a function this file DOES define — no cross-file ambiguity, nothing further to flag here (its own body is walked separately).
    if (this.functions.some((f) => f.name === name)) return;

    // A call to a function neither defined here NOR recognized above and
    // not a known MQL built-in either — likely from an unanalyzed
    // #include. Never guessed at; recorded honestly (Q0.8's central rule).
    if (!KNOWN_BENIGN_BUILTINS.has(name) && fnName) {
      this.pushUnsupported("UNRESOLVED_CROSS_FILE_CALL", name, pos);
    }
  }
}

const KNOWN_BENIGN_BUILTINS = new Set([
  "StringFormat", "Print", "PrintFormat", "MathAbs", "MathMax", "MathMin", "MathRound", "MathFloor", "MathCeil",
  "ArrayResize", "ArraySize", "ZeroMemory", "StringFind", "StringLen", "StringSubstr", "NormalizeDouble", "PeriodSeconds",
  "SetExpertMagicNumber", "SetDeviationInPoints", "SetTypeFillingBySymbol",
]);

/**
 * Q0.8's central rule: parsing and semantic interpretation are separate
 * passes. This function takes an already-built `ProgramNode` (produced by
 * `parser.ts`, with zero knowledge of trading semantics) and walks it
 * exactly once to build the `MQLSemanticModel` — the ONLY place in this
 * package that assigns trading meaning to MQL syntax.
 */
export function analyzeMQLSemantics(program: ProgramNode, dialect: MQLDialect): { model: MQLSemanticModel; diagnostics: readonly Diagnostic[] } {
  const globals = program.body.filter((n): n is GlobalVariableDeclarationNode => n.kind === "GlobalVariableDeclaration");
  const functions = program.body.filter((n): n is FunctionDeclarationNode => n.kind === "FunctionDeclaration");
  const inputDefaults = new Map<string, number>();
  for (const node of program.body) {
    if (node.kind === "InputDeclaration" && node.defaultValue.kind === "Literal" && typeof node.defaultValue.value === "number") {
      inputDefaults.set(node.name, node.defaultValue.value);
    }
  }

  const analyzer = new SemanticAnalyzer(dialect, globals, functions, inputDefaults);
  for (const fn of functions) analyzer.analyzeFunction(fn);

  const stateVariables: StateVariableSite[] = [];
  for (const g of globals) {
    for (const d of g.declarators) {
      stateVariables.push({
        name: d.name,
        declaredKind: "global",
        readPositions: analyzer.globalReadPositions.get(d.name) ?? [],
        writePositions: analyzer.globalWritePositions.get(d.name) ?? [],
      });
    }
  }

  const model: MQLSemanticModel = {
    dialect,
    eventHandlers: analyzer.eventHandlers,
    barTickModesByFunction: analyzer.barTickModesByFunction,
    newBarDetectionSites: analyzer.newBarDetectionSites,
    seriesReferences: analyzer.seriesReferences,
    indicatorCalls: analyzer.indicatorCalls,
    crossPatterns: analyzer.crossPatterns,
    stateVariables,
    orderCalls: analyzer.orderCalls,
    positionQueries: analyzer.positionQueries,
    modifyCalls: analyzer.modifyCalls,
    partialCloseCalls: analyzer.partialCloseCalls,
    sessionTimeCalls: analyzer.sessionTimeCalls,
    symbolTimeframeSites: analyzer.symbolTimeframeSites,
    unsupportedConstructs: analyzer.unsupportedConstructs,
    simpleEntryConditions: analyzer.simpleEntryConditions,
    managementPatterns: analyzer.managementPatterns,
    pendingOrderManagementCalls: analyzer.pendingOrderManagementCalls,
  };

  return { model, diagnostics: analyzer.diagnostics };
}
