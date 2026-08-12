// lib/chart-engine/candle-classifier.ts
// Sprint D2.7.2, Phase 5 - bullish/bearish/doji classification for the
// candlestick renderer. Pure, deterministic, driven entirely by the
// candle's own OHLC values.
import type { ChartCandle, ChartCandleTrend } from "@/types/chart-data";

// A doji is a candle whose body is small relative to its own full
// high-low range - the standard candlestick-charting convention. 5% of
// the candle's own range is a real, commonly published doji threshold
// (not an arbitrary pixel value), so it stays correct at any zoom level
// or instrument price magnitude.
const DOJI_BODY_RATIO = 0.05;

export function classifyCandle(candle: ChartCandle): ChartCandleTrend {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (range === 0 || body / range <= DOJI_BODY_RATIO) return "doji";
  return candle.close >= candle.open ? "bullish" : "bearish";
}
