// services/swing-lab/compute.ts
// Pure maths for the Swing Lab trend and level map (no network, no "server-only"; the validation script imports it).
// Input: bars of one instrument on three timeframes (weekly, daily, 4-hour), only closed bars. They come from the MT5 data bridge candles
// (parseBridgeCandles drops the still-forming last candle) or, for series that trade 7 days a week and in the validation, from Binance klines
// (parseBars + weeklyBars).
//   trend of a timeframe: close, SMA(20) and SMA(50) of closes. up: close > SMA20 > SMA50; down: close < SMA20 < SMA50; else mixed. Needs 50 bars.
//   weekly bars: the bridge's own weekly candles; weeklyBars() builds them from complete UTC weeks (7 daily bars) for 7-day series.
//   alignment: all three timeframes up = "aligned up", all three down = "aligned down", else mixed.
//   ATR(14) on daily bars = simple mean of the last 14 true ranges, true range = max(high - low, |high - previous close|, |low - previous close|).
//   levels (candidates): daily swing highs / lows (a bar whose high is strictly above the 5 bars before and the 5 bars after it; lows mirrored),
//   searched in the last 180 daily bars; the high / low of the previous complete week; the 20-day high / low (last 20 closed daily bars).
//   resistance = the candidate nearest ABOVE the price; support = the candidate nearest BELOW (priority order on a tie: swing, week, 20-day).
//   rangePos = (price - lowest low of the last 50 daily bars) / (highest high - lowest low) * 100.
import type { SwingAlignment, SwingLevel, SwingMapRow, SwingTrend } from "@/types/swing-lab";

export type RawKline = ReadonlyArray<string | number>;

export interface Bar {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export function parseBars(rows: ReadonlyArray<RawKline>, nowMs: number): Bar[] {
  const bars: Bar[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const t = Number(r[0]);
    const open = Number(r[1]);
    const high = Number(r[2]);
    const low = Number(r[3]);
    const close = Number(r[4]);
    const closeTime = Number(r[6]);
    if (![t, open, high, low, close, closeTime].every(Number.isFinite)) continue;
    if (closeTime >= nowMs) continue; // still open
    bars.push({ t, open, high, low, close });
  }
  return bars;
}

export interface BridgeCandle {
  datetime?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

/**
 * Closed bars from bridge / Exness candles (oldest first). With `opts` the last candle is dropped only while it is still forming (its open time plus
 * the timeframe is after now), so on a weekend the finished Friday candle is kept; without `opts` the last candle is always dropped.
 */
export function parseBridgeCandles(rows: ReadonlyArray<BridgeCandle>, opts?: { nowMs: number; intervalMs: number }): Bar[] {
  const bars: Bar[] = [];
  for (const r of rows) {
    const t = typeof r.datetime === "string" ? Date.parse(r.datetime) : NaN;
    const open = Number(r.open);
    const high = Number(r.high);
    const low = Number(r.low);
    const close = Number(r.close);
    if (![t, open, high, low, close].every(Number.isFinite) || !(high >= low)) continue;
    bars.push({ t, open, high, low, close });
  }
  bars.sort((a, b) => a.t - b.t);
  const last = bars[bars.length - 1];
  if (!last) return bars;
  const forming = opts ? last.t + opts.intervalMs > opts.nowMs : true;
  return forming ? bars.slice(0, bars.length - 1) : bars;
}

export function sma(values: ReadonlyArray<number>, n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

export function trendOf(bars: ReadonlyArray<Bar>): SwingTrend | null {
  if (bars.length < 50) return null;
  const closes = bars.map((b) => b.close);
  const close = closes[closes.length - 1];
  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  if (fast === null || slow === null) return null;
  if (close > fast && fast > slow) return "up";
  if (close < fast && fast < slow) return "down";
  return "mixed";
}

/** Complete UTC weeks (7 daily bars, Monday start) built from daily bars, oldest first. */
export function weeklyBars(daily: ReadonlyArray<Bar>): Bar[] {
  const groups = new Map<number, Bar[]>();
  for (const b of daily) {
    const key = Math.floor((b.t + 3 * DAY_MS) / WEEK_MS);
    const g = groups.get(key);
    if (g) g.push(b);
    else groups.set(key, [b]);
  }
  const out: Bar[] = [];
  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(key)!;
    if (g.length !== 7) continue;
    out.push({ t: g[0].t, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1].close });
  }
  return out;
}

export function atr14(daily: ReadonlyArray<Bar>): number | null {
  if (daily.length < 15) return null;
  let s = 0;
  for (let i = daily.length - 14; i < daily.length; i++) {
    const b = daily[i];
    const pc = daily[i - 1].close;
    s += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  }
  return s / 14;
}

interface Candidate {
  price: number;
  source: SwingLevel["source"];
}

export function levelCandidates(daily: ReadonlyArray<Bar>, weekly: ReadonlyArray<Bar>): Candidate[] {
  const out: Candidate[] = [];
  const n = daily.length;
  const from = Math.max(5, n - 180);
  for (let i = from; i <= n - 6; i++) {
    let hi = true;
    let lo = true;
    for (let k = 1; k <= 5; k++) {
      if (!(daily[i].high > daily[i - k].high && daily[i].high > daily[i + k].high)) hi = false;
      if (!(daily[i].low < daily[i - k].low && daily[i].low < daily[i + k].low)) lo = false;
    }
    if (hi) out.push({ price: daily[i].high, source: "daily swing high" });
    if (lo) out.push({ price: daily[i].low, source: "daily swing low" });
  }
  if (weekly.length > 0) {
    const w = weekly[weekly.length - 1];
    out.push({ price: w.high, source: "previous week high" }, { price: w.low, source: "previous week low" });
  }
  if (n >= 20) {
    const last = daily.slice(n - 20);
    out.push({ price: Math.max(...last.map((b) => b.high)), source: "20-day high" }, { price: Math.min(...last.map((b) => b.low)), source: "20-day low" });
  }
  return out;
}

function levelFrom(c: Candidate, price: number, atr: number): SwingLevel {
  return { price: c.price, distancePct: (100 * (c.price - price)) / price, distanceAtr: (c.price - price) / atr, source: c.source };
}

export function nearestLevels(cands: ReadonlyArray<Candidate>, price: number, atr: number): { resistance: SwingLevel | null; support: SwingLevel | null } {
  let up: Candidate | null = null;
  let down: Candidate | null = null;
  for (const c of cands) {
    if (c.price > price && (up === null || c.price < up.price)) up = c;
    if (c.price < price && (down === null || c.price > down.price)) down = c;
  }
  return { resistance: up ? levelFrom(up, price, atr) : null, support: down ? levelFrom(down, price, atr) : null };
}

export function alignmentOf(w1: SwingTrend | null, d1: SwingTrend | null, h4: SwingTrend | null): SwingAlignment {
  if (w1 === "up" && d1 === "up" && h4 === "up") return "aligned up";
  if (w1 === "down" && d1 === "down" && h4 === "down") return "aligned down";
  return "mixed";
}

/** The map row for one instrument from closed bars (oldest first). Null when the daily history is too short. */
export function computeSwingMapFromBars(symbol: string, daily: ReadonlyArray<Bar>, h4: ReadonlyArray<Bar>, weekly: ReadonlyArray<Bar>): SwingMapRow | null {
  if (daily.length < 60 || h4.length < 1) return null;
  const last4h = h4[h4.length - 1];
  const price = last4h.close;
  const atr = atr14(daily);
  if (atr === null || !(atr > 0) || !(price > 0)) return null;
  const w1 = trendOf(weekly);
  const d1 = trendOf(daily);
  const h4t = trendOf(h4);
  const last50 = daily.slice(daily.length - 50);
  const lo50 = Math.min(...last50.map((b) => b.low));
  const hi50 = Math.max(...last50.map((b) => b.high));
  const { resistance, support } = nearestLevels(levelCandidates(daily, weekly), price, atr);
  return {
    symbol,
    price,
    asOfBar: last4h.t,
    atrPct: (100 * atr) / price,
    w1,
    d1,
    h4: h4t,
    alignment: alignmentOf(w1, d1, h4t),
    resistance,
    support,
    rangePosPct: hi50 > lo50 ? (100 * (price - lo50)) / (hi50 - lo50) : 50,
  };
}

/** Same from Binance klines (7-day series; weekly bars are built from the daily bars). Used by the validation script. */
export function computeSwingMap(symbol: string, dailyRows: ReadonlyArray<RawKline>, h4Rows: ReadonlyArray<RawKline>, nowMs: number): SwingMapRow | null {
  const daily = parseBars(dailyRows, nowMs);
  return computeSwingMapFromBars(symbol, daily, parseBars(h4Rows, nowMs), weeklyBars(daily));
}
