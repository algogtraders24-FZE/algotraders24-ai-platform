// services/ai/technical-context.service.ts
// Sprint D2.2 (Phase 7) - turns real OHLC candles into a structured
// TechnicalContext, plus a RiskContext and a DataConfidence, using only the
// pure indicator engine. Nothing is fabricated: an indicator without enough
// candles stays undefined, observations are written only for indicators that
// were actually computed, and DataConfidence reflects how complete the real
// indicator set is - never a market prediction.
import type { Candle } from "@/types/market-candle";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type {
  TechnicalContext,
  TechnicalIndicators,
  RiskContext,
  DataConfidence,
  VolatilityBand,
  ConfidenceBand,
} from "@/types/technical-context";
import { closes, rsi, ema, sma, atr, macd, bollinger, volumeMetrics } from "@/lib/market-data/indicators";

// Enough candles for the core set (RSI-14, SMA-20, ATR-14, Bollinger-20).
const CORE_MIN_CANDLES = 20;
// The indicators DataConfidence tracks for completeness scoring.
const TRACKED = ["rsi14", "ema20", "ema50", "sma20", "atr14", "macd", "bollinger"] as const;

export class TechnicalContextService {
  build(symbol: string, interval: string, candles: readonly Candle[], computedAt: string): TechnicalContext {
    const cl = closes(candles);
    const indicators: TechnicalIndicators = {
      rsi14: rsi(cl, 14),
      ema20: ema(cl, 20),
      ema50: ema(cl, 50),
      sma20: sma(cl, 20),
      atr14: atr(candles, 14),
      macd: macd(cl),
      bollinger: bollinger(cl, 20, 2),
      volume: volumeMetrics(candles, 20),
    };

    const observations: string[] = [];
    if (indicators.rsi14 !== undefined) {
      const zone = indicators.rsi14 >= 70 ? "overbought territory" : indicators.rsi14 <= 30 ? "oversold territory" : "a neutral range";
      observations.push(`RSI(14) is ${indicators.rsi14.toFixed(1)}, in ${zone}.`);
    }
    if (indicators.ema20 !== undefined && indicators.ema50 !== undefined) {
      const rel = indicators.ema20 > indicators.ema50 ? "above" : indicators.ema20 < indicators.ema50 ? "below" : "level with";
      observations.push(`EMA(20) is ${rel} EMA(50).`);
    }
    if (indicators.macd) {
      const side = indicators.macd.histogram > 0 ? "positive" : indicators.macd.histogram < 0 ? "negative" : "flat";
      observations.push(`MACD histogram is ${side} (${indicators.macd.histogram.toFixed(4)}).`);
    }
    if (indicators.bollinger) {
      observations.push(`Bollinger(20,2) band spans ${indicators.bollinger.lower.toFixed(4)} to ${indicators.bollinger.upper.toFixed(4)}.`);
    }
    if (indicators.volume?.relative !== undefined) {
      const rel = indicators.volume.relative >= 1 ? "above" : "below";
      observations.push(`Latest volume is ${rel} its ${20}-period average (${indicators.volume.relative.toFixed(2)}x).`);
    }

    return {
      symbol,
      interval,
      candleCount: candles.length,
      hasSufficientData: candles.length >= CORE_MIN_CANDLES,
      indicators,
      observations,
      computedAt,
    };
  }

  buildRisk(snapshot: MarketSnapshot, technical: TechnicalContext): RiskContext {
    const notes: string[] = [];
    let atrPercent: number | undefined;
    let volatility: VolatilityBand | undefined;

    const atr14 = technical.indicators.atr14;
    if (atr14 !== undefined && snapshot.price > 0) {
      atrPercent = (atr14 / snapshot.price) * 100;
      // Coarse bands off ATR as a percent of price. The raw atrPercent is
      // always reported alongside so the label never hides the real number.
      volatility = atrPercent < 0.5 ? "low" : atrPercent < 1.5 ? "medium" : "high";
      notes.push(`ATR(14) is ${atrPercent.toFixed(2)}% of price — ${volatility} volatility.`);
    } else {
      notes.push("ATR could not be computed (insufficient candles) — volatility is unavailable.");
    }
    notes.push(`Market is currently ${snapshot.marketStatus}.`);

    return { volatility, atrPercent, marketStatus: snapshot.marketStatus, notes };
  }

  confidence(technical: TechnicalContext): DataConfidence {
    const computed = TRACKED.filter((k) => technical.indicators[k] !== undefined).length;
    const total = TRACKED.length;
    let band: ConfidenceBand;
    if (!technical.hasSufficientData) band = "insufficient";
    else if (computed === total) band = "high";
    else if (computed >= Math.ceil(total / 2)) band = "medium";
    else band = "low";
    return {
      band,
      computed,
      total,
      note: `${computed} of ${total} indicators computed from ${technical.candleCount} candles.`,
    };
  }
}
