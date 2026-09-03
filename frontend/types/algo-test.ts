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
  errorCode?: AlgoTestErrorCode;
  errorMessage?: string;
  createdAt: string;
}
