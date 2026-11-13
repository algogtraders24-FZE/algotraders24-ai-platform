// services/crypto-flow/compute.ts
// Pure maths for Crypto Flow (no network, no "server-only", so the validation script can import it).
// Input: Binance spot klines rows
//   [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
// delta per bar = takerBuyBase - (volume - takerBuyBase) = 2 * takerBuyBase - volume
// (buyer-aggressor volume minus seller-aggressor volume, base asset units).
import type { CryptoFlowPoint, CryptoFlowResponse, CryptoFlowSymbol, CryptoFlowWindow } from "@/types/crypto-flow";

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
    const takerBuy = Number(row[9]);
    if (![t, close, volume, closeTime, takerBuy].every(Number.isFinite)) continue;
    if (closeTime >= nowMs) continue; // the current minute is still open
    const delta = 2 * takerBuy - volume;
    cum += delta;
    points.push({ t, close, volume, delta, cum });
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

/** Builds the response from the raw klines. Returns null when there are too few closed bars. */
export function computeCryptoFlow(symbol: CryptoFlowSymbol, rows: ReadonlyArray<RawKline>, nowMs: number): CryptoFlowResponse | null {
  const points = parseClosedKlines(rows, nowMs);
  if (points.length < 60) return null;
  const last = points[points.length - 1];
  return {
    symbol,
    venue: "Binance spot",
    asOf: last.t,
    lastPrice: last.close,
    windows: { m15: windowOf(points, 15), h1: windowOf(points, 60), h4: windowOf(points, 240) },
    series: points,
  };
}
