// types/algo-test.ts
// P3.2B - the Pro Algo Test wire contract, per docs/P3.1-QUANT-CHART-CONTRACT.md
// and docs/P3.2A-RESULT-CONTRACT.md. This sprint's actual supported request
// space is deliberately narrow (Golden Strategy / XAUUSD / M5 only - see
// algo-test.service.ts's SUPPORTED_* constants) but the shapes below are the
// general contract those docs already specified, not re-invented here.
import type { ChartCandle } from "./chart-data";

/** Only "golden" is runnable this sprint - see algo-test.service.ts. Kept as a string, not a literal union, so a future strategy can be added without a type-level break. */
export type AlgoTestStrategyId = string;

/**
 * P3.3 - the wire shape of one Strategy Registry entry
 * (services/algo-test/strategy-registry.ts's own StrategyDefinition,
 * structurally identical - kept as a separate type here so client code
 * (lib/algo-test/store.ts, AlgoTestPanel.tsx) never imports from
 * services/, matching this codebase's existing types/ vs services/
 * boundary). Returned by GET /api/private/algo-test/strategies.
 */
/** P3.4 - mirrors services/algo-test/strategy-registry.ts's StrategyParameterType exactly (see that file for why only these four). */
export type AlgoTestParameterType = "number" | "integer" | "boolean" | "select";

/** P3.7 - mirrors services/algo-test/strategy-registry.ts's StrategyParameterCategory exactly (P3.4's own signal/risk/execution/provider taxonomy, now a real field). */
export type AlgoTestParameterCategory = "signal" | "risk" | "execution" | "provider";

/**
 * P3.4 - the wire shape of one Strategy Parameter definition (mirrors
 * services/algo-test/strategy-registry.ts's StrategyParameterDefinition).
 * This is metadata ONLY (label/type/default/range/options) - the UI
 * renders controls from this, but the server is the sole authority on
 * what a submitted value actually validates against; the client never
 * gets to define or override this shape (section 15/16 of P3.4's spec).
 */
export interface AlgoTestParameterDefinition {
  id: string;
  label: string;
  description: string;
  type: AlgoTestParameterType;
  category: AlgoTestParameterCategory;
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  required: boolean;
}

/** P3.8 - mirrors at24-quant-engine's STRATEGY_LIFECYCLE_STAGES exactly (docs/P3.8-VALIDATION-EVIDENCE-GATE.md). */
export const ALGO_TEST_LIFECYCLE_STAGES = ["IMPORTED", "PARSED", "IR_VALID", "EXECUTION_VALID", "DATA_VALID", "BACKTEST_VALID", "REPRODUCIBLE", "EVIDENCE_VERIFIED"] as const;
export type AlgoTestLifecycleStage = (typeof ALGO_TEST_LIFECYCLE_STAGES)[number];

/** P3.8 - mirrors at24-quant-engine's StageOutcome exactly. */
export type AlgoTestStageOutcome = "PASSED" | "NOT_APPLICABLE" | "FAILED";

export interface AlgoTestStageResult {
  stage: AlgoTestLifecycleStage;
  outcome: AlgoTestStageOutcome;
  detail?: string;
}

export interface AlgoTestLifecycleResult {
  stages: readonly AlgoTestStageResult[];
  reachedStage: AlgoTestLifecycleStage;
  fullyVerified: boolean;
}

export interface AlgoTestStrategyDefinition {
  strategyId: AlgoTestStrategyId;
  strategyVersion: string;
  displayName: string;
  description: string;
  supportedSymbols: string[];
  /** SignalTimeframe-shaped, e.g. "5m". */
  supportedTimeframes: string[];
  /** P3.4 - this strategyVersion's immutable parameter schema; empty array for a strategy with no genuine, safely-exposable strategy parameters. */
  parameters: AlgoTestParameterDefinition[];
  status: "available";
  /** P3.8 - this strategy's own IMPORTED/PARSED/IR_VALID/EXECUTION_VALID stages (docs/P3.8-VALIDATION-EVIDENCE-GATE.md), known independent of any specific backtest run. */
  importLifecycle: readonly AlgoTestStageResult[];
}

/** P3.4 - a parameter id -> the value actually used for one run. Every declared parameter is always present (defaults filled in server-side) - never a partial object. */
export type AlgoTestParameterValues = Record<string, number | boolean | string>;

export type AlgoTestStatus = "completed" | "failed";

export interface AlgoTestRunRequest {
  strategyId: AlgoTestStrategyId;
  /**
   * P3.3 - optional. When provided, must exactly match the strategy's
   * currently-registered version (services/algo-test/strategy-registry.ts)
   * or the request is rejected with INVALID_STRATEGY_VERSION - this lets a
   * caller pin a version without the server ever silently substituting a
   * different one. When omitted, the server resolves and records the
   * strategy's current registered version itself; every run (with this
   * field set or not) always persists an exact strategyVersion.
   */
  strategyVersion?: string;
  /**
   * P3.4 - raw, client-submitted parameter values (parameter id -> value).
   * Optional entirely, and any individual declared parameter may be
   * omitted (its registered default is used) - never required to submit
   * every parameter explicitly. The server re-resolves the authoritative
   * schema from the registry and validates/normalizes every value; this
   * object is NEVER trusted as a schema, only as submitted values.
   */
  parameters?: Record<string, unknown>;
  symbol: string;
  /** SignalTimeframe-shaped, e.g. "5m" - converted to the engine's own Timeframe token server-side (never exposed to the browser). */
  timeframe: string;
  /** ISO 8601. */
  startTime: string;
  /** ISO 8601. */
  endTime: string;
  initialBalance?: number;
}

/** Directly mirrors the real, non-fabricated fields at24-quant-engine's computeCoreMetrics() + runSimulation() actually populate (docs/P3.1-QUANT-CHART-CONTRACT.md SS2) - no Sharpe/Sortino/Calmar, those are declared-but-not-computed by the engine. */
export interface AlgoTestMetricsView {
  totalReturn: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  winRate: number;
  expectancy: number;
  maxDrawdown: number;
  averageTrade: number;
  tradeCount: number;
  averageR: number | null;
  totalFees: number;
}

export interface AlgoTestTradeView {
  tradeId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** epoch ms - matches ChartCandle.time exactly. */
  entryTime: number;
  entryPrice: number;
  /** epoch ms. */
  exitTime: number;
  exitPrice: number;
  pnl: number;
  grossPnl: number;
  fees: number;
  rMultiple: number | null;
  /**
   * P3.3 - copied straight through from at24-quant-engine's SimulationTrade
   * when the position that produced this trade actually had one; absent
   * (never fabricated as e.g. 0) for a trade whose position had no
   * stop-loss/take-profit.
   */
  stopLoss?: number;
  takeProfit?: number;
  /**
   * P3.3 - a human-readable description of why the engine closed this
   * position, present only when the engine's own close call site genuinely
   * knew one (protective stop/take-profit resolution, a risk-engine
   * forced/partial exit, or an opposite-side order fill) - never a guessed
   * or default value when absent.
   */
  exitReason?: string;
}

export interface AlgoTestEquityPoint {
  /** epoch ms. */
  timestamp: number;
  balance: number;
}

/** Every field is the engine's own real, currently-in-effect assumption - see docs/P3.1-EXECUTION-PARITY.md. Never claims broker-realistic. */
export interface AlgoTestAssumptions {
  spread: string;
  slippage: string;
  fees: string;
  margin: string;
}

export type AlgoTestErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_STRATEGY"
  | "INVALID_STRATEGY_VERSION"
  | "INVALID_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_DATE_RANGE"
  | "RANGE_TOO_LARGE"
  | "INVALID_INITIAL_BALANCE"
  | "INVALID_PARAMETERS"
  | "NO_HISTORICAL_DATA"
  | "PROVIDER_ERROR"
  | "INSUFFICIENT_DATA"
  | "BACKTEST_FAILED"
  | "NOT_FOUND";

export interface AlgoTestRunView {
  testId: string;
  status: AlgoTestStatus;
  strategyId: AlgoTestStrategyId;
  /** P3.3 - the exact registered strategy version this run executed against; undefined only for a pure validation failure that never resolved a strategy, or a pre-P3.3 persisted row. */
  strategyVersion?: string;
  /** P3.3 - this result record's own field-shape version (services/algo-test/result-contract.ts); undefined for a run that never reached a completed engine result, or a pre-P3.3 row. */
  resultVersion?: string;
  /** P3.3 - at24-quant-engine's own SimulationResult.provenance.runtimeVersion, copied verbatim; undefined under the same conditions as resultVersion. */
  engineVersion?: string;
  /**
   * P3.4 - the exact, fully-normalized parameter configuration (every
   * declared parameter present, defaults filled in) this run actually
   * executed with - an immutable snapshot, never re-derived from the
   * CURRENT registry after the fact. `undefined` means one of two
   * genuinely different things, both honest: (a) this run's own strategy
   * has no declared parameters, or (b) this row predates P3.4 and no
   * snapshot was ever recorded - the UI must not assume (b) means "used
   * today's defaults," only that no snapshot exists (see
   * docs/P3.4-STRATEGY-PARAMETERS.md's backward-compatibility section).
   */
  parameters?: AlgoTestParameterValues;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  initialBalance: number;
  resultHash?: string;
  metrics?: AlgoTestMetricsView;
  trades?: AlgoTestTradeView[];
  equityCurve?: AlgoTestEquityPoint[];
  assumptions?: AlgoTestAssumptions;
  /**
   * The exact bars the engine ran against, for chart-overlay consistency
   * (docs/P3.1-QUANT-CHART-INTEGRATION-ARCHITECTURE.md SS6). Present on a
   * freshly-completed run's own POST response, AND (P3.3) reconstructed on
   * a GET .../[id] reopen of a completed run - by re-fetching bars for the
   * run's own persisted symbol/timeframe/date-range via the SAME read-only
   * historical provider, never a re-simulation. Still never persisted to
   * the database itself (AlgoTestRun model's own header comment: "do not
   * store unnecessarily huge raw datasets") - reconstructed fresh on every
   * reopen. Absent if that reconstruction fetch itself fails (best-effort:
   * a provider hiccup on reopen must not turn an already-successful,
   * fully-persisted result into an error).
   */
  candles?: ChartCandle[];
  /**
   * P3.8 - Validation / Evidence Gate (docs/P3.8-VALIDATION-EVIDENCE-GATE.md).
   * Present on a freshly-completed OR freshly-failed run's own POST
   * response (`runAlgoTest`) - naming exactly which of the 8 lifecycle
   * stages (IMPORTED/PARSED/IR_VALID/EXECUTION_VALID/DATA_VALID/
   * BACKTEST_VALID/REPRODUCIBLE/EVIDENCE_VERIFIED) this specific request
   * reached, and the real, specific reason for the first one that failed,
   * if any. Deliberately NOT reconstructed on GET .../[id] reopen or in
   * the run-list view this phase (REPRODUCIBLE would require re-running
   * the simulation a second time on every reopen, which this phase does
   * not do) - `undefined` there means "not (yet) recomputed on reopen,"
   * never "this run had no lifecycle."
   */
  lifecycle?: AlgoTestLifecycleResult;
  errorCode?: AlgoTestErrorCode;
  errorMessage?: string;
  createdAt: string;
  /**
   * P4 Phase 2 (docs/P4-PHASE2-BACKTEST-WIRING.md), narrowed to a real
   * wire-safe view AND generalized to every strategy source in P4.3 - the
   * exact StrategySpec this run actually executed (registry OR
   * AI-compiled - `toCompiledStrategyView()` is the ONE function that
   * builds this for both, never a second AI-only code path), rendered
   * human-readable. This is what lets a caller confirm a result
   * corresponds to what was actually going to run (e.g. an "EMA 9/21"
   * request really did compile and run different entry rules than an
   * "EMA 20/50" one), not just that SOME backtest completed. Absent only
   * when there is genuinely no StrategySpec to show - a pure validation
   * failure, or an AI compilation that never reached EXECUTION_VALID. Not
   * persisted - see `lifecycle`'s own doc comment above; the same
   * "undefined on reopen means not recomputed, not absent" rule applies.
   */
  compiledStrategy?: AlgoTestCompiledStrategyView;
  /** P4.3 - see AlgoTestStrategyHash's own doc comment. Present for both registry and AI-compiled runs that reached EXECUTION_VALID; not persisted. */
  strategyHash?: AlgoTestStrategyHash;
}

/** P4 Phase 2 - POST /api/private/algo-test/ai-runs. `startTime`/`endTime` are the backtest window (ISO 8601 UTC); the strategy's own symbol/timeframe come FROM the compiled StrategySpec (the natural-language intent itself names the market, e.g. "...for XAUUSD M15..."), never a second, separately-submitted field that could disagree with what was actually compiled. */
export interface AiCompileAndRunRequest {
  intent: string;
  startTime: string;
  endTime: string;
  initialBalance?: number;
}

/**
 * P4.3 - one declared parameter of the compiled StrategySpec
 * (at24-quant-engine's own StrategyParameterDefinition, narrowed to the
 * wire-safe fields a review UI needs). Genuinely often EMPTY for an
 * AI-compiled strategy - the AI compiler bakes concrete numbers directly
 * into entry/exit conditions and risk rather than declaring adjustable
 * named parameters (unlike Golden Strategy's own buildSpec(overrides)
 * pattern) - an empty array here is real, not an omission.
 */
export interface AlgoTestCompiledParameterView {
  key: string;
  defaultValue: number | boolean | string;
  min?: number;
  max?: number;
}

/**
 * P4.3 (docs/P4.3-SURFACE-THE-FOUNDATION.md) - a human-readable projection
 * of the real StrategySpec a run actually executed, built server-side
 * (algo-test.service.ts's own toCompiledStrategyView()) from
 * at24-quant-engine's real StrategySpec fields ONLY - every string here is
 * derived directly from a real entryRules/exitRules/risk field, never
 * invented. There is deliberately no separate "filters" field: the real
 * StrategySpec has no structurally distinct filter concept (a filter is
 * just another AND-ed clause inside the same entry condition) - inventing
 * one would violate P4.3's own "do not fabricate fields that are not
 * present in StrategySpec" rule, so filter-like conditions surface
 * naturally inside longEntry/shortEntry instead.
 */
export interface AlgoTestCompiledStrategyView {
  name: string;
  version: string;
  /**
   * Deliberately NO symbol/timeframe field here. A real, this-session
   * finding (caught by an actual UI screenshot, not by the offline
   * scripts): `StrategySpec.instruments`/`timeframes` are reliable as
   * "the real market this run traded" for an AI-compiled strategy, but
   * for an engine-reference registry strategy they can be the engine's
   * OWN internal fixture identity (e.g. Golden Strategy's real spec
   * declares `instruments: [{symbol:"SIMFIXTURE"}]`, `timeframes:["H1"]`
   * - at24-quant-engine/src/reference/golden-strategy.ts - unrelated to
   * what it actually ran against). `AlgoTestRunView.symbol`/`.timeframe`
   * are the one authoritative source for every strategy source (always
   * set from the real request), never re-derived from the spec here.
   */
  /** Human-readable description of every BUY entryRule's condition, joined; absent if the spec declares no BUY entry rule. */
  longEntry?: string;
  /** Human-readable description of every SELL entryRule's condition, joined; absent if the spec declares no SELL entry rule. */
  shortEntry?: string;
  /** Human-readable description of exitRules; explicitly states "no separate exit rule" (a real, common, correct StrategySpec shape - e.g. reversal-on-opposite-signal) rather than being silently absent. */
  exit: string;
  positionSizing: string;
  stopLoss?: string;
  takeProfit?: string;
  parameters: AlgoTestCompiledParameterView[];
}

/**
 * P4.3 - the semantic identity of the StrategySpec a run actually
 * executed (at24-quant-engine's own computeSemanticStrategyHash(), reused
 * verbatim - never a new hashing scheme). Present on a freshly-completed
 * OR freshly-failed-after-EXECUTION_VALID run's own POST response, for
 * BOTH registry and AI-compiled strategies - the same "one mechanism for
 * every strategy source" discipline P3.8/P4 Phase 2 already established
 * for `lifecycle`. Like `lifecycle` and `compiledStrategy`, this is NOT
 * persisted (see AlgoTestRunView.lifecycle's own doc comment for why) -
 * `undefined` on a reopened run means "not (yet) recomputed on reopen,"
 * never "this strategy has no identity."
 */
export type AlgoTestStrategyHash = string;
