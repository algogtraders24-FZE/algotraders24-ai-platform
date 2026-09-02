// types/algo-test.ts
// P3.2B - the Pro Algo Test wire contract, per docs/P3.1-QUANT-CHART-CONTRACT.md
// and docs/P3.2A-RESULT-CONTRACT.md. This sprint's actual supported request
// space is deliberately narrow (Golden Strategy / XAUUSD / M5 only - see
// algo-test.service.ts's SUPPORTED_* constants) but the shapes below are the
// general contract those docs already specified, not re-invented here.
import type { ChartCandle } from "./chart-data";

/** Only "golden" is runnable this sprint - see algo-test.service.ts. Kept as a string, not a literal union, so a future strategy can be added without a type-level break. */
export type AlgoTestStrategyId = string;

export type AlgoTestStatus = "completed" | "failed";

export interface AlgoTestRunRequest {
  strategyId: AlgoTestStrategyId;
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
  | "INVALID_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_DATE_RANGE"
  | "RANGE_TOO_LARGE"
  | "NO_HISTORICAL_DATA"
  | "PROVIDER_ERROR"
  | "INSUFFICIENT_DATA"
  | "BACKTEST_FAILED"
  | "NOT_FOUND";

export interface AlgoTestRunView {
  testId: string;
  status: AlgoTestStatus;
  strategyId: AlgoTestStrategyId;
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
   * (docs/P3.1-QUANT-CHART-INTEGRATION-ARCHITECTURE.md SS6). Present only on
   * a freshly-completed run's own response - never persisted to the
   * database (AlgoTestRun model's own header comment: "do not store
   * unnecessarily huge raw datasets") and never returned by GET .../[id].
   */
  candles?: ChartCandle[];
  errorCode?: AlgoTestErrorCode;
  errorMessage?: string;
  createdAt: string;
}
