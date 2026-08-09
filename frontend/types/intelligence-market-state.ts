// types/intelligence-market-state.ts
// Sprint D2.5.2 - Market State & Regime Engine (Intelligence Engine V2,
// phase 2). MarketState is a pure OBSERVATION layer: it never contains a
// BUY/SELL recommendation, trade instruction, LLM-generated content, a
// hypothesis, or a conclusion presented as fact. It is assembled entirely
// from real, already-proven data sources - see
// services/intelligence/market-state/market-state.service.ts - and never
// invents a field to fill out the shape. Every optional field is optional
// because the real value genuinely isn't available (insufficient candles,
// no provider data, or - for `quant` - because the computation doesn't
// exist yet in this codebase at all).
//
// Reuse, not reinvention: `technical` is built from the exact
// lib/market-data/indicators.ts functions already used by
// services/ai/technical-context.service.ts (RSI/EMA/ATR/MACD/Bollinger/
// volume). `dataQuality` reuses types/technical-context.ts#DataConfidence
// directly rather than defining a parallel shape.
//
// `quant` (Wave/FFT, Hurst, Fractal, Chaos) and `context` (macro/news/
// cross-asset) are deliberately NOT part of this contract yet. `quant`
// per the sprint's explicit instruction not to implement those research
// engines here. `context` because the D2.5.0 audit flagged news/macro/
// sentiment services as not yet re-verified as real (vs. mock-backed) -
// adding them to an "observation layer" contract before that verification
// would risk silently laundering unverified data as if it were as solid
// as the real indicator/evidence pipeline. Both are real, named future
// extension points - see docs/architecture/D2.5.2-market-state-regime-spec.md §9.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { MarketSnapshot } from "./market-snapshot";
import type { MACDResult, BollingerResult, VolumeMetrics } from "@/lib/market-data/indicators";
import type { DataConfidence } from "./technical-context";

export interface MarketStateTechnical {
  rsi14?: number;
  ema20?: number;
  ema50?: number;
  atr14?: number;
  macd?: MACDResult;
  bollinger?: BollingerResult;
  volume?: VolumeMetrics;
}

/**
 * Real, deterministic trend read from EMA20/EMA50 + price position - the
 * exact worked example the sprint brief itself gives ("EMA20 > EMA50,
 * price above EMA20"). `direction` is undefined (not "sideways") when
 * either EMA is uncomputable - "sideways" is a real classification for
 * available-but-flat data, not a stand-in for missing data.
 */
export interface MarketStateTrend {
  direction?: "up" | "down" | "sideways";
  priceAboveEma20?: boolean;
  ema20AboveEma50?: boolean;
  basis: string[];
}

/** The highest high / lowest low over the preceding `lookbackBars` candles, excluding the latest candle - the basis for breakout/breakdown detection. */
export interface MarketStateRecentRange {
  high: number;
  low: number;
  lookbackBars: number;
}

/**
 * Volatility band, computed identically to services/ai/technical-context
 * .service.ts's existing RiskContext.volatility (ATR14 as a percent of
 * price; <0.5% low, <1.5% medium, else high) - reused, not reinvented, so
 * the same market state is never described as two different volatility
 * levels by two different parts of the platform.
 */
export type MarketStateVolatilityBand = "low" | "medium" | "high";

export interface MarketStateStructure {
  trend?: MarketStateTrend;
  recentRange?: MarketStateRecentRange;
  /** Latest close relative to recentRange - the real, minimal "basic breakout/breakdown detection" the sprint asks for. Undefined when neither condition is met (price is within the recent range). */
  breakoutSignal?: "breakout" | "breakdown";
  volatilityBand?: MarketStateVolatilityBand;
  atrPercent?: number;

  /**
   * NOT IMPLEMENTED in D2.5.2. No genuine order-book/liquidity data source
   * exists anywhere in this platform's providers (confirmed by the D2.5.0
   * audit and RiskEngineService's own long-standing design note that
   * liquidity/execution risk is always unmeasured "by design"). Declared
   * here, always undefined, so a future sprint with a real data-backed
   * proxy can populate it without a breaking type change - never
   * fabricated in the meantime.
   */
  liquidityZones?: unknown[];
  /**
   * NOT IMPLEMENTED in D2.5.2. Real buy/sell volume delta requires
   * tick-level or order-flow data this platform's providers do not supply
   * (MarketSnapshot/Candle only ever carry one undifferentiated `volume`
   * figure, when present at all). Always undefined this sprint.
   */
  volumeDelta?: { buyVolume: number; sellVolume: number; netDelta: number };
  /**
   * NOT IMPLEMENTED in D2.5.2. A real, deterministic BOS/CHOCH detector
   * needs a swing-point (fractal high/low) algorithm with its own
   * carefully-justified parameters (lookback width, minimum bar spacing) -
   * genuinely feasible in a future sprint, but doing it justice was judged
   * too large to fold into this one without rushing it. Always undefined.
   */
  bos?: boolean;
  /** NOT IMPLEMENTED in D2.5.2 - see `bos`. Always undefined. */
  choch?: boolean;
}

export interface MarketState {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  snapshot: MarketSnapshot;
  technical?: MarketStateTechnical;
  structure?: MarketStateStructure;
  dataQuality: DataConfidence;
  generatedAt: string;
  /** e.g. "2.0.0" - the Intelligence Engine V2 component version, NOT MARKET_INTELLIGENCE_PIPELINE_VERSION (which stays "15D.12.0" and is unrelated - see docs/architecture/D2.5.2-market-state-regime-spec.md §10). */
  pipelineVersion: string;
}
