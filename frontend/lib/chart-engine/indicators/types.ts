// lib/chart-engine/indicators/types.ts
// Sprint D2.7.3, Phase 6/7 - the "Indicator Data" layer sitting between the
// Calculation Layer (lib/market-data/indicators.ts's *Series functions) and
// the Chart Coordinate System/Renderer. An IndicatorSeries is pure data -
// it carries no Canvas/coordinate knowledge, and the renderer that
// consumes it carries no knowledge of how the values were calculated. This
// separation is mandatory per the sprint brief:
//   Calculation Layer -> Indicator Data -> Chart Coordinate System -> Renderer

export type IndicatorId = "sma" | "ema" | "rsi" | "macd" | "bollinger" | "volume" | "atr" | "stochastic" | "adx" | "cci" | "williams-r" | "parabolic-sar";

/** The sub-panel an indicator's line(s) render into - Phase 8's reusable panel model. "price" means "drawn as an overlay on the main candlestick panel", not a separate panel. */
export type ChartPanelId = "price" | "volume" | "rsi" | "macd" | "atr" | "stochastic" | "adx" | "cci" | "williams-r";

export interface IndicatorConfig {
  id: IndicatorId;
  /** Deterministic, derived from id+period (e.g. "ema-20") - distinguishes two instances of the same indicator (EMA20 vs EMA50) on one chart. Never free-text. */
  key: string;
  /** Parabolic SAR (this session) reuses this field for its own primary numeric parameter - the Acceleration Factor "step" (MT5's real default 0.02) - rather than adding a whole second required field for a value that plays the same "this indicator's one core tunable number" role every other indicator's `period` already plays. */
  period: number;
  /** Bollinger only. */
  stdDevMultiplier?: number;
  /** MACD only. */
  fastPeriod?: number;
  slowPeriod?: number;
  /** MACD's signal-line period, or (Phase 2) Stochastic's %D period - both are "the smoothing period for this indicator's second/signal line", the same real concept reused rather than a second near-identical field. */
  signalPeriod?: number;
  /** Stochastic only - MT5's real default "Slowing" period (5,3,3 - see indicators.ts's stochasticSeries() header comment for why this is the genuine MT5 default, not the textbook fast-stochastic every other platform ships). */
  slowingPeriod?: number;
  /** Parabolic SAR only - MT5's real default Acceleration Factor ceiling (0.2 - see indicators.ts's parabolicSarSeries() header comment). */
  maxStep?: number;
  /** One of AT24's existing design tokens (see palette.ts) - never a new arbitrary color invented per indicator. */
  color: string;
}

export interface IndicatorPoint {
  time: number;
  /** undefined at any index where the indicator genuinely wasn't yet computable - never fabricated/interpolated. */
  value: number | undefined;
}

/** MACD/Bollinger need more than one drawn line (signal+histogram, upper/lower/middle) - each gets its own point array and color so the renderer can draw each without knowing indicator-specific semantics. */
export interface IndicatorLine {
  name: string;
  points: IndicatorPoint[];
  color: string;
  /** Bollinger's upper/lower bands render as a filled channel, not a bare line - the renderer branches on this, never on `config.id`. Parabolic SAR (this session) renders as discrete dots, never a connected line - matching MT5's own real Parabolic SAR visual convention (a stop-and-reverse LEVEL at each candle, not a continuous trend line). */
  style?: "line" | "band-edge" | "dots";
}

export interface IndicatorSeries {
  config: IndicatorConfig;
  panel: ChartPanelId;
  lines: IndicatorLine[];
}
