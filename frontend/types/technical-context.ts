// types/technical-context.ts
// Sprint D2.2 (Phase 7) - the structured, real technical + risk context that
// feeds the AI Context Builder. Every value is COMPUTED from actual OHLC
// candles by lib/market-data/indicators.ts; an indicator with insufficient
// candles is `undefined` (rendered as "Insufficient data"), never estimated.
import type { MACDResult, BollingerResult, VolumeMetrics, KeyPriceLevels } from "@/lib/market-data/indicators";
import type { MarketStatus } from "@/types/market-snapshot";

export interface TechnicalIndicators {
  rsi14?: number;
  ema20?: number;
  ema50?: number;
  sma20?: number;
  atr14?: number;
  macd?: MACDResult;
  bollinger?: BollingerResult;
  volume?: VolumeMetrics;
}

export interface TechnicalContext {
  symbol: string;
  interval: string;
  candleCount: number;
  /** True when there are enough candles for the core set (RSI/SMA20/ATR/Bollinger). EMA50/MACD need more and may still be undefined. */
  hasSufficientData: boolean;
  indicators: TechnicalIndicators;
  /** Real recent Resistance/Support/Pullback levels (Sprint D2.7.11 post-completion) - see lib/market-data/indicators.ts's keyPriceLevels() header comment. {} when there aren't enough candles for a real range yet. */
  keyLevels: KeyPriceLevels;
  /** Human-readable, evidence-backed notes derived only from the computed indicators. */
  observations: string[];
  computedAt: string;
}

export type VolatilityBand = "low" | "medium" | "high";

export interface RiskContext {
  /** Derived from ATR as a percent of price; undefined when ATR could not be computed. */
  volatility?: VolatilityBand;
  atrPercent?: number;
  marketStatus: MarketStatus;
  notes: string[];
}

export type ConfidenceBand = "insufficient" | "low" | "medium" | "high";

export interface DataConfidence {
  band: ConfidenceBand;
  /** How many of the tracked indicators were computable from the available candles. */
  computed: number;
  total: number;
  note: string;
}
