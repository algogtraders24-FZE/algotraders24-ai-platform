import type { Position } from "./position.js";
import type { BacktestConfig } from "./backtest-config.js";
import type { ReproducibilityMetadata } from "./reproducibility.js";

export interface Trade {
  readonly position: Position;
  readonly pnl: number;
  readonly rMultiple?: number;
}

export interface EquityCurvePoint {
  readonly timestamp: number;
  readonly equity: number;
}

export interface BacktestMetrics {
  readonly totalTrades: number;
  readonly winRate: number;
  readonly netProfit: number;
  readonly maxDrawdown: number;
  readonly profitFactor?: number;
  readonly sharpeRatio?: number;
}

export interface ExecutionStatistics {
  readonly ordersSubmitted: number;
  readonly ordersFilled: number;
  readonly ordersRejected: number;
}

/**
 * BacktestResult != Evidence (ADR-005). This is a raw, deterministic
 * research output. Turning it into M-Series Evidence is a future adapter's
 * job (Q0.7 / Q0.11) — it is not built here and BacktestResult must never
 * gain fields named evidenceHash/validationHash/trustState etc. that would
 * blur that boundary.
 */
export interface BacktestResult {
  readonly trades: readonly Trade[];
  readonly equityCurve: readonly EquityCurvePoint[];
  readonly metrics: BacktestMetrics;
  readonly executionStatistics: ExecutionStatistics;
  readonly config: BacktestConfig;
  readonly reproducibility: ReproducibilityMetadata;
}
