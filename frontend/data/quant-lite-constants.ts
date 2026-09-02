/**
 * Quant Lite constants - the audited ceiling of what the legacy engine
 * actually supports (quant-engine/reports/Q0.7_PRODUCT_PIPELINE.md Part 3).
 * Do not add entries here that the engine doesn't implement.
 */
import type { ConditionOp, IndicatorType, SupportedSymbol, SupportedTimeframe } from "@/types/quant-lite";

export interface IndicatorMeta {
  type: IndicatorType;
  label: string;
  params: Array<{ key: string; label: string; default: number }>;
  /** Field refs this indicator exposes for conditions, e.g. "macd1.line" */
  outputs: Array<{ suffix: string; label: string }>;
  note: string;
}

export const INDICATOR_META: Record<IndicatorType, IndicatorMeta> = {
  EMA: {
    type: "EMA",
    label: "EMA (Exponential Moving Average)",
    params: [{ key: "period", label: "Period", default: 20 }],
    outputs: [{ suffix: "", label: "Value" }],
    note: "Single value - compare directly to price or another indicator.",
  },
  SMA: {
    type: "SMA",
    label: "SMA (Simple Moving Average)",
    params: [{ key: "period", label: "Period", default: 20 }],
    outputs: [{ suffix: "", label: "Value" }],
    note: "Single value - compare directly to price or another indicator.",
  },
  RSI: {
    type: "RSI",
    label: "RSI (Relative Strength Index)",
    params: [{ key: "period", label: "Period", default: 14 }],
    outputs: [{ suffix: "", label: "Value" }],
    note: "0-100 range, Wilder-smoothed (standard definition).",
  },
  ATR: {
    type: "ATR",
    label: "ATR (Average True Range)",
    params: [{ key: "period", label: "Period", default: 14 }],
    outputs: [{ suffix: "", label: "Value" }],
    note: "Typically used for stop-loss/take-profit sizing, not a direct entry condition.",
  },
  MACD: {
    type: "MACD",
    label: "MACD",
    params: [
      { key: "fast", label: "Fast period", default: 12 },
      { key: "slow", label: "Slow period", default: 26 },
      { key: "signal", label: "Signal period", default: 9 },
    ],
    outputs: [
      { suffix: ".line", label: "MACD Line" },
      { suffix: ".signal", label: "Signal Line" },
      { suffix: ".hist", label: "Histogram" },
    ],
    note: "Compare the line to the signal, or use cross_above/cross_below.",
  },
  BB: {
    type: "BB",
    label: "Bollinger Bands",
    params: [
      { key: "period", label: "Period", default: 20 },
      { key: "mult", label: "Std Dev Multiplier", default: 2.0 },
    ],
    outputs: [
      { suffix: ".upper", label: "Upper Band" },
      { suffix: ".middle", label: "Middle Band" },
      { suffix: ".lower", label: "Lower Band" },
    ],
    note: "Compare price to any of the three bands.",
  },
  STOCH: {
    type: "STOCH",
    label: "Stochastic Oscillator",
    params: [
      { key: "k_period", label: "%K Period", default: 14 },
      { key: "d_period", label: "%D Period", default: 3 },
    ],
    outputs: [
      { suffix: ".k", label: "%K" },
      { suffix: ".d", label: "%D" },
    ],
    note: "0-100 range.",
  },
  ADX: {
    type: "ADX",
    label: "ADX (Average Directional Index)",
    params: [{ key: "period", label: "Period", default: 14 }],
    outputs: [
      { suffix: ".adx", label: "ADX" },
      { suffix: ".plus_di", label: "+DI" },
      { suffix: ".minus_di", label: "-DI" },
    ],
    note: "Measures trend strength, not direction - typically used as a filter.",
  },
  DONCHIAN: {
    type: "DONCHIAN",
    label: "Donchian Channel",
    params: [{ key: "period", label: "Period", default: 20 }],
    outputs: [
      { suffix: ".upper", label: "Upper Channel" },
      { suffix: ".middle", label: "Middle" },
      { suffix: ".lower", label: "Lower Channel" },
    ],
    note: "Excludes the current bar by design (standard Turtle-style definition).",
  },
  SUPERTREND: {
    type: "SUPERTREND",
    label: "Supertrend",
    params: [
      { key: "period", label: "Period", default: 10 },
      { key: "mult", label: "ATR Multiplier", default: 3.0 },
    ],
    outputs: [
      { suffix: ".line", label: "Line" },
      { suffix: ".trend", label: "Trend (+1/-1)" },
    ],
    note: "Use .trend with cross_above/cross_below 0 to detect a flip.",
  },
};

export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  ">": "is greater than",
  "<": "is less than",
  ">=": "is greater than or equal to",
  "<=": "is less than or equal to",
  "==": "equals",
  cross_above: "crosses above",
  cross_below: "crosses below",
};

export interface SymbolMeta {
  symbol: SupportedSymbol;
  label: string;
  dataSource: string;
  coverage: string;
}

/** Coverage/provenance per Q0.5/Q0.6's own audit of market.db - real dates, not placeholders. */
export const SYMBOL_META: SymbolMeta[] = [
  { symbol: "XAUUSD_EXNESS", label: "Gold (XAUUSD) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-05-31" },
  { symbol: "XAUUSD_ZS_EXNESS", label: "Gold Zero-Spread (XAUUSD) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-08-02" },
  { symbol: "EURUSD_EXNESS", label: "Euro/US Dollar (EURUSD) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-08-21" },
  { symbol: "GBPUSD_EXNESS", label: "British Pound/US Dollar (GBPUSD) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-08-21" },
  { symbol: "USOIL_EXNESS", label: "US Crude Oil (USOIL) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-08-21" },
  { symbol: "BTCUSD_EXNESS", label: "Bitcoin (BTCUSD) - Exness", dataSource: "Real Exness tick data", coverage: "2024-01-01 to 2026-08-22" },
  { symbol: "XAUUSD", label: "Gold (XAUUSD) - Legacy source", dataSource: "Older historical data source", coverage: "2020-08-21 to 2025-08-01" },
  { symbol: "EURUSD", label: "Euro/US Dollar (EURUSD) - Legacy source", dataSource: "Older historical data source", coverage: "2012-11-14 to 2022-03-04" },
];

export const TIMEFRAME_LABELS: Record<SupportedTimeframe, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
};

export const RISK_PRESETS = [
  { key: "conservative", label: "Conservative", riskPct: 0.5 },
  { key: "standard", label: "Standard", riskPct: 1.0 },
  { key: "aggressive", label: "Aggressive", riskPct: 2.0 },
] as const;
