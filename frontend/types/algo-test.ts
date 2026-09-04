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
   * if any.
   *
   * P4.5 (docs/P4.5-STRATEGY-RUN-IDENTITY-PERSISTENCE.md) - now genuinely
   * PERSISTED, closing the gap this comment used to describe (REPRODUCIBLE
   * is still never re-verified by re-running the simulation on reopen -
   * the persisted value is the ORIGINAL run's own lifecycle result,
   * written once and read back verbatim, never re-derived from strategyId
   * after the fact so a later registry change can't alter a past run's
   * recorded lifecycle). `undefined` on a reopened run now means exactly
   * one honest thing: this row predates P4.5 and was never backfilled
   * with a guess - never "this run had no lifecycle."
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
   * failure, or an AI compilation that never reached EXECUTION_VALID.
   *
   * P4.5 - now genuinely persisted; see `lifecycle`'s own doc comment
   * above for the same "undefined on reopen means pre-P4.5, not absent"
   * rule.
   */
  compiledStrategy?: AlgoTestCompiledStrategyView;
  /** P4.3 - see AlgoTestStrategyHash's own doc comment. Present for both registry and AI-compiled runs that reached EXECUTION_VALID. P4.5 - now genuinely persisted and indexed (AlgoTestRun_userId_strategyHash_idx); see `lifecycle`'s own doc comment for the reopen convention. */
  strategyHash?: AlgoTestStrategyHash;
  /**
   * P4.4 - present whenever `status === "completed"` and `trades`/
   * `equityCurve`/`metrics` are present, for EVERY strategy source (no
   * strategy-specific branch) - on a fresh run AND on a reopened one too,
   * because every input this needs (trades/equityCurve/metrics/
   * initialBalance) is already a persisted column on the AlgoTestRun row -
   * `analytics` itself is never persisted, only recomputed on demand from
   * data that already is. (Before P4.5 this was the one field that
   * survived reopen while lifecycle/compiledStrategy/strategyHash did
   * not; P4.5 closed that gap for the other three by persisting them
   * directly instead of recomputing them - a different mechanism, the
   * same reopen guarantee.)
   */
  analytics?: AlgoTestAnalyticsView;
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
 * for `lifecycle`.
 *
 * P4.5 - now persisted verbatim (AlgoTestRun.strategyHash) and indexed
 * per-user (AlgoTestRun_userId_strategyHash_idx), so a future run-history/
 * library/optimization feature can group or compare a user's own runs by
 * exact strategy identity. Deliberately still the SAME hash function and
 * SAME semantic meaning - P4.5 added persistence, not a new identity
 * concept. `undefined` on a reopened run means the row predates P4.5,
 * never "this strategy has no identity."
 */
export type AlgoTestStrategyHash = string;

// =========================================================================
// P4.4 (docs/P4.4-ADVANCED-ANALYTICS-FOUNDATION.md) - Advanced Analytics
// Foundation. Every field below is a PURE PROJECTION of already-persisted
// data (trades/equityCurve/metrics/initialBalance) - unlike lifecycle/
// compiledStrategy/strategyHash (P4.3), `analytics` IS reconstructable on
// a reopened run, because its inputs are already stored on the row. See
// services/algo-test/algo-test-analytics.ts for the projection functions
// and at24-quant-engine's computeRiskRatios() for the 5 risk ratios.
// =========================================================================

/** One equal-width bucket of the P&L distribution histogram. `rangeEnd` is exclusive except on the last bucket (inclusive), matching a standard half-open-interval histogram convention. */
export interface AlgoTestPnlBucket {
  rangeStart: number;
  rangeEnd: number;
  count: number;
}

/** P4.4 Tier 1 - winning vs. losing trades, real counts/sums/averages/medians, plus a deterministic histogram. `null` (never a fabricated 0) whenever the underlying group is empty. */
export interface AlgoTestPnlDistributionView {
  winCount: number;
  lossCount: number;
  winSum: number;
  lossSum: number;
  winAverage: number | null;
  lossAverage: number | null;
  winMedian: number | null;
  lossMedian: number | null;
  /** Equal-width buckets spanning [min(pnl), max(pnl)] across ALL trades (winners and losers together) - up to 10 buckets, fewer only when there are fewer than 10 trades. A single trade (or every trade sharing the exact same P&L) produces exactly one bucket covering that value - never a divide-by-zero-width bucket. Empty when there are no trades. */
  buckets: AlgoTestPnlBucket[];
}

/** P4.4 Tier 1 - one side's (BUY or SELL) own aggregate. `averagePnl` is `null`, never 0, when `tradeCount` is 0. */
export interface AlgoTestSideBreakdownEntry {
  side: "BUY" | "SELL";
  tradeCount: number;
  /** 0-100; 0 when tradeCount is 0 (matches CoreMetricName's own winRate convention - a real, defined "no trades yet" 0, not a divide-by-zero). */
  winRate: number;
  netPnl: number;
  averagePnl: number | null;
}

export interface AlgoTestSideBreakdownView {
  buy: AlgoTestSideBreakdownEntry;
  sell: AlgoTestSideBreakdownEntry;
}

/** P4.4 Tier 1 - one scatter-ready point: how long a trade was open vs. what it made/lost. Derived, not persisted anywhere else - AlgoTestTradeView itself carries only entryTime/exitTime. */
export interface AlgoTestDurationPnlPoint {
  tradeId: string;
  durationMs: number;
  pnl: number;
  side: "BUY" | "SELL";
}

/** P4.4 Tier 1 - one real calendar day that had at least one trade close on it (UTC date bucket, deterministic regardless of viewer timezone). A day with NO entry in `calendar` had zero trades - never fabricated as an explicit zero-value entry (see algo-test-analytics.ts's own doc comment on why); a calendar-grid UI renders an absent date as its own "zero-trade day" state. */
export interface AlgoTestCalendarDayEntry {
  /** YYYY-MM-DD, UTC. */
  date: string;
  tradeCount: number;
  netPnl: number;
  outcome: "winning" | "losing" | "breakeven";
}

/**
 * P4.4 Tier 2 - at24-quant-engine's own computeRiskRatios(), copied
 * through verbatim. Every field is `number | null` - `null` means
 * genuinely undefined (insufficient trades, zero variance, zero
 * drawdown, no losing trades for Sortino's downside deviation), NEVER a
 * misleading fabricated 0. See metrics.ts's own formula documentation
 * for the exact, explicit definition of each ratio - all are PER-TRADE
 * (not annualized: trades are not evenly time-spaced, so no
 * trades-per-year factor is invented) and assume a 0 risk-free rate (a
 * disclosed assumption, matching this program's ZeroSpread/ZeroSlippage/
 * ZeroFee convention elsewhere).
 */
export interface AlgoTestRiskRatiosView {
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  recoveryFactor: number | null;
  ulcerIndex: number | null;
}

export interface AlgoTestAnalyticsView {
  pnlDistribution: AlgoTestPnlDistributionView;
  sideBreakdown: AlgoTestSideBreakdownView;
  durationVsPnl: AlgoTestDurationPnlPoint[];
  calendar: AlgoTestCalendarDayEntry[];
  riskRatios: AlgoTestRiskRatiosView;
}
