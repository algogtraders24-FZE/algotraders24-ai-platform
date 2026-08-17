// services/intelligence/market-state/market-state.service.ts
// Sprint D2.5.2 - Market State & Regime Engine. Pure, deterministic
// assembler: given a real MarketSnapshot and a real, oldest-first Candle[]
// (already fetched by the caller - this service performs no network I/O,
// exactly like RegimeService below it, so both are trivially reproducible
// and testable without mocking a provider), produces a MarketState.
//
// Every derived field either carries a real, traceable basis or is left
// undefined - never a guessed placeholder. Constants below are the sprint's
// documented, versioned thresholds; see
// docs/architecture/D2.5.2-market-state-regime-spec.md for the full
// justification of each one.
import {
  closes,
  rsi,
  ema,
  atr,
  macd,
  bollinger,
  volumeMetrics,
} from "@/lib/market-data/indicators";
import { validateCandles } from "@/lib/market-data/candle-validation";
import type { Candle } from "@/types/market-candle";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { DataConfidence, ConfidenceBand } from "@/types/technical-context";
import type {
  MarketState,
  MarketStateTechnical,
  MarketStateStructure,
  MarketStateTrend,
  MarketStateRecentRange,
  MarketStateVolatilityBand,
} from "@/types/intelligence-market-state";

export const INTELLIGENCE_ENGINE_VERSION = "2.0.0";

// RSI/ATR/Bollinger periods match the platform-wide defaults already used
// by lib/market-data/indicators.ts's own default parameters and
// services/ai/technical-context.service.ts - reused, not reinvented.
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const BOLLINGER_PERIOD = 20;
// EMA20/EMA50 are the exact pair the sprint brief's own worked example
// uses ("EMA20 > EMA50, price above EMA20").
// Sprint D2.8.15 - exported (zero behavior change) so lib/market-data/
// indicator-requirements.ts's candle-sufficiency model reads these exact
// numbers back rather than duplicating them as a second, potentially-
// drifting pair of literals.
export const EMA_FAST_PERIOD = 20;
export const EMA_SLOW_PERIOD = 50;
// Number of PRECEDING candles (excluding the latest) whose high/low define
// "the recent range" for breakout/breakdown detection. 20 bars is a
// conventional, easily-justified swing window - documented, not tuned.
const BREAKOUT_LOOKBACK_BARS = 20;
// ATR-as-percent-of-price volatility bands - copied verbatim from
// services/ai/technical-context.service.ts's existing, already-shipped
// RiskContext.volatility logic, so the same market state is never
// described as two different volatility levels by two different parts of
// the platform.
const VOLATILITY_LOW_MAX_PCT = 0.5;
const VOLATILITY_HIGH_MIN_PCT = 1.5;

export interface AssembleMarketStateInput {
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  snapshot: MarketSnapshot;
  /** Oldest-first, real candles from a TimeSeriesProvider. Never fabricated by this service. */
  candles: Candle[];
  /** Sprint D2.8.15 - "now" for candle-validation's future-timestamp check. Defaults to Date.now(); overridable only for deterministic tests. */
  nowMs?: number;
}

function computeTechnical(candleCloses: number[], candles: readonly Candle[]): MarketStateTechnical {
  return {
    rsi14: rsi(candleCloses, RSI_PERIOD),
    ema20: ema(candleCloses, EMA_FAST_PERIOD),
    ema50: ema(candleCloses, EMA_SLOW_PERIOD),
    atr14: atr(candles, ATR_PERIOD),
    macd: macd(candleCloses),
    bollinger: bollinger(candleCloses, BOLLINGER_PERIOD),
    volume: volumeMetrics(candles),
  };
}

function computeTrend(technical: MarketStateTechnical, latestPrice: number): MarketStateTrend {
  const { ema20, ema50 } = technical;
  if (ema20 === undefined || ema50 === undefined) {
    return { basis: ["EMA20 and/or EMA50 could not be computed (insufficient candles) - trend direction is unavailable."] };
  }

  const priceAboveEma20 = latestPrice > ema20;
  const ema20AboveEma50 = ema20 > ema50;
  const basis = [
    `EMA20 (${ema20.toFixed(5)}) is ${ema20AboveEma50 ? "above" : "below"} EMA50 (${ema50.toFixed(5)}).`,
    `Latest price (${latestPrice.toFixed(5)}) is ${priceAboveEma20 ? "above" : "below"} EMA20.`,
  ];

  let direction: "up" | "down" | "sideways";
  if (ema20AboveEma50 && priceAboveEma20) direction = "up";
  else if (!ema20AboveEma50 && !priceAboveEma20) direction = "down";
  else direction = "sideways";
  basis.push(`Direction classified as "${direction}" from the EMA relationship and price position above.`);

  return { direction, priceAboveEma20, ema20AboveEma50, basis };
}

function computeRecentRange(candles: readonly Candle[]): MarketStateRecentRange | undefined {
  if (candles.length <= BREAKOUT_LOOKBACK_BARS) return undefined;
  // Preceding window, excluding the latest candle.
  const window = candles.slice(candles.length - 1 - BREAKOUT_LOOKBACK_BARS, candles.length - 1);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  return { high, low, lookbackBars: BREAKOUT_LOOKBACK_BARS };
}

function computeBreakoutSignal(recentRange: MarketStateRecentRange | undefined, latestClose: number): "breakout" | "breakdown" | undefined {
  if (!recentRange) return undefined;
  if (latestClose > recentRange.high) return "breakout";
  if (latestClose < recentRange.low) return "breakdown";
  return undefined;
}

function computeVolatility(atr14: number | undefined, price: number): { band?: MarketStateVolatilityBand; atrPercent?: number } {
  if (atr14 === undefined || price <= 0) return {};
  const atrPercent = (atr14 / price) * 100;
  const band: MarketStateVolatilityBand =
    atrPercent < VOLATILITY_LOW_MAX_PCT ? "low" : atrPercent < VOLATILITY_HIGH_MIN_PCT ? "medium" : "high";
  return { band, atrPercent };
}

// Tracked set for dataQuality - the same 7 indicators MarketStateTechnical
// carries. "computed" counts how many are not undefined.
const TRACKED_INDICATOR_COUNT = 7;

function computeDataQuality(technical: MarketStateTechnical): DataConfidence {
  const computed = [
    technical.rsi14,
    technical.ema20,
    technical.ema50,
    technical.atr14,
    technical.macd,
    technical.bollinger,
    technical.volume,
  ].filter((v) => v !== undefined).length;

  let band: ConfidenceBand;
  if (computed === 0) band = "insufficient";
  else if (computed < TRACKED_INDICATOR_COUNT / 2) band = "low";
  else if (computed < TRACKED_INDICATOR_COUNT) band = "medium";
  else band = "high";

  return {
    band,
    computed,
    total: TRACKED_INDICATOR_COUNT,
    note: `${computed}/${TRACKED_INDICATOR_COUNT} tracked indicators were computable from the available candles.`,
  };
}

export class MarketStateService {
  assemble(input: AssembleMarketStateInput): MarketState {
    // Sprint D2.8.15, Phase 3 - reject structurally malformed candles (bad
    // OHLC, duplicate/out-of-order/future timestamps) BEFORE any indicator
    // sees them, rather than let a provider glitch silently corrupt a
    // computation. Every downstream computation below uses ONLY
    // `validation.validCandles` - never the raw `input.candles` - so a
    // rejected row can never leak into `technical`/`structure`.
    const validation = validateCandles(input.candles, input.nowMs ?? Date.now());
    const validCandles = validation.validCandles;

    const candleCloses = closes(validCandles);
    const technical = computeTechnical(candleCloses, validCandles);
    const latestPrice = input.snapshot.price;

    const trend = computeTrend(technical, latestPrice);
    const recentRange = computeRecentRange(validCandles);
    const breakoutSignal = computeBreakoutSignal(recentRange, latestPrice);
    const { band: volatilityBand, atrPercent } = computeVolatility(technical.atr14, latestPrice);

    const structure: MarketStateStructure = {
      trend,
      recentRange,
      breakoutSignal,
      volatilityBand,
      atrPercent,
      // liquidityZones, volumeDelta, bos, choch: intentionally omitted -
      // never populated in D2.5.2, see types/intelligence-market-state.ts.
    };

    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      snapshot: input.snapshot,
      technical,
      structure,
      dataQuality: computeDataQuality(technical),
      candleValidation: {
        totalReceived: validation.totalReceived,
        totalValid: validation.totalValid,
        issues: validation.issues,
      },
      generatedAt: new Date().toISOString(),
      pipelineVersion: INTELLIGENCE_ENGINE_VERSION,
    };
  }
}
