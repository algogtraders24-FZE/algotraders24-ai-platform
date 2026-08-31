import type { SourcePosition } from "./token.js";
import type { PriceSeriesField } from "../strategy-ir/series.js";
import type { NamedIndicatorFamily } from "../strategy-ir/indicator-ir.js";

/** Q0.8.8 — the MQL4/MQL5 event functions this importer recognizes. */
export type MQLEventKind = "MQL4_INIT" | "MQL4_START" | "MQL4_DEINIT" | "MQL5_ONINIT" | "MQL5_ONDEINIT" | "MQL5_ONTICK" | "MQL5_ONTIMER" | "MQL5_ONTRADE" | "MQL5_ONTRADETRANSACTION";

export interface MQLEventHandler {
  readonly kind: MQLEventKind;
  readonly functionName: string;
  readonly position: SourcePosition;
}

/** Q0.8.9 — never assume OnTick means bar-close; this is DETECTED, not assumed. */
export type BarTickMode = "TICK" | "NEW_BAR" | "BAR_CLOSE" | "TIMER" | "TRADE_EVENT" | "UNKNOWN";

/** Q0.8.10 — a recognized new-bar-detection pattern, or an honest admission that one couldn't be proven. */
export interface NewBarDetectionSite {
  readonly pattern: "TIME_COMPARISON" | "ITIME_CALL" | "COPYRATES_CALL" | "COPYBUFFER_CALL" | "CUSTOM_FUNCTION_CALL" | "UNKNOWN";
  readonly provable: boolean;
  readonly calleeName?: string;
  readonly position: SourcePosition;
}

/** Q0.8.11/12 — a price-series access site, WITH its resolved bar offset (never left implicit). */
export interface SeriesReferenceSite {
  readonly series: PriceSeriesField;
  readonly offset: number;
  readonly sourceFunction: string; // e.g. "Close[]", "iClose", "CopyClose"
  readonly symbolExpr?: string;
  readonly timeframeExpr?: string;
  readonly position: SourcePosition;
}

/** Q0.8.13/14/15 — an indicator call site, distinguishing HANDLE creation from a later CopyBuffer/direct read (Q0.8.14's mandatory distinction). */
export interface IndicatorCallSite {
  readonly functionName: string;
  readonly recognizedFamily?: NamedIndicatorFamily;
  readonly role: "HANDLE_CREATION" | "DIRECT_READ" | "BUFFER_COPY";
  readonly handleVariable?: string;
  readonly bufferIndex?: number;
  readonly shift?: number;
  readonly parameters: readonly string[];
  readonly position: SourcePosition;
}

/** Q0.8.16 — only a PROVABLY-equivalent comparison pattern; never a rewrite of an arbitrary comparison. */
export interface CrossPatternSite {
  readonly direction: "cross_above" | "cross_below";
  readonly leftExpr: string;
  readonly rightExpr: string;
  readonly position: SourcePosition;
}

/** Q0.8.17/18 — separates pure series logic from anything the strategy remembers across bars. */
export interface StateVariableSite {
  readonly name: string;
  readonly declaredKind: "global" | "static";
  readonly readPositions: readonly SourcePosition[];
  readonly writePositions: readonly SourcePosition[];
}

/**
 * Q0.11 CONTRACT CHANGE (additive): added the six MQL5 `CTrade`
 * pending-order methods (`BuyLimit`/`SellLimit`/`BuyStop`/`SellStop`/
 * `BuyStopLimit`/`SellStopLimit`) — previously undetected entirely (see
 * docs/Q0.11_PLATFORM_MAPPING.md). Every pre-Q0.11 value is unchanged.
 */
export type MQLOrderStyle =
  | "OrderSend"
  | "CTrade.Buy"
  | "CTrade.Sell"
  | "CTrade.PositionOpen"
  | "CTrade.BuyLimit"
  | "CTrade.SellLimit"
  | "CTrade.BuyStop"
  | "CTrade.SellStop"
  | "CTrade.BuyStopLimit"
  | "CTrade.SellStopLimit";

/** Q0.8.19/20/21 — a detected entry/order call, with parameters kept as SOURCE-TEXT expressions (not evaluated) so a human/future reducer can inspect exactly what was passed. */
/**
 * Q0.9.11/17 — the ONE provable arithmetic shape resolved into a real
 * risk rule: `<price> - <literal>` / `<price> + <literal>` (fixed
 * distance) or `<price> - (<atrVar> * <literal>)` / `... + (...)`
 * (ATR multiple, where `<atrVar>` is itself bound to a recognized ATR
 * indicator call). Anything else — including G01's real
 * `G01_CalculateSL(...)` cross-file call — resolves to `undefined`,
 * never a guess.
 */
export type RiskLegBinding = { readonly kind: "fixed-distance"; readonly distance: number } | { readonly kind: "atr-multiple"; readonly atrMultiple: number; readonly atrPeriod: number };

/**
 * Q0.11 CONTRACT CHANGE (additive): `pendingOrderType` records which of
 * MQL4's `OP_BUY`/`OP_BUYLIMIT`/`OP_BUYSTOP` (and SELL equivalents) command
 * constants was actually used — previously collapsed to plain "BUY"/"SELL"
 * (`cmd?.startsWith("OP_BUY")` matched all three identically). Absent
 * means the call is a plain market order (or the command could not be
 * resolved at all, same as before). `limitPriceExpr`/`stopPriceExpr`
 * capture the pending-order price argument(s) as source text, mirroring
 * `slExpr`/`tpExpr`'s existing pattern — never overloading `priceExpr`
 * (Q0.11.2's "do not overload a single price field" rule).
 */
export interface OrderCallSite {
  readonly style: MQLOrderStyle;
  readonly side?: "BUY" | "SELL";
  readonly pendingOrderType?: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  readonly volumeExpr?: string;
  readonly priceExpr?: string;
  readonly limitPriceExpr?: string;
  readonly stopPriceExpr?: string;
  readonly slExpr?: string;
  readonly tpExpr?: string;
  readonly slBinding?: RiskLegBinding;
  readonly tpBinding?: RiskLegBinding;
  readonly magicExpr?: string;
  readonly commentExpr?: string;
  readonly position: SourcePosition;
}

/** Q0.8.23 — position/order state queries, recorded but not re-interpreted as new semantics. */
export interface PositionQuerySite {
  readonly functionName: string;
  readonly position: SourcePosition;
}

/** Q0.8.25/26/27 — SL/TP modification, distinguishing what CAN be proven trailing/breakeven from what can't (Q0.8.25's explicit "do not assume every modification is trailing"). */
export interface ModifyCallSite {
  readonly functionName: string;
  readonly classification: "SL_MOVE" | "TP_MOVE" | "BOTH" | "UNKNOWN";
  readonly position: SourcePosition;
}

export interface PartialCloseCallSite {
  readonly functionName: string;
  readonly volumeExpr?: string;
  readonly position: SourcePosition;
}

/** Q0.8.29/30 — session/timezone-relevant calls; TimeLocal() is flagged as platform-dependent, never silently treated as UTC/server time. */
export interface SessionTimeCallSite {
  readonly functionName: string;
  readonly isLocalTime: boolean;
  readonly position: SourcePosition;
}

export interface SymbolTimeframeSite {
  readonly functionName: string;
  readonly symbolExpr?: string;
  readonly timeframeExpr?: string;
  readonly position: SourcePosition;
}

/** Q0.8.37/38/39/41 — every construct this importer refuses to guess about, categorized. */
export type UnsupportedCategory =
  | "ICUSTOM"
  | "DLL_IMPORT"
  | "WEBREQUEST"
  | "EXTERNAL_FILE"
  | "UNRESOLVED_CROSS_FILE_CALL"
  | "UNRESOLVED_DYNAMIC_CALL"
  | "UNKNOWN_INDICATOR"
  | "UNSUPPORTED_TRADE_EVENT"
  | "ACCOUNT_DEPENDENCY"
  | "BROKER_CONSTRAINT_DEPENDENCY";

export interface UnsupportedConstructSite {
  readonly category: UnsupportedCategory;
  readonly functionName: string;
  readonly position: SourcePosition;
}

/** An indicator reference resolved either directly (a call expression) or via a local variable's last-assigned indicator call — see `IndicatorReferenceValue` below. */
export interface IndicatorReferenceValue {
  readonly family: NamedIndicatorFamily;
  readonly params: readonly (number | string)[];
}

/** Either side of a `SimpleEntryConditionSite` comparison: a recognized indicator reference, or a plain numeric literal (e.g. RSI's `< 30` threshold) — never anything else. */
export type EntryConditionOperand = { readonly kind: "indicator"; readonly ref: IndicatorReferenceValue } | { readonly kind: "literal"; readonly value: number };

/**
 * Q0.9.11/38 — the ONE provable "simple entry condition" shape this
 * importer reconstructs into a REAL (non-placeholder) Expression: an
 * `if (indicatorA <op> indicatorB)` crossover-style comparison OR an
 * `if (indicator <op> literal)` threshold comparison (e.g. RSI oversold),
 * where at least one side resolves — directly or via a local variable's
 * own last assignment within the SAME function, never across functions —
 * to a recognized indicator call, and the other is either another such
 * indicator or a plain literal. Never a guess: anything not matching
 * this exact shape (G01's real, deeply-nested state-machine entries
 * included) falls back to Q0.8's existing placeholder-condition +
 * BLOCKING behavior, unchanged.
 */
export interface SimpleEntryConditionSite {
  readonly operator: string;
  readonly left: EntryConditionOperand;
  readonly right: EntryConditionOperand;
  readonly orderDirection: "BUY" | "SELL";
  readonly position: SourcePosition;
}

/**
 * Q0.10.17 — the ONE provable shape each of these four position-management
 * patterns is reconstructed from. Never a guess: anything not matching
 * these exact shapes (an arbitrary/dynamic modify condition, a
 * non-fractional-literal partial-close volume, a bar-count-based rather
 * than literal-second holding check) is simply never recorded here, and
 * falls back to the existing honest "detected but unresolved" reporting
 * Q0.8's `ModifyCallSite`/`PartialCloseCallSite` already provide.
 *
 * - BREAKEVEN: `if (<currentPrice> - OrderOpenPrice() >= <literal>) { OrderModify(ticket, ..., OrderOpenPrice() [± <literal>], ...) }`
 *   (the new SL resolves relative to ENTRY price) — `triggerDistance` is the
 *   favorable-move trigger, `offsetOrDistance` is the lock offset (0 = exactly at entry).
 * - TRAILING: same trigger shape, but the new SL resolves to
 *   `<currentPrice> ± <literal>` or `<currentPrice> ± (<atrVar>*<literal>)`
 *   (relative to CURRENT price, not entry) — `offsetOrDistance` is the trail distance.
 * - PARTIAL_CLOSE: same trigger shape, consequent contains
 *   `OrderClose(ticket, <lotsVar> * <literal in (0,1)>, ...)` — `closePercent`
 *   is the resolved fraction as a 0-100 percentage.
 * - MAX_HOLDING: `if (TimeCurrent() - OrderOpenTime() >= <literalSeconds>) { OrderClose(...) }`
 *   — `maxDurationMs` is the resolved duration.
 */
export type ManagementPatternKind = "BREAKEVEN" | "TRAILING" | "PARTIAL_CLOSE" | "MAX_HOLDING";

export interface ManagementPatternSite {
  readonly kind: ManagementPatternKind;
  readonly triggerDistance?: RiskLegBinding;
  readonly offsetOrDistance?: RiskLegBinding;
  readonly closePercent?: number;
  readonly maxDurationMs?: number;
  readonly position: SourcePosition;
}

/**
 * Q0.13.5 — how a pending-order-management call site identifies WHICH
 * order/position it acts on. Resolved structurally from the call's own
 * argument shape only (a ticket-shaped Identifier arg -> "TICKET"; a
 * `_Symbol`/`Symbol()`/string-literal arg -> "SYMBOL") — this importer
 * does NOT trace an `OrderSelect(ticket)`/`PositionSelect(symbol)` call
 * earlier in the same function forward to a later bare `OrderModify()`
 * call with no ticket argument at all (MQL4's "act on whatever is
 * currently selected" idiom) — that would require cross-statement
 * data-flow tracing this importer does not perform anywhere else either
 * (see docs/Q0.13_TARGET_RESOLUTION.md's documented scope boundary).
 * Such a call resolves honestly to "UNKNOWN", never guessed as "the most
 * recently selected order."
 */
export type PendingOrderTargetKind = "TICKET" | "SYMBOL" | "UNKNOWN";

export interface PendingOrderTargetSite {
  readonly kind: PendingOrderTargetKind;
  readonly sourceExpr?: string;
}

/**
 * Q0.13.6/7/8 — the literal MQL call name IS the classification; this
 * importer never collapses `OrderModify`/`CTrade.OrderModify` (acts on a
 * PENDING order) together with `PositionModify`/`CTrade.PositionModify`
 * (acts on an OPEN position's SL/TP — already Q0.10's own domain via
 * `ManagementPatternSite`), nor `OrderDelete`/`CTrade.OrderDelete`
 * (cancels a PENDING order) together with `PositionClose`/`CTrade.PositionClose`
 * (closes an OPEN position). A consumer must switch on `functionName`
 * explicitly — there is no generic "modify/close" union member to fall
 * back to.
 */
export type PendingOrderManagementFunctionName =
  | "OrderModify"
  | "OrderDelete"
  | "PositionModify"
  | "PositionClose"
  | "CTrade.OrderModify"
  | "CTrade.OrderDelete"
  | "CTrade.PositionModify"
  | "CTrade.PositionClose";

/**
 * Q0.13.8 — the ONE structural filter this importer reconstructs from a
 * guarding `if`: an order-type comparison (`OrderType() == OP_BUYSTOP`),
 * which is fully provable and requires no live value (an order's own
 * type never changes) — or Q0.10's existing favorable-distance-trigger
 * shape, reused verbatim (`resolveFavorableTriggerDistance`), applied to
 * a PENDING order's own reference price instead of a position's entry
 * price. `UNCONDITIONAL` means the call is not guarded by any `if` at
 * all (a real, legitimate, fully-provable case — not "unknown"). Anything
 * else structurally present but not reducible to one of these three
 * shapes is honestly `UNKNOWN` — never guessed, never silently dropped
 * (Q0.13.8's own rule: "the condition must remain part of the semantic
 * representation").
 */
export type PendingOrderConditionKind = "UNCONDITIONAL" | "ORDER_TYPE_FILTER" | "FAVORABLE_DISTANCE" | "UNKNOWN";

export interface PendingOrderConditionSite {
  readonly kind: PendingOrderConditionKind;
  /** For ORDER_TYPE_FILTER — the raw MQL constant text being compared against, e.g. "OP_BUYSTOP"/"OP_SELLLIMIT". */
  readonly orderTypeConstant?: string;
  /** For FAVORABLE_DISTANCE — reuses the exact `<price> ± <literal>` / `<price> ± (<atrVar>*<literal>)` shape `resolveFavorableTriggerDistance`/`resolveRiskLegBinding` already prove; never a second arithmetic formula. */
  readonly favorableTriggerDistance?: RiskLegBinding;
  readonly sourceExpr?: string;
}

/**
 * Q0.13.4/6/7 — a single detected pending-order-management call, with its
 * condition (if any) preserved structurally rather than collapsed into a
 * bare enum (Q0.13.8's own critical requirement). Recorded ADDITIVELY
 * alongside (never instead of) Q0.8's existing `modifyCalls`/
 * `positionQueries`/`partialCloseCalls` — this array is the ONE place a
 * future compiler reduces PENDING-order management from; the older
 * arrays remain exactly as they were for every existing (Q0.8/Q0.10)
 * consumer.
 */
export interface PendingOrderManagementCallSite {
  readonly functionName: PendingOrderManagementFunctionName;
  readonly target: PendingOrderTargetSite;
  readonly condition: PendingOrderConditionSite;
  /** Present only for a provable price-modification argument on `OrderModify`/`CTrade.OrderModify` (MQL4's/MQL5's own pending-order "price" argument — never the sl/tp arguments, which Q0.10's existing `managementPatterns` already covers). */
  readonly newPriceExpr?: string;
  /** The SAME `<price> ± <literal>` / `<price> ± (<atrVar>*<literal>)` arithmetic reconstruction `resolveRiskLegBinding` already proves for SL/TP legs, applied to `newPriceExpr`'s own AST (never re-parsed from the flattened string) — present only when that shape is provable. */
  readonly newPriceBinding?: RiskLegBinding;
  /** Present only when a non-zero/non-default expiration argument is detected on `OrderModify`/`CTrade.OrderModify`. */
  readonly newExpirationExpr?: string;
  readonly position: SourcePosition;
}

/**
 * Q0.8.1's `MQLSourceDocument` is the raw-source layer; this is the
 * SEMANTIC layer built from walking the AST — genuinely separate passes
 * (Q0.8's own "parsing and semantic interpretation MUST remain
 * separate" critical rule), never conflated into one "parse-and-guess"
 * step.
 */
export interface MQLSemanticModel {
  readonly dialect: "MQL4" | "MQL5";
  readonly eventHandlers: readonly MQLEventHandler[];
  readonly barTickModesByFunction: ReadonlyMap<string, BarTickMode>;
  readonly newBarDetectionSites: readonly NewBarDetectionSite[];
  readonly seriesReferences: readonly SeriesReferenceSite[];
  readonly indicatorCalls: readonly IndicatorCallSite[];
  readonly crossPatterns: readonly CrossPatternSite[];
  readonly stateVariables: readonly StateVariableSite[];
  readonly orderCalls: readonly OrderCallSite[];
  readonly positionQueries: readonly PositionQuerySite[];
  readonly modifyCalls: readonly ModifyCallSite[];
  readonly partialCloseCalls: readonly PartialCloseCallSite[];
  readonly sessionTimeCalls: readonly SessionTimeCallSite[];
  readonly symbolTimeframeSites: readonly SymbolTimeframeSite[];
  readonly unsupportedConstructs: readonly UnsupportedConstructSite[];
  readonly simpleEntryConditions: readonly SimpleEntryConditionSite[];
  readonly managementPatterns: readonly ManagementPatternSite[];
  /** Q0.13 CONTRACT CHANGE (additive): pending-order modify/delete/cancel call sites, distinct from `modifyCalls`/`managementPatterns` above. Empty for every pre-Q0.13 model shape (nothing removed or renamed). */
  readonly pendingOrderManagementCalls: readonly PendingOrderManagementCallSite[];
}
