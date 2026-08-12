// lib/chart-engine/crosshair.ts
// Sprint D2.7.2, Phase 8 - crosshair foundation: nearest-candle lookup only.
// Never interpolates a synthetic OHLC value between two real candles - the
// crosshair always snaps to and reports an actual traded candle.
//
// Sprint D2.7.3, Phase 3/12 - now delegates to candle-index.ts's binary
// search (O(log n)) instead of this file's own O(n) linear scan. This
// function fires on every `mousemove`, the single highest-frequency call
// in the whole engine, so it is the one lookup where the algorithmic
// complexity genuinely matters at a 5,000-candle series - a linear scan
// there was the actual perf risk Phase 12 calls out, not the once-per-
// frame axis/candle drawing loops. Signature and behavior are unchanged;
// existing callers/tests need no changes.
import type { ChartCandle } from "@/types/chart-data";
import type { Viewport } from "./types";
import { xToTime } from "./coordinate-system";
import { nearestIndexByTime } from "./candle-index";

/** The real candle index nearest a pixel x position. Returns -1 for an empty series. */
export function nearestCandleIndex(candles: ChartCandle[], viewport: Viewport, xPixel: number, plotWidth: number): number {
  const targetTime = xToTime(xPixel, viewport, plotWidth);
  return nearestIndexByTime(candles, targetTime);
}
