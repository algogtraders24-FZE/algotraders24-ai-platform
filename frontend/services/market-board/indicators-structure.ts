// services/market-board/indicators-structure.ts
// AT24 Market Structure (swing breaks: BOS and CHoCH with follow-through statistics) and AT24 Expected Range (usual daily range, range used so far,
// projected day high and low, with statistics) for the Market Board. Ported from the independent Python checks that matched the MetaTrader 5 builds
// (ea-research/indicators/AT24_Market_Structure and AT24_Expected_Range); scripts/validate-market-board-more.ts replays their self-test files.
// Closed bars only. Descriptive, not a signal.
import type { Bar } from "./indicators";

// ---------------------------------------------------------------------------------------------------------------------
// Market Structure
// ---------------------------------------------------------------------------------------------------------------------
export interface StructureParams {
  k: number;
  forward: number;
}
export const STRUCTURE_DEFAULTS: StructureParams = { k: 5, forward: 20 };

export interface StructureEvent {
  /** Bar whose close broke the level, the pivot bar that made the level, and the level. */
  idx: number;
  pivot: number;
  price: number;
  dir: 1 | -1;
  /** 1 = change of character (the break goes against the previous trend), 0 = break of structure (with the trend). */
  choch: 0 | 1;
}

export function structureEvents(H: number[], L: number[], C: number[], p: StructureParams): { events: StructureEvent[]; trend: 1 | -1 | 0 } {
  const n = C.length;
  const events: StructureEvent[] = [];
  let trend: 1 | -1 | 0 = 0;
  let hi: { price: number; idx: number } | null = null;
  let lo: { price: number; idx: number } | null = null;
  for (let i = 0; i < n; i++) {
    const j = i - p.k;
    if (j >= p.k) {
      let isHigh = true;
      let isLow = true;
      for (let q = j - p.k; q <= j + p.k; q++) {
        if (q === j) continue;
        if (!(H[q] < H[j])) isHigh = false;
        if (!(L[q] > L[j])) isLow = false;
      }
      if (isHigh) hi = { price: H[j], idx: j };
      if (isLow) lo = { price: L[j], idx: j };
    }
    if (hi && C[i] > hi.price) {
      events.push({ idx: i, pivot: hi.idx, price: hi.price, dir: 1, choch: trend === -1 ? 1 : 0 });
      trend = 1;
      hi = null;
    }
    if (lo && C[i] < lo.price) {
      events.push({ idx: i, pivot: lo.idx, price: lo.price, dir: -1, choch: trend === 1 ? 1 : 0 });
      trend = -1;
      lo = null;
    }
  }
  return { events, trend };
}

export interface StructureStats {
  bos: number;
  bosFollowPct: number;
  choch: number;
  chochFollowPct: number;
  /** Share of all bars after which price was higher `forward` bars later (the base rate to compare with). */
  baseUpPct: number;
  bosN: number;
  chochN: number;
}

export function structureStats(C: number[], events: readonly StructureEvent[], p: StructureParams): StructureStats | null {
  const n = C.length;
  const cnt: Record<0 | 1, [number, number, number]> = { 0: [0, 0, 0], 1: [0, 0, 0] };
  for (const e of events) {
    cnt[e.choch][0] += 1;
    if (e.idx + p.forward < n) {
      cnt[e.choch][1] += 1;
      const up = C[e.idx + p.forward] > C[e.idx];
      if ((e.dir === 1) === up && C[e.idx + p.forward] !== C[e.idx]) cnt[e.choch][2] += 1;
    }
  }
  const tot = Math.max(0, n - p.forward);
  if (tot === 0 || cnt[0][1] === 0 || cnt[1][1] === 0) return null;
  let up = 0;
  for (let t = 0; t < tot; t++) if (C[t + p.forward] > C[t]) up += 1;
  return {
    bos: cnt[0][0],
    bosFollowPct: (100 * cnt[0][2]) / cnt[0][1],
    choch: cnt[1][0],
    chochFollowPct: (100 * cnt[1][2]) / cnt[1][1],
    baseUpPct: (100 * up) / tot,
    bosN: cnt[0][1],
    chochN: cnt[1][1],
  };
}

export interface StructureBoard {
  trend: "up" | "down" | "none";
  /** The latest breaks, drawn as a line from the pivot bar to the breaking bar. */
  recent: Array<{ kind: "BOS" | "CHoCH"; dir: 1 | -1; price: number; pivotTime: string; breakTime: string }>;
  stats: StructureStats | null;
}

export function computeStructureBoard(bars: readonly Bar[], p: StructureParams = STRUCTURE_DEFAULTS, drawN = 6): StructureBoard {
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const { events, trend } = structureEvents(H, L, C, p);
  return {
    trend: trend === 1 ? "up" : trend === -1 ? "down" : "none",
    recent: events.slice(-drawN).map((e) => ({ kind: e.choch ? "CHoCH" : "BOS", dir: e.dir, price: e.price, pivotTime: bars[e.pivot].time, breakTime: bars[e.idx].time })),
    stats: structureStats(C, events, p),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Expected Range
// ---------------------------------------------------------------------------------------------------------------------
export interface ErDay {
  first: number;
  last: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Usual range: the average high-low range of the previous `lookback` days (0 until there are enough days). */
  exp: number;
  /** First bar of the day where the range so far reached the usual range, or -1. */
  hit: number;
}

/** T = bar open times in epoch seconds; days are UTC days. */
export function buildErDays(T: number[], O: number[], H: number[], L: number[], C: number[], lookback = 14): ErDay[] {
  const days: ErDay[] = [];
  let cur: number | null = null;
  for (let i = 0; i < T.length; i++) {
    const dk = Math.floor(T[i] / 86400);
    if (dk !== cur) {
      cur = dk;
      days.push({ first: i, last: i, open: O[i], high: H[i], low: L[i], close: C[i], exp: 0, hit: -1 });
    } else {
      const d = days[days.length - 1];
      d.last = i;
      d.close = C[i];
      d.high = Math.max(d.high, H[i]);
      d.low = Math.min(d.low, L[i]);
    }
  }
  for (let k = 1; k < days.length; k++) {
    if (k - 1 < lookback) continue;
    let s = 0;
    for (let j = k - lookback; j < k; j++) s += days[j].high - days[j].low;
    days[k].exp = s / lookback;
    let hi = -1e300;
    let lo = 1e300;
    for (let i = days[k].first; i <= days[k].last; i++) {
      hi = Math.max(hi, H[i]);
      lo = Math.min(lo, L[i]);
      if (hi - lo >= days[k].exp) {
        days[k].hit = i;
        break;
      }
    }
  }
  return days;
}

export interface ErStats {
  days: number;
  medianRatio: number;
  reach100Pct: number;
  reach150Pct: number;
  hits: number;
  hit125Pct: number;
  hitMedian: number;
  directional50Pct: number;
}

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function erStats(days: readonly ErDay[]): ErStats | null {
  const ratio: number[] = [];
  const fin: number[] = [];
  let dir = 0;
  for (const d of days.slice(0, -1)) {
    if (d.exp <= 0) continue;
    const rg = (d.high - d.low) / d.exp;
    ratio.push(rg);
    if (Math.abs(d.close - d.open) >= 0.5 * d.exp) dir += 1;
    if (d.hit >= 0) fin.push(rg);
  }
  const m = ratio.length;
  if (m === 0 || fin.length === 0) return null;
  return {
    days: m,
    medianRatio: median(ratio),
    reach100Pct: (100 * ratio.filter((r) => r >= 1).length) / m,
    reach150Pct: (100 * ratio.filter((r) => r >= 1.5).length) / m,
    hits: fin.length,
    hit125Pct: (100 * fin.filter((r) => r >= 1.25).length) / fin.length,
    hitMedian: median(fin),
    directional50Pct: (100 * dir) / m,
  };
}

export interface ErBoard {
  /** Today's usual range with its projected high and low, and how much of it is used so far (null until 14 days of history). */
  today: { usual: number; usedPct: number; expectedHigh: number; expectedLow: number; open: number; dayStart: string } | null;
  stats: ErStats | null;
}

export function computeErBoard(bars: readonly Bar[], lookback = 14): ErBoard {
  const T = bars.map((b) => Date.parse(b.time) / 1000);
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const days = buildErDays(T, O, H, L, C, lookback);
  const d = days[days.length - 1];
  const today = d && d.exp > 0 ? { usual: d.exp, usedPct: (100 * (d.high - d.low)) / d.exp, expectedHigh: d.low + d.exp, expectedLow: d.high - d.exp, open: d.open, dayStart: bars[d.first].time } : null;
  return { today, stats: erStats(days) };
}
