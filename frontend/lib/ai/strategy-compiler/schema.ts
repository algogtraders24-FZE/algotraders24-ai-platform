// lib/ai/strategy-compiler/schema.ts
// P4 - Natural Language -> Universal Strategy IR (docs/ALGO_TESTING_PRO_ROADMAP.md
// section 10, docs/P4-NL-STRATEGY-COMPILER.md).
//
// The ONE place an LLM's raw text response is turned into a real,
// typed AIStrategyCompilerInput (at24-quant-engine's own Q0.7.46 IR
// safety boundary) - or rejected with real, specific reasons. Never
// trusts the shape of parsed JSON; every field is checked before it is
// used. This is deliberately a SMALLER surface than
// AIStrategyCompilerInput's own full generality (see each validator's
// own comment for what's excluded and why) - the LLM is asked for less
// than the engine could theoretically accept, on purpose: a narrower
// request surface is a narrower failure surface.
import type { Expression, Operand, ComparisonOperator, LogicalOperator } from "at24-quant-engine";
import type { NamedIndicatorIR, NamedIndicatorFamily } from "at24-quant-engine";
import type { Instrument, Timeframe } from "at24-quant-engine";
import type { RiskSpecification, PositionSizingMethod, StopLossRule, TakeProfitRule } from "at24-quant-engine";
import type { AIStrategyCompilerInput } from "at24-quant-engine";

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

export type SchemaResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly SchemaIssue[] };

function fail(path: string, message: string): SchemaIssue {
  return { path, message };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The 7 symbols the real historical-data provider actually supports
 * (frontend/services/algo-test/historical-data/twelve-data-provider.ts's
 * own CANONICAL_TO_TWELVE_DATA_SYMBOL - deliberately duplicated here as a
 * plain string list rather than importing that module's internals,
 * matching that file's own established "deliberately manually-kept-in-
 * sync mirror" convention it already uses for its own sync with
 * lib/market-data/providers/twelve-data.provider.ts - a compiled strategy
 * for a symbol that convention doesn't cover would fail at data-fetch
 * time regardless; checking here gives an honest reason sooner).
 */
export const AI_COMPILER_SUPPORTED_SYMBOLS: readonly string[] = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD"];

/** Matches twelve-data-provider.ts's own ENGINE_TIMEFRAME_TO_TWELVE_DATA_INTERVAL keys exactly - the full set the real data provider supports, not the narrower "5m"-only allowlist algo-test.service.ts's registry-based flow uses for Golden/ref-ema-crossover (those two strategies simply never declared a broader supportedTimeframes list; the underlying provider always supported more). */
export const AI_COMPILER_SUPPORTED_TIMEFRAMES: readonly Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

/**
 * Single-output indicator families only (SMA/EMA/RSI/ATR). MACD and
 * BOLLINGER_BANDS are real, engine-implemented families (Q0.7.5,
 * at24-quant-engine/src/indicators/) but have MULTI-value outputs (e.g.
 * MACD's line/signal/histogram) - `indicatorKey()`'s own design
 * (domain/indicator-reference.ts: `${name}(${params})`, one string key
 * per indicator, no built-in per-field addressing) has no established
 * convention anywhere in this codebase for how an Expression addresses
 * ONE field of a multi-output indicator. Rather than invent one
 * un-reviewed, this phase excludes them - a real, disclosed scope
 * boundary (see docs/P4-NL-STRATEGY-COMPILER.md), not an oversight.
 */
export const AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES: readonly NamedIndicatorFamily[] = ["SMA", "EMA", "RSI", "ATR"];

/** Positional parameter count per family, matching each indicator's own real Params interface exactly (at24-quant-engine/src/indicators/*.ts) - SMA/EMA/RSI/ATR are all single-period indicators. Partial, not a full Record, since MACD/BOLLINGER_BANDS are deliberately excluded (see AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES's own doc comment) - `validateNamedIndicator` already rejects any family not present here before this map is ever indexed. */
const INDICATOR_PARAM_COUNT: Partial<Readonly<Record<NamedIndicatorFamily, number>>> = { SMA: 1, EMA: 1, RSI: 1, ATR: 1 };

function validateInstrument(v: unknown, path: string): SchemaResult<Instrument> {
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };
  const symbol = v.symbol;
  if (typeof symbol !== "string" || !AI_COMPILER_SUPPORTED_SYMBOLS.includes(symbol)) {
    return { ok: false, issues: [fail(`${path}.symbol`, `must be one of: ${AI_COMPILER_SUPPORTED_SYMBOLS.join(", ")} - got ${JSON.stringify(symbol)}`)] };
  }
  return { ok: true, value: { symbol } };
}

function validateTimeframe(v: unknown, path: string): SchemaResult<Timeframe> {
  if (typeof v !== "string" || !AI_COMPILER_SUPPORTED_TIMEFRAMES.includes(v as Timeframe)) {
    return { ok: false, issues: [fail(path, `must be one of: ${AI_COMPILER_SUPPORTED_TIMEFRAMES.join(", ")} - got ${JSON.stringify(v)}`)] };
  }
  return { ok: true, value: v as Timeframe };
}

function validateNamedIndicator(v: unknown, path: string): SchemaResult<NamedIndicatorIR> {
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };
  const family = v.family;
  if (typeof family !== "string" || !AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES.includes(family as (typeof AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES)[number])) {
    return { ok: false, issues: [fail(`${path}.family`, `must be one of: ${AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES.join(", ")} - got ${JSON.stringify(family)}`)] };
  }
  // The membership check above already guarantees `family` is one of the
  // 4 keys INDICATOR_PARAM_COUNT declares - a real guard rather than a
  // non-null assertion, so a future family added to
  // AI_COMPILER_SUPPORTED_INDICATOR_FAMILIES without a matching
  // INDICATOR_PARAM_COUNT entry fails loudly here instead of silently
  // comparing against `undefined`.
  const expectedCount = INDICATOR_PARAM_COUNT[family as NamedIndicatorFamily];
  if (expectedCount === undefined) return { ok: false, issues: [fail(`${path}.family`, `"${family}" is declared supported but has no known parameter count - this is an AI compiler configuration bug, not a client input error`)] };
  const params = v.params;
  if (!Array.isArray(params) || params.length !== expectedCount || !params.every((p) => typeof p === "number" && Number.isFinite(p) && p > 0)) {
    return { ok: false, issues: [fail(`${path}.params`, `must be an array of exactly ${expectedCount} positive finite number(s) for family "${family}"`)] };
  }
  return { ok: true, value: { kind: "named", family: family as NamedIndicatorFamily, params: params as readonly number[] } };
}

/** `indicatorKey()`-compatible identity for a validated indicator - "PRICE" (Golden Strategy's own established close-price pseudo-indicator, at24-quant-engine/src/reference/golden-strategy.ts) has no params and is always available without being declared in `indicators`. */
export function namedIndicatorKey(family: string, params: readonly number[]): string {
  return `${family}(${params.join(",")})`;
}

const PRICE_INDICATOR_NAME = "PRICE";

function validateOperand(v: unknown, path: string, declaredIndicatorKeys: ReadonlySet<string>): SchemaResult<Operand> {
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };
  if (v.kind === "literal") {
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) return { ok: false, issues: [fail(`${path}.value`, "literal operand's value must be a finite number")] };
    return { ok: true, value: { kind: "literal", value: v.value } };
  }
  if (v.kind === "indicator") {
    if (!isRecord(v.ref) || typeof v.ref.name !== "string") return { ok: false, issues: [fail(`${path}.ref`, "indicator operand must carry ref.name")] };
    if (v.ref.name === PRICE_INDICATOR_NAME) return { ok: true, value: { kind: "indicator", ref: { name: PRICE_INDICATOR_NAME, params: [] } } };
    const params = Array.isArray(v.ref.params) ? v.ref.params : [];
    const key = namedIndicatorKey(v.ref.name, params as number[]);
    if (!declaredIndicatorKeys.has(key)) {
      return { ok: false, issues: [fail(`${path}.ref`, `references indicator "${key}", which is not declared in this strategy's own "indicators" array - every referenced indicator must be declared, never implicit`)] };
    }
    return { ok: true, value: { kind: "indicator", ref: { name: v.ref.name, params: params as readonly number[] } } };
  }
  return { ok: false, issues: [fail(`${path}.kind`, `must be "literal" or "indicator" (the "series" raw-price-offset operand is not supported by the AI compiler this phase - use the "${PRICE_INDICATOR_NAME}" pseudo-indicator for current close price) - got ${JSON.stringify(v.kind)}`)] };
}

const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [">", ">=", "<", "<=", "==", "!=", "cross_above", "cross_below"];
const LOGICAL_OPERATORS: readonly LogicalOperator[] = ["AND", "OR", "NOT"];
const MAX_EXPRESSION_DEPTH = 4;

function validateExpression(v: unknown, path: string, declaredIndicatorKeys: ReadonlySet<string>, depth = 0): SchemaResult<Expression> {
  if (depth > MAX_EXPRESSION_DEPTH) return { ok: false, issues: [fail(path, `expression nesting exceeds the maximum depth of ${MAX_EXPRESSION_DEPTH}`)] };
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };

  if (v.type === "comparison") {
    if (typeof v.operator !== "string" || !COMPARISON_OPERATORS.includes(v.operator as ComparisonOperator)) {
      return { ok: false, issues: [fail(`${path}.operator`, `must be one of: ${COMPARISON_OPERATORS.join(", ")}`)] };
    }
    const left = validateOperand(v.left, `${path}.left`, declaredIndicatorKeys);
    const right = validateOperand(v.right, `${path}.right`, declaredIndicatorKeys);
    if (!left.ok || !right.ok) return { ok: false, issues: [...(left.ok ? [] : left.issues), ...(right.ok ? [] : right.issues)] };
    return { ok: true, value: { type: "comparison", operator: v.operator as ComparisonOperator, left: left.value, right: right.value } };
  }

  if (v.type === "logical") {
    if (typeof v.operator !== "string" || !LOGICAL_OPERATORS.includes(v.operator as LogicalOperator)) {
      return { ok: false, issues: [fail(`${path}.operator`, `must be one of: ${LOGICAL_OPERATORS.join(", ")}`)] };
    }
    if (!Array.isArray(v.operands) || v.operands.length === 0) return { ok: false, issues: [fail(`${path}.operands`, "must be a non-empty array")] };
    const results = v.operands.map((op, i) => validateExpression(op, `${path}.operands[${i}]`, declaredIndicatorKeys, depth + 1));
    const issues = results.flatMap((r) => (r.ok ? [] : r.issues));
    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, value: { type: "logical", operator: v.operator as LogicalOperator, operands: results.map((r) => (r as { ok: true; value: Expression }).value) } };
  }

  return { ok: false, issues: [fail(`${path}.type`, `must be "comparison" or "logical" (the "boolean-reference" expression kind is not supported by the AI compiler this phase) - got ${JSON.stringify(v.type)}`)] };
}

function validateSizing(v: unknown, path: string): SchemaResult<PositionSizingMethod> {
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };
  if (v.method === "fixed-quantity") {
    if (typeof v.quantity !== "number" || v.quantity <= 0) return { ok: false, issues: [fail(`${path}.quantity`, "must be a positive number")] };
    return { ok: true, value: { method: "fixed-quantity", quantity: v.quantity } };
  }
  if (v.method === "percent-equity-risk") {
    if (typeof v.percent !== "number" || v.percent <= 0 || v.percent > 100) return { ok: false, issues: [fail(`${path}.percent`, "must be a number in (0, 100]")] };
    return { ok: true, value: { method: "percent-equity-risk", percent: v.percent } };
  }
  return {
    ok: false,
    issues: [fail(`${path}.method`, `must be "fixed-quantity" or "percent-equity-risk" ("fixed-lot" and "atr-based" are real engine-supported sizing methods but are excluded this phase - "atr-based" specifically because Q0.5's own resolvePositionSize() does not implement it, docs/Q0.9 eligibility-gate.ts's own documented boundary) - got ${JSON.stringify(v.method)}`)],
  };
}

function validateStopLoss(v: unknown, path: string): SchemaResult<StopLossRule | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object or omitted")] };
  if (v.type === "fixed-distance") {
    if (typeof v.distance !== "number" || v.distance <= 0) return { ok: false, issues: [fail(`${path}.distance`, "must be a positive number")] };
    return { ok: true, value: { type: "fixed-distance", distance: v.distance } };
  }
  if (v.type === "atr-multiple") {
    if (typeof v.atrMultiple !== "number" || v.atrMultiple <= 0) return { ok: false, issues: [fail(`${path}.atrMultiple`, "must be a positive number")] };
    if (typeof v.atrPeriod !== "number" || v.atrPeriod <= 0) return { ok: false, issues: [fail(`${path}.atrPeriod`, "must be a positive number")] };
    return { ok: true, value: { type: "atr-multiple", atrMultiple: v.atrMultiple, atrPeriod: v.atrPeriod } };
  }
  return { ok: false, issues: [fail(`${path}.type`, `must be "fixed-distance" or "atr-multiple" ("fixed-price" requires knowing an exact price level, unrealistic for a natural-language description) - got ${JSON.stringify(v.type)}`)] };
}

function validateTakeProfit(v: unknown, path: string): SchemaResult<TakeProfitRule | undefined> {
  if (v === undefined || v === null) return { ok: true, value: undefined };
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object or omitted")] };
  if (v.type === "fixed-distance") {
    if (typeof v.distance !== "number" || v.distance <= 0) return { ok: false, issues: [fail(`${path}.distance`, "must be a positive number")] };
    return { ok: true, value: { type: "fixed-distance", distance: v.distance } };
  }
  if (v.type === "risk-multiple") {
    if (typeof v.rMultiple !== "number" || v.rMultiple <= 0) return { ok: false, issues: [fail(`${path}.rMultiple`, "must be a positive number")] };
    return { ok: true, value: { type: "risk-multiple", rMultiple: v.rMultiple } };
  }
  return { ok: false, issues: [fail(`${path}.type`, `must be "fixed-distance" or "risk-multiple" ("fixed-price" requires knowing an exact price level, unrealistic for a natural-language description) - got ${JSON.stringify(v.type)}`)] };
}

function validateRisk(v: unknown, path: string): SchemaResult<RiskSpecification> {
  if (!isRecord(v)) return { ok: false, issues: [fail(path, "must be an object")] };
  const sizing = validateSizing(v.sizing, `${path}.sizing`);
  const stopLoss = validateStopLoss(v.stopLoss, `${path}.stopLoss`);
  const takeProfit = validateTakeProfit(v.takeProfit, `${path}.takeProfit`);
  const issues = [...(sizing.ok ? [] : sizing.issues), ...(stopLoss.ok ? [] : stopLoss.issues), ...(takeProfit.ok ? [] : takeProfit.issues)];
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      sizing: (sizing as { ok: true; value: PositionSizingMethod }).value,
      ...((stopLoss as { ok: true; value: StopLossRule | undefined }).value !== undefined ? { stopLoss: (stopLoss as { ok: true; value: StopLossRule }).value } : {}),
      ...((takeProfit as { ok: true; value: TakeProfitRule | undefined }).value !== undefined ? { takeProfit: (takeProfit as { ok: true; value: TakeProfitRule }).value } : {}),
    },
  };
}

/**
 * The ONE entry point: turns an already-JSON.parse()'d value (never a raw
 * string here - see nl-strategy-compiler.service.ts for the separate,
 * earlier "extract JSON from the LLM's free-text response" step) into a
 * validated AIStrategyCompilerInput, or a full list of every real issue
 * found (never stops at the first one - a caller showing the LLM its own
 * mistakes benefits from the complete list, not one at a time).
 *
 * `executionAssumptions` is deliberately NOT part of the LLM's own
 * output surface - fixed server-side (see the caller) to the same
 * next-bar-open/zero-cost convention Golden Strategy and ref-ema-
 * crossover both already use. Execution/safety assumptions are never an
 * LLM's decision to make.
 */
export function parseAIStrategyCompilerInput(raw: unknown): SchemaResult<Omit<AIStrategyCompilerInput, "executionAssumptions">> {
  if (!isRecord(raw)) return { ok: false, issues: [fail("$", "top-level response must be a JSON object")] };

  const issues: SchemaIssue[] = [];

  const intent = typeof raw.intent === "string" && raw.intent.trim().length > 0 ? raw.intent : undefined;
  if (!intent) issues.push(fail("$.intent", "must be a non-empty string restating the user's request"));

  if (!Array.isArray(raw.instruments) || raw.instruments.length === 0) {
    issues.push(fail("$.instruments", "must be a non-empty array"));
  }
  const instrumentResults = Array.isArray(raw.instruments) ? raw.instruments.map((v, i) => validateInstrument(v, `$.instruments[${i}]`)) : [];
  issues.push(...instrumentResults.flatMap((r) => (r.ok ? [] : r.issues)));

  if (!Array.isArray(raw.timeframes) || raw.timeframes.length === 0) {
    issues.push(fail("$.timeframes", "must be a non-empty array"));
  }
  const timeframeResults = Array.isArray(raw.timeframes) ? raw.timeframes.map((v, i) => validateTimeframe(v, `$.timeframes[${i}]`)) : [];
  issues.push(...timeframeResults.flatMap((r) => (r.ok ? [] : r.issues)));

  if (!Array.isArray(raw.indicators)) issues.push(fail("$.indicators", "must be an array (may be empty if the strategy only ever references price directly)"));
  const indicatorResults = Array.isArray(raw.indicators) ? raw.indicators.map((v, i) => validateNamedIndicator(v, `$.indicators[${i}]`)) : [];
  issues.push(...indicatorResults.flatMap((r) => (r.ok ? [] : r.issues)));

  // Structurally unreachable to keep collecting past this point if any of
  // the above already failed - condition expressions need to know the
  // declared indicator keys, which requires the indicator list to have
  // parsed cleanly first.
  if (issues.length > 0) return { ok: false, issues };

  const declaredIndicatorKeys = new Set(indicatorResults.map((r) => namedIndicatorKey((r as { ok: true; value: NamedIndicatorIR }).value.family, (r as { ok: true; value: NamedIndicatorIR }).value.params as number[])));

  if (!Array.isArray(raw.entryConditions) || raw.entryConditions.length === 0) issues.push(fail("$.entryConditions", "must be a non-empty array"));
  const entryResults = Array.isArray(raw.entryConditions)
    ? raw.entryConditions.map((v, i) => {
        if (!isRecord(v)) return { ok: false as const, issues: [fail(`$.entryConditions[${i}]`, "must be an object")] };
        if (v.direction !== "BUY" && v.direction !== "SELL") return { ok: false as const, issues: [fail(`$.entryConditions[${i}].direction`, `must be "BUY" or "SELL"`)] };
        const cond = validateExpression(v.condition, `$.entryConditions[${i}].condition`, declaredIndicatorKeys);
        if (!cond.ok) return { ok: false as const, issues: cond.issues };
        return { ok: true as const, value: { direction: v.direction as "BUY" | "SELL", condition: cond.value } };
      })
    : [];
  issues.push(...entryResults.flatMap((r) => (r.ok ? [] : r.issues)));

  const exitResults = Array.isArray(raw.exitConditions)
    ? raw.exitConditions.map((v, i) => {
        if (!isRecord(v)) return { ok: false as const, issues: [fail(`$.exitConditions[${i}]`, "must be an object")] };
        const cond = validateExpression(v.condition, `$.exitConditions[${i}].condition`, declaredIndicatorKeys);
        if (!cond.ok) return { ok: false as const, issues: cond.issues };
        if (v.appliesTo !== undefined && v.appliesTo !== "BUY" && v.appliesTo !== "SELL") return { ok: false as const, issues: [fail(`$.exitConditions[${i}].appliesTo`, `must be "BUY", "SELL", or omitted`)] };
        return { ok: true as const, value: { condition: cond.value, ...(v.appliesTo !== undefined ? { appliesTo: v.appliesTo as "BUY" | "SELL" } : {}) } };
      })
    : [];
  issues.push(...exitResults.flatMap((r) => (r.ok ? [] : r.issues)));

  const risk = validateRisk(raw.risk, "$.risk");
  if (!risk.ok) issues.push(...risk.issues);

  // atr-multiple stopLoss requires a matching ATR indicator to actually
  // be declared (eligibility-gate.ts's own real rule, Q0.10.16 - "an
  // atr-multiple risk rule references ATR(N), but no matching ATR
  // indicator is declared... this rule would never fire"). Checked here,
  // before compilation, so the reason is specific to THIS request rather
  // than a generic EXECUTION_VALID failure discovered later.
  if (risk.ok && risk.value.stopLoss?.type === "atr-multiple") {
    const atrKey = namedIndicatorKey("ATR", [risk.value.stopLoss.atrPeriod]);
    if (!declaredIndicatorKeys.has(atrKey)) {
      issues.push(fail("$.risk.stopLoss", `declares an atr-multiple stop using ATR(${risk.value.stopLoss.atrPeriod}), but no matching ATR indicator is declared in "indicators" - add {"family":"ATR","params":[${risk.value.stopLoss.atrPeriod}]}`));
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      intent: intent!,
      instruments: instrumentResults.map((r) => (r as { ok: true; value: Instrument }).value),
      timeframes: timeframeResults.map((r) => (r as { ok: true; value: Timeframe }).value),
      indicators: indicatorResults.map((r) => (r as { ok: true; value: NamedIndicatorIR }).value),
      entryConditions: entryResults.map((r) => (r as { ok: true; value: { direction: "BUY" | "SELL"; condition: Expression } }).value),
      exitConditions: exitResults.map((r) => (r as { ok: true; value: { condition: Expression; appliesTo?: "BUY" | "SELL" } }).value),
      risk: (risk as { ok: true; value: RiskSpecification }).value,
    },
  };
}
