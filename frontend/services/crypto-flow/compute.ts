// services/crypto-flow/compute.ts
// Pure maths for Crypto Flow (no network, no "server-only", so the validation script can import it).
// Input: Binance spot klines rows
//   [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
// delta per bar = takerBuyBase - (volume - takerBuyBase) = 2 * takerBuyBase - volume
// (buyer-aggressor volume minus seller-aggressor volume, base asset units).
import type { CryptoFlowBias, CryptoFlowPoint, CryptoFlowQuality, CryptoFlowResponse, CryptoFlowWindow } from "@/types/crypto-flow";

export type RawKline = ReadonlyArray<string | number>;

/** Parses the closed bars out of the raw rows: drops rows that are malformed or still open at `nowMs`. */
export function parseClosedKlines(rows: ReadonlyArray<RawKline>, nowMs: number): CryptoFlowPoint[] {
  const points: CryptoFlowPoint[] = [];
  let cum = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const t = Number(row[0]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const closeTime = Number(row[6]);
    const trades = Number(row[8]);
    const takerBuy = Number(row[9]);
    if (![t, close, volume, closeTime, trades, takerBuy].every(Number.isFinite)) continue;
    if (closeTime >= nowMs) continue; // the current minute is still open
    const delta = 2 * takerBuy - volume;
    cum += delta;
    points.push({ t, close, volume, trades, delta, cum });
  }
  return points;
}

function windowOf(points: ReadonlyArray<CryptoFlowPoint>, minutes: number): CryptoFlowWindow {
  const slice = points.slice(Math.max(0, points.length - minutes));
  let delta = 0;
  let volume = 0;
  for (const p of slice) {
    delta += p.delta;
    volume += p.volume;
  }
  const first = slice[0];
  const last = slice[slice.length - 1];
  return {
    minutes: slice.length,
    delta,
    volume,
    deltaPct: volume > 0 ? (100 * delta) / volume : 0,
    buyPct: volume > 0 ? (100 * (volume + delta)) / (2 * volume) : 50,
    priceChangePct: first && last && first.close > 0 ? (100 * (last.close / first.close - 1)) : 0,
  };
}

/**
 * Summarises the three windows into one bias. score = weighted mean of (buyers' share - 50) over 15 min (weight 1),
 * 1 h (weight 2) and 4 h (weight 1). |score| < 2 points = balanced; 2-5 mild; 5-10 moderate; above 10 strong.
 * "consistent" = all three windows lean the same way by at least 2 points.
 */
export function flowBias(windows: { m15: CryptoFlowWindow; h1: CryptoFlowWindow; h4: CryptoFlowWindow }): CryptoFlowBias {
  const d15 = windows.m15.buyPct - 50;
  const d1 = windows.h1.buyPct - 50;
  const d4 = windows.h4.buyPct - 50;
  const score = (d15 + 2 * d1 + d4) / 4;
  const abs = Math.abs(score);
  const side = abs < 2 ? "balanced" : score > 0 ? "buyers" : "sellers";
  const strength = side === "balanced" ? null : abs < 5 ? "mild" : abs < 10 ? "moderate" : "strong";
  const consistent = (d15 >= 2 && d1 >= 2 && d4 >= 2) || (d15 <= -2 && d1 <= -2 && d4 <= -2);
  return { side, strength, score, consistent };
}

/**
 * Data quality from the trades per minute over the window (up to the last 240 closed minutes):
 * high = median at least 100 trades a minute and no more than 2 % empty minutes; thin = median below 20 or at least 5 % empty minutes; otherwise medium.
 */
export function flowQuality(points: ReadonlyArray<CryptoFlowPoint>): CryptoFlowQuality {
  const slice = points.slice(Math.max(0, points.length - 240));
  const counts = slice.map((p) => p.trades).sort((a, b) => a - b);
  const n = counts.length;
  const median = n === 0 ? 0 : n % 2 === 1 ? counts[(n - 1) / 2] : (counts[n / 2 - 1] + counts[n / 2]) / 2;
  const emptyMinutes = counts.filter((c) => c === 0).length;
  const emptyShare = n > 0 ? emptyMinutes / n : 1;
  const level = median < 20 || emptyShare >= 0.05 ? "thin" : median >= 100 && emptyShare <= 0.02 ? "high" : "medium";
  return { level, medianTradesPerMinute: median, emptyMinutes };
}

/** Builds the response from the raw klines. Returns null when there are too few closed bars. */
export function computeCryptoFlow(symbol: string, rows: ReadonlyArray<RawKline>, nowMs: number, venue = "Binance spot", withSeries = true): CryptoFlowResponse | null {
  const points = parseClosedKlines(rows, nowMs);
  if (points.length < 60) return null;
  const last = points[points.length - 1];
  const windows = { m15: windowOf(points, 15), h1: windowOf(points, 60), h4: windowOf(points, 240) };
  return {
    symbol,
    venue,
    asOf: last.t,
    lastPrice: last.close,
    windows,
    bias: flowBias(windows),
    quality: flowQuality(points),
    ...(withSeries ? { series: points } : {}),
  };
}
