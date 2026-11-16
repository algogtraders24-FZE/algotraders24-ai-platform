// services/market-board/indicators.ts
// Pure maths for the Market Board: supply/demand zones with first-retest scorecards (AT24 Zone Pro), RSI divergence with scorecards
// (AT24 Divergence Pro), the market overview row (AT24 Market Heatmap) and pair correlation shift (AT24 Correlation Shift Monitor).
// Ported one to one from the independent Python checks that matched the MetaTrader 5 builds (ea-research/indicators/*/test/verify_*.py);
// scripts/validate-market-board.ts replays the MT5 self-test files through this file and compares every zone, trade and score.
// Closed bars only, chronological arrays, no network, no randomness except the fixed-seed sign-flip luck test. Descriptive, not a signal.

export interface Bar {
  /** Bar open time, ISO 8601. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** ATR(14): simple average while warming up, then Wilder smoothing (same as the MT5 builds). */
export function atrWilder(H: number[], L: number[], C: number[], period = 14): number[] {
  const n = H.length;
  const atr = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? H[0] - L[0] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]));
    atr[i] = i === 0 ? tr : i < period ? (atr[i - 1] * i + tr) / (i + 1) : (atr[i - 1] * (period - 1) + tr) / period;
  }
  return atr;
}

/** Wilder RSI; values before the first full period are 50. */
export function rsiWilder(C: number[], period = 14): number[] {
  const n = C.length;
  const rsi = new Array<number>(n).fill(50);
  let ag = 0;
  let al = 0;
  for (let i = 1; i < n; i++) {
    const ch = C[i] - C[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= period) {
      ag += g;
      al += l;
      if (i === period) {
        ag /= period;
        al /= period;
        rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      }
    } else {
      ag = (ag * (period - 1) + g) / period;
      al = (al * (period - 1) + l) / period;
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  return rsi;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scorecard: R after cost, t-statistic and a sign-flip luck test (fixed seed, xorshift32, 5000 flips)
// ---------------------------------------------------------------------------------------------------------------------
export interface Trade {
  /** Entry bar index (zones: the touch bar; divergences: the signal bar). */
  idx: number;
  dir: 1 | -1;
  entry: number;
  sl: number;
  tp: number;
  risk: number;
  exitIdx: number;
  /** 1 target, -1 stop, 0 timed exit, 2 still open. */
  result: 1 | -1 | 0 | 2;
  r: number;
}

export type VerdictKind = "too_few" | "positive" | "negative" | "no_edge";

export interface Score {
  n: number;
  wins: number;
  hitPct: number;
  avgR: number;
  sumR: number;
  t: number;
  pFlip: number;
  open: number;
  verdict: VerdictKind;
}

export const MIN_TRADES_FOR_VERDICT = 30;

function xorshift(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x;
  };
}

export function verdictOf(n: number, avgR: number, pFlip: number): VerdictKind {
  if (n < MIN_TRADES_FOR_VERDICT) return "too_few";
  if (avgR > 0 && pFlip < 0.05) return "positive";
  if (avgR < 0 && pFlip > 0.95) return "negative";
  return "no_edge";
}

export function scoreTrades(trades: readonly Trade[], seed = 20261111): Score {
  const rs = trades.filter((x) => x.result !== 2).map((x) => x.r);
  const open = trades.length - rs.length;
  const n = rs.length;
  const wins = rs.filter((v) => v > 0).length;
  if (n < 2) {
    const total = rs.reduce((a, b) => a + b, 0);
    return { n, wins, hitPct: n ? (100 * wins) / n : 0, avgR: n ? total / n : 0, sumR: total, t: 0, pFlip: 1, open, verdict: verdictOf(n, 0, 1) };
  }
  const total = rs.reduce((a, b) => a + b, 0);
  const mean = total / n;
  const variance = (rs.reduce((a, v) => a + v * v, 0) - n * mean * mean) / (n - 1);
  const sd = Math.sqrt(Math.max(variance, 0));
  const t = sd > 0 ? mean / (sd / Math.sqrt(n)) : 0;
  const next = xorshift(seed);
  let count = 0;
  for (let f = 0; f < 5000; f++) {
    let s = 0;
    for (const v of rs) s += (next() >>> 8) & 1 ? v : -v;
    if (s >= total - 1e-9) count += 1;
  }
  const pFlip = (1 + count) / 5001;
  return { n, wins, hitPct: (100 * wins) / n, avgR: mean, sumR: total, t, pFlip, open, verdict: verdictOf(n, mean, pFlip) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zone Pro
// ---------------------------------------------------------------------------------------------------------------------
export interface ZoneParams {
  impK: number;
  baseMax: number;
  maxBase: number;
  maxH: number;
  maxAge: number;
  slBuf: number;
  rr: number;
  hold: number;
}
export const ZONE_DEFAULTS: ZoneParams = { impK: 1.5, baseMax: 0.9, maxBase: 3, maxH: 2.0, maxAge: 200, slBuf: 0.25, rr: 2.0, hold: 40 };

export interface Zone {
  /** Impulse bar index: the zone is known at its close. */
  idx: number;
  dir: 1 | -1;
  top: number;
  bottom: number;
  atr: number;
  /** First bar that reached the zone within maxAge bars, or -1 while it is fresh. */
  touch: number;
}

export function detectZones(O: number[], H: number[], L: number[], C: number[], atr: number[], p: ZoneParams): Zone[] {
  const n = H.length;
  const zones: Zone[] = [];
  for (let j = 30; j < n; j++) {
    const a = atr[j - 1];
    if (a <= 0) continue;
    const rg = H[j] - L[j];
    const body = Math.abs(C[j] - O[j]);
    if (rg < p.impK * a || body < 0.6 * rg) continue;
    const dir: 1 | -1 = C[j] > O[j] ? 1 : -1;
    let cb = 0;
    let zh = -1e300;
    let zl = 1e300;
    for (let k = j - 1; k >= 1 && cb < p.maxBase; k--) {
      if (H[k] - L[k] >= p.baseMax * a) break;
      zh = Math.max(zh, H[k]);
      zl = Math.min(zl, L[k]);
      cb += 1;
    }
    if (cb === 0) continue;
    if (dir > 0 && !(C[j] > zh)) continue;
    if (dir < 0 && !(C[j] < zl)) continue;
    if (zh - zl > p.maxH * a) continue;
    zones.push({ idx: j, dir, top: zh, bottom: zl, atr: a, touch: -1 });
  }
  for (const z of zones) {
    const last = Math.min(n - 1, z.idx + p.maxAge);
    for (let k = z.idx + 1; k <= last; k++) {
      if ((z.dir > 0 && L[k] <= z.top) || (z.dir < 0 && H[k] >= z.bottom)) {
        z.touch = k;
        break;
      }
    }
  }
  return zones;
}

/** First retest of each touched zone, one trade at a time, in order of the touch bar. filter: 1 demand only, -1 supply only, 0 both. */
export function zoneTrades(O: number[], H: number[], L: number[], C: number[], zones: readonly Zone[], filter: 0 | 1 | -1, p: ZoneParams, cost: number): Trade[] {
  const n = H.length;
  const cand = zones
    .map((z, i) => ({ z, i }))
    .filter(({ z }) => z.touch >= 0 && (filter === 0 || z.dir === filter))
    .sort((a, b) => a.z.touch - b.z.touch || a.i - b.i);
  const out: Trade[] = [];
  let last = -1;
  for (const { z } of cand) {
    const k = z.touch;
    const d = z.dir;
    if (k <= last) continue;
    const entry = d > 0 ? Math.min(O[k], z.top) : Math.max(O[k], z.bottom);
    const sl = d > 0 ? z.bottom - p.slBuf * z.atr : z.top + p.slBuf * z.atr;
    const risk = d * (entry - sl);
    if (risk <= 0) continue;
    const tp = entry + d * p.rr * risk;
    let res: Trade["result"] = 2;
    let ex = -1;
    let r = 0;
    const end = Math.min(n - 1, k + p.hold);
    for (let j = k; j <= end; j++) {
      const slHit = d > 0 ? L[j] <= sl : H[j] >= sl;
      const tpHit = d > 0 ? H[j] >= tp : L[j] <= tp;
      if (slHit) {
        res = -1;
        ex = j;
        r = -1 - cost / risk;
        break;
      }
      if (tpHit) {
        res = 1;
        ex = j;
        r = p.rr - cost / risk;
        break;
      }
      if (j === k + p.hold) {
        res = 0;
        ex = j;
        r = (d * (C[j] - entry)) / risk - cost / risk;
        break;
      }
    }
    out.push({ idx: k, dir: d, entry, sl, tp, risk, exitIdx: ex, result: res, r });
    last = res === 2 ? n : ex;
  }
  return out;
}

export interface ZonePlan {
  side: "BUY" | "SELL";
  limit: number;
  stop: number;
  target: number;
}

export function zonePlan(z: Zone, p: ZoneParams): ZonePlan {
  const entry = z.dir > 0 ? z.top : z.bottom;
  const sl = z.dir > 0 ? z.bottom - p.slBuf * z.atr : z.top + p.slBuf * z.atr;
  const risk = z.dir * (entry - sl);
  return { side: z.dir > 0 ? "BUY" : "SELL", limit: entry, stop: sl, target: entry + z.dir * p.rr * risk };
}

export interface ZoneBoard {
  fresh: Array<Zone & { plan: ZonePlan; time: string }>;
  touchedOnLastBar: boolean;
  scores: { demand: Score; supply: Score; all: Score };
  recentTrades: Array<Trade & { time: string; exitTime: string | null }>;
  zonesFound: number;
}

export function computeZoneBoard(bars: readonly Bar[], cost: number, p: ZoneParams = ZONE_DEFAULTS, drawPerSide = 3, drawTrades = 8): ZoneBoard {
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const n = bars.length;
  const atr = atrWilder(H, L, C);
  const zones = detectZones(O, H, L, C, atr, p);
  const tAll = zoneTrades(O, H, L, C, zones, 0, p, cost);
  const tDem = zoneTrades(O, H, L, C, zones, 1, p, cost);
  const tSup = zoneTrades(O, H, L, C, zones, -1, p, cost);
  const freshAll = zones.filter((z) => z.touch < 0 && n - 1 - z.idx <= p.maxAge);
  const pick = (dir: 1 | -1) => freshAll.filter((z) => z.dir === dir).slice(-drawPerSide);
  const fresh = [...pick(1), ...pick(-1)].map((z) => ({ ...z, plan: zonePlan(z, p), time: bars[z.idx].time }));
  return {
    fresh,
    touchedOnLastBar: zones.some((z) => z.touch === n - 1),
    scores: { demand: scoreTrades(tDem), supply: scoreTrades(tSup), all: scoreTrades(tAll) },
    recentTrades: tAll.slice(-drawTrades).map((t) => ({ ...t, time: bars[t.idx].time, exitTime: t.exitIdx >= 0 ? bars[t.exitIdx].time : null })),
    zonesFound: zones.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Divergence Pro
// ---------------------------------------------------------------------------------------------------------------------
export interface DivergenceParams {
  k: number;
  minSep: number;
  maxSep: number;
  minDiff: number;
  slBuf: number;
  maxRisk: number;
  rr: number;
  hold: number;
}
export const DIVERGENCE_DEFAULTS: DivergenceParams = { k: 5, minSep: 6, maxSep: 60, minDiff: 2.0, slBuf: 0.25, maxRisk: 4.0, rr: 2.0, hold: 40 };

export interface DivergenceEvent {
  /** Confirmation bar (last bar of the right-hand window): the signal bar. */
  idx: number;
  dir: 1 | -1;
  /** Swing bar and the previous swing of the same kind. */
  p: number;
  q: number;
}

export function divergenceEvents(H: number[], L: number[], rsi: number[], p: DivergenceParams): DivergenceEvent[] {
  const n = H.length;
  const ev: DivergenceEvent[] = [];
  let ll = -1;
  let lh = -1;
  for (let i = p.k + 1; i < n - p.k; i++) {
    let loOk = true;
    let hiOk = true;
    for (let j = i - p.k; j < i; j++) {
      if (!(L[j] > L[i])) loOk = false;
      if (!(H[j] < H[i])) hiOk = false;
    }
    for (let j = i + 1; j <= i + p.k; j++) {
      if (!(L[j] >= L[i])) loOk = false;
      if (!(H[j] <= H[i])) hiOk = false;
    }
    if (loOk) {
      if (ll >= 0 && i - ll >= p.minSep && i - ll <= p.maxSep && L[i] < L[ll] && rsi[i] > rsi[ll] + p.minDiff) ev.push({ idx: i + p.k, dir: 1, p: i, q: ll });
      ll = i;
    }
    if (hiOk) {
      if (lh >= 0 && i - lh >= p.minSep && i - lh <= p.maxSep && H[i] > H[lh] && rsi[i] < rsi[lh] - p.minDiff) ev.push({ idx: i + p.k, dir: -1, p: i, q: lh });
      lh = i;
    }
  }
  return ev;
}

export function divergenceTrades(O: number[], H: number[], L: number[], C: number[], atr: number[], ev: readonly DivergenceEvent[], filter: 0 | 1 | -1, p: DivergenceParams, cost: number): Trade[] {
  const n = H.length;
  const out: Trade[] = [];
  let last = -1;
  for (const { idx: i, dir: d, p: pi } of ev) {
    if (filter !== 0 && d !== filter) continue;
    if (i + 1 > n - 1 || atr[i] <= 0 || i <= last) continue;
    const entry = O[i + 1];
    const sl = d > 0 ? L[pi] - p.slBuf * atr[i] : H[pi] + p.slBuf * atr[i];
    const risk = d * (entry - sl);
    if (risk <= 0 || risk > p.maxRisk * atr[i]) continue;
    const tp = entry + d * p.rr * risk;
    let res: Trade["result"] = 2;
    let ex = -1;
    let r = 0;
    const end = Math.min(n - 1, i + p.hold);
    for (let j = i + 1; j <= end; j++) {
      const slHit = d > 0 ? L[j] <= sl : H[j] >= sl;
      const tpHit = d > 0 ? H[j] >= tp : L[j] <= tp;
      if (slHit) {
        res = -1;
        ex = j;
        r = -1 - cost / risk;
        break;
      }
      if (tpHit) {
        res = 1;
        ex = j;
        r = p.rr - cost / risk;
        break;
      }
      if (j === i + p.hold) {
        res = 0;
        ex = j;
        r = (d * (C[j] - entry)) / risk - cost / risk;
        break;
      }
    }
    out.push({ idx: i, dir: d, entry, sl, tp, risk, exitIdx: ex, result: res, r });
    last = res === 2 ? n : ex;
  }
  return out;
}

export interface DivergenceBoard {
  recent: Array<DivergenceEvent & { swingTime: string; prevSwingTime: string; swingPrice: number; prevSwingPrice: number }>;
  /** A divergence confirmed on the last closed bar, with its plan (null when its stop would be too far). */
  live: { dir: 1 | -1; entry: number; stop: number; target: number } | { dir: 1 | -1; plan: null } | null;
  scores: { bullish: Score; bearish: Score; all: Score };
  eventsFound: number;
}

export function computeDivergenceBoard(bars: readonly Bar[], cost: number, p: DivergenceParams = DIVERGENCE_DEFAULTS, drawN = 10): DivergenceBoard {
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const n = bars.length;
  const atr = atrWilder(H, L, C);
  const rsi = rsiWilder(C);
  const ev = divergenceEvents(H, L, rsi, p);
  const scores = {
    bullish: scoreTrades(divergenceTrades(O, H, L, C, atr, ev, 1, p, cost)),
    bearish: scoreTrades(divergenceTrades(O, H, L, C, atr, ev, -1, p, cost)),
    all: scoreTrades(divergenceTrades(O, H, L, C, atr, ev, 0, p, cost)),
  };
  let live: DivergenceBoard["live"] = null;
  const lastEv = ev[ev.length - 1];
  if (lastEv && lastEv.idx === n - 1) {
    const entry = C[n - 1];
    const stop = lastEv.dir > 0 ? L[lastEv.p] - p.slBuf * atr[n - 1] : H[lastEv.p] + p.slBuf * atr[n - 1];
    const risk = lastEv.dir * (entry - stop);
    live = risk <= 0 || risk > p.maxRisk * atr[n - 1] ? { dir: lastEv.dir, plan: null } : { dir: lastEv.dir, entry, stop, target: entry + lastEv.dir * p.rr * risk };
  }
  const recent = ev.slice(-drawN).map((e) => ({
    ...e,
    swingTime: bars[e.p].time,
    prevSwingTime: bars[e.q].time,
    swingPrice: e.dir > 0 ? L[e.p] : H[e.p],
    prevSwingPrice: e.dir > 0 ? L[e.q] : H[e.q],
  }));
  return { recent, live, scores, eventsFound: ev.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Market overview row (Market Heatmap): daily bars, last bar = last CLOSED daily bar
// ---------------------------------------------------------------------------------------------------------------------
export type TrendKind = "up" | "down" | "range";

export interface OverviewRow {
  last: number;
  change1dPct: number;
  change5dPct: number;
  change21dPct: number;
  atrPct: number;
  /** Last closed daily move in ATRs of the day before. */
  moveAtr: number;
  trend: TrendKind;
  rsi: number;
  /** Position inside the 252-bar high/low range, 0-100. */
  rangePct: number;
  fromHighPct: number;
}

function emaSeries(C: number[], period: number): number[] {
  const a = 2 / (period + 1);
  const out = [C[0]];
  for (let i = 1; i < C.length; i++) out.push(a * C[i] + (1 - a) * out[out.length - 1]);
  return out;
}

export function computeOverviewRow(daily: readonly Bar[]): OverviewRow | null {
  const n = daily.length;
  if (n < 253) return null;
  const H = daily.map((b) => b.high);
  const L = daily.map((b) => b.low);
  const C = daily.map((b) => b.close);
  const e50 = emaSeries(C, 50);
  const e200 = emaSeries(C, 200);
  const atr = atrWilder(H, L, C);
  const rsi = rsiWilder(C);
  const i = n - 1;
  const hh = Math.max(...H.slice(i - 251, i + 1));
  const ll = Math.min(...L.slice(i - 251, i + 1));
  return {
    last: C[i],
    change1dPct: 100 * (C[i] / C[i - 1] - 1),
    change5dPct: 100 * (C[i] / C[i - 5] - 1),
    change21dPct: 100 * (C[i] / C[i - 21] - 1),
    atrPct: (100 * atr[i]) / C[i],
    moveAtr: (C[i] - C[i - 1]) / atr[i - 1],
    trend: C[i] > e50[i] && e50[i] > e200[i] ? "up" : C[i] < e50[i] && e50[i] < e200[i] ? "down" : "range",
    rsi: rsi[i],
    rangePct: (100 * (C[i] - ll)) / (hh - ll),
    fromHighPct: 100 * (C[i] / hh - 1),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Correlation shift: calendar-day alignment of two daily series, short and long window correlation, percentile of the short one
// ---------------------------------------------------------------------------------------------------------------------
export interface CorrelationRow {
  matchedDays: number;
  short: number;
  long: number;
  delta: number;
  /** Where today's short correlation sits among its own history, 0-100. */
  percentile: number;
}

function corr(x: number[], y: number[], from: number, len: number): number {
  const xs = x.slice(from, from + len);
  const ys = y.slice(from, from + len);
  const mx = xs.reduce((a, b) => a + b, 0) / len;
  const my = ys.reduce((a, b) => a + b, 0) / len;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < len; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function computeCorrelation(a: readonly Bar[], b: readonly Bar[], shortDays = 20, longDays = 120, historyDays = 750): CorrelationRow | null {
  const day = (t: string) => Math.floor(Date.parse(t) / 86_400_000);
  const da = new Map<number, number>();
  const db = new Map<number, number>();
  for (const x of a) da.set(day(x.time), x.close);
  for (const x of b) db.set(day(x.time), x.close);
  const days = [...da.keys()].filter((d) => db.has(d)).sort((p, q) => p - q);
  const ca = days.map((d) => da.get(d) as number);
  const cb = days.map((d) => db.get(d) as number);
  const m = days.length;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < m; i++) {
    ra.push(Math.log(ca[i] / ca[i - 1]));
    rb.push(Math.log(cb[i] / cb[i - 1]));
  }
  const nr = ra.length;
  if (nr < longDays + 1) return null;
  const cs = corr(ra, rb, nr - shortDays, shortDays);
  const cl = corr(ra, rb, nr - longDays, longDays);
  const h0 = Math.max(0, nr - historyDays);
  const vals: number[] = [];
  for (let e = h0 + shortDays; e <= nr; e++) vals.push(corr(ra, rb, e - shortDays, shortDays));
  const percentile = (100 * vals.filter((v) => v < cs - 1e-12).length) / vals.length;
  return { matchedDays: m, short: cs, long: cl, delta: cs - cl, percentile };
}

export type ShiftStatus = "normal" | "shifted_up" | "shifted_down" | "extreme";

/** Same rule as the MT5 monitor: shifted when the short and long correlation differ by at least `level`; otherwise extreme when the short value sits in the outer 5 % of its history. */
export function shiftStatus(row: CorrelationRow, level = 0.4): ShiftStatus {
  if (Math.abs(row.delta) >= level) return row.delta > 0 ? "shifted_up" : "shifted_down";
  if (row.percentile >= 95 || row.percentile <= 5) return "extreme";
  return "normal";
}
