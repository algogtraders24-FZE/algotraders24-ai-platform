/**
 * Quant Lite type contracts - mirror the Q0.7 frozen product contracts
 * (quant-engine/reports/Q0.7_PRODUCT_PIPELINE.md Parts 4/5/6/13/15)
 * exactly. Nothing here should express more than the canonical
 * execution_mtf.py engine actually supports - see
 * quant-engine/reports/Q0.7_PRODUCT_PIPELINE.md Part 3/4 for the audited
 * ceiling (10 indicators, AND-only conditions, SL/TP-only exits).
 */
import type { CoverageAssessment } from "@/types/quant-lite-coverage";

// --- Strategy specification (Part 4) ------------------------------------

export const SUPPORTED_INDICATOR_TYPES = [
  "EMA",
  "SMA",
  "RSI",
  "ATR",
  "MACD",
  "BB",
  "STOCH",
  "ADX",
  "DONCHIAN",
  "SUPERTREND",
] as const;
export type IndicatorType = (typeof SUPPORTED_INDICATOR_TYPES)[number];

export const SUPPORTED_CONDITION_OPS = [
  ">",
  "<",
  ">=",
  "<=",
  "==",
  "cross_above",
  "cross_below",
] as const;
export type ConditionOp = (typeof SUPPORTED_CONDITION_OPS)[number];

export interface IndicatorSpec {
  id: string;
  type: IndicatorType;
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  mult?: number;
  k_period?: number;
  d_period?: number;
}

export interface ConditionSpec {
  left: string | number;
  op: ConditionOp;
  right: string | number;
}

export type SLTPMode = "ATR" | "PIPS";

export interface RiskSpec {
  sl_mode: SLTPMode;
  sl_atr_mult?: number;
  sl_points?: number;
  tp_mode: SLTPMode;
  tp_atr_mult?: number;
  tp_points?: number;
  atr_id?: string;
  /**
   * Legacy engine specs (e.g. the strategy library) carry these
   * breakeven/trailing/partial-close threshold fields too - present in
   * the real spec data, but irrelevant for Quant Lite: the *booleans*
   * that gate whether they ever fire come only from RiskConfig
   * (quant_lite_risk_config() forces them off), never from the spec
   * itself. Kept here so real legacy spec JSON types cleanly, not
   * because Quant Lite exposes or uses them.
   */
  be_trigger_atr?: number;
  be_lock_atr?: number;
  trail_start_atr?: number;
  trail_atr_mult?: number;
  partial_atr?: number;
  partial_pct?: number;
}

export interface StrategySpec {
  name: string;
  symbol: string;
  timeframe: string;
  indicators: IndicatorSpec[];
  entry_long: ConditionSpec[];
  entry_short: ConditionSpec[];
  risk: RiskSpec;
  /** Present on template_builder-generated legacy specs (e.g. the library); not set by the Quant Lite builder. */
  built_from?: unknown;
}

// --- Client-side validation result (Part 7) ------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// --- Backtest input contract (Part 5) ------------------------------------

export interface BacktestRequest {
  strategy: StrategySpec;
  symbol: string;
  timeframe: string;
  dateRange: { start: string; end: string };
  initialCapital: number;
  riskPct: number;
}

// --- Result contract (Part 6) --------------------------------------------

/**
 * Fields marked `| null` are NOT currently computed anywhere by the
 * legacy engine (confirmed in Q0.7 Part 6) - the UI must render "Not
 * available" for these, never fabricate or estimate a value.
 */
export interface BacktestMetrics {
  tradesTotal: number;
  winRatePct: number | null;
  profitFactor: number | null;
  totalReturnPct: number;
  maxDrawdownPct: number;
  finalBalance: number;
  accountBlown: boolean;
  winningTrades: number | null;
  losingTrades: number | null;
  averageTrade: number | null;
  largestWin: number | null;
  largestLoss: number | null;
}

export type ExitReason = "SL" | "TP" | "PARTIAL";

export interface Trade {
  tradeNumber: number;
  direction: "BUY" | "SELL";
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  exitReason: ExitReason;
  pnl: number;
  balanceAfter: number;
  /** Not currently stored per-trade by the engine (Q0.7 Part 6 gap) - null until it is. */
  slPrice?: number | null;
  tpPrice?: number | null;
}

export interface ExecutionAssumptions {
  executionModel: string;
  spread: string;
  slippage: string;
  commission: string;
  breakeven: "OFF";
  trailing: "OFF";
  partialClose: "OFF";
  dataSource: string;
}

export interface ResultProvenance {
  symbol: string;
  timeframe: string;
  dateRange: { start: string; end: string };
  initialCapital: number;
  engineVersion: string;
  generatedAt: string;
  /** Q1.1.21 - the full server-authoritative data-quality assessment for this specific request. Never absent for a real (non-legacy) result. */
  dataQuality?: CoverageAssessment;
}

export type BacktestStatus = "pending" | "running" | "completed" | "failed";

/** Q1.1.10 - a RESTRICTED-coverage result is still real and still runs, but must never be presented as equivalent to a normal, continuous-data backtest. */
export type ResultDataQualityStatus = "NORMAL" | "DATA_QUALITY_RESTRICTED";

export interface BacktestResult {
  backtestId: string;
  status: BacktestStatus;
  strategyName: string;
  metrics: BacktestMetrics;
  trades: Trade[];
  assumptions: ExecutionAssumptions;
  warnings: string[];
  provenance: ResultProvenance;
  error?: QuantLiteError;
  /** Q1.1.10 - defaults to NORMAL when absent (pre-Q1.1 results, e.g. the static library sample). */
  resultDataQualityStatus?: ResultDataQualityStatus;
}

// --- Error / validation states (Q0.7 Part 14) -----------------------------

export type QuantLiteErrorCode =
  | "INVALID_STRATEGY"
  | "INVALID_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_DATE_RANGE"
  | "INSUFFICIENT_DATA"
  | "INDICATOR_DATA_MISSING"
  | "BACKTEST_FAILED"
  | "UNSUPPORTED_FEATURE"
  | "DATA_QUALITY_WARNING";

export interface QuantLiteError {
  code: QuantLiteErrorCode;
  userMessage: string;
  recoveryAction: string;
}

// --- Strategy library (Part 10 / Part 14) ---------------------------------

export interface LibraryEntry {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  triggerKey: string;
  filterKey: string;
  riskPreset: string;
  tradesTotal: number;
  winRatePct: number;
  profitFactor: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  finalBalance: number;
  wfPctProfitable: number | null;
  wfRobustnessScore: number | null;
  spec: StrategySpec;
}

// --- Supported markets/timeframes (Q0.7 Part 5 - must match market.db) ---

export const SUPPORTED_SYMBOLS = [
  "XAUUSD_EXNESS",
  "XAUUSD_ZS_EXNESS",
  "EURUSD_EXNESS",
  "GBPUSD_EXNESS",
  "USOIL_EXNESS",
  "BTCUSD_EXNESS",
  "XAUUSD",
  "EURUSD",
] as const;
export type SupportedSymbol = (typeof SUPPORTED_SYMBOLS)[number];

export const SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];
