// services/market-board/indicators-setups.ts
// AT24 Setup Pro for the Market Board: trend-pullback setups and squeeze-release setups, each with entry, stop and target levels drawn before the
// trade and a scorecard of how that setup type did on this chart's own history (R after cost, sign-flip luck test).
// Ported from the MetaTrader 5 build (AT24_Pullback_Core.mqh, AT24_Squeeze_Core.mqh, AT24_SP_Core.mqh); scripts/validate-market-board-more.ts replays the
// MT5 self-test file (events, setups, scores) through this file. Closed bars only. Descriptive, not a signal.
import { atrWilder, scoreTrades, type Bar, type Score, type Trade } from "./indicators";

export interface SetupParams {
  stopAtr: number;
  rr: number;
  hold: number;
}
export const SETUP_DEFAULTS: SetupParams = { stopAtr: 1.5, rr: 2.0, hold: 40 };

export interface SetupEvent {
  idx: number;
  dir: 1 | -1;
}

function emaOf(src: number[], period: number): number[] {
  const a = 2 / (period + 1);
  const out = new Array<number>(src.length);
  for (let i = 0; i < src.length; i++) out[i] = i === 0 ? src[0] : a * src[i] + (1 - a) * out[i - 1];
  return out;
}

/** +1 up (fast > mid > slow and the mid EMA rising), -1 down, 0 range or not enough data. */
export function trendState(ef: number[], em: number[], es: number[], atr: number[], slow = 200, slopeBars = 5, slopeMinAtr = 0.1): Array<1 | -1 | 0> {
  const n = ef.length;
  const out = new Array<1 | -1 | 0>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < slow + slopeBars) continue;
    const slope = em[i] - em[i - slopeBars];
    if (ef[i] > em[i] && em[i] > es[i] && slope > slopeMinAtr * atr[i]) out[i] = 1;
    else if (ef[i] < em[i] && em[i] < es[i] && -slope > slopeMinAtr * atr[i]) out[i] = -1;
  }
  return out;
}

/** Price came back to the fast EMA inside a trend (first touch after the trend started or after a gap). */
export function pullbackEvents(H: number[], L: number[], ef: number[], trend: Array<1 | -1 | 0>, swingBars = 20): SetupEvent[] {
  const n = H.length;
  const ev: SetupEvent[] = [];
  for (let i = swingBars + 1; i < n; i++) {
    const d = trend[i];
    if (d === 0) continue;
    const touch = d === 1 ? L[i] <= ef[i] && (L[i - 1] > ef[i - 1] || trend[i - 1] !== 1) : H[i] >= ef[i] && (H[i - 1] < ef[i - 1] || trend[i - 1] !== -1);
    if (touch) ev.push({ idx: i, dir: d });
  }
  return ev;
}

export interface SqueezeCalc {
  mid: number[];
  atr: number[];
  squeeze: Array<0 | 1>;
}

/** Bollinger bands inside the Keltner channel. */
export function squeezeCalc(H: number[], L: number[], C: number[], bbLen = 20, bbMult = 2.0, kcLen = 20, kcMult = 1.5, atrLen = 14): SqueezeCalc {
  const n = H.length;
  const atr = atrWilder(H, L, C, atrLen);
  const mid = new Array<number>(n).fill(0);
  const squeeze = new Array<0 | 1>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i + 1 < Math.max(bbLen, kcLen)) continue;
    let s = 0;
    for (let k = i - bbLen + 1; k <= i; k++) s += C[k];
    const ma = s / bbLen;
    let v = 0;
    for (let k = i - bbLen + 1; k <= i; k++) v += (C[k] - ma) * (C[k] - ma);
    const sd = Math.sqrt(v / bbLen);
    let s2 = 0;
    for (let k = i - kcLen + 1; k <= i; k++) s2 += C[k];
    const kma = s2 / kcLen;
    mid[i] = ma;
    squeeze[i] = ma + bbMult * sd < kma + kcMult * atr[i] && ma - bbMult * sd > kma - kcMult * atr[i] ? 1 : 0;
  }
  return { mid, atr, squeeze };
}

/** First bar after a squeeze of at least `minBars` bars; the direction is the close against the middle band. */
export function squeezeEvents(C: number[], calc: SqueezeCalc, minBars = 6): SetupEvent[] {
  const n = C.length;
  const ev: SetupEvent[] = [];
  let run = 0;
  for (let i = 1; i < n; i++) {
    if (calc.squeeze[i] === 1) {
      run += 1;
      continue;
    }
    if (run >= minBars && calc.squeeze[i - 1] === 1 && calc.atr[i] > 0) ev.push({ idx: i, dir: C[i] >= calc.mid[i] ? 1 : -1 });
    run = 0;
  }
  return ev;
}

/** One trade at a time: entry at the next open, stop at stopAtr x ATR of the signal bar, target rr x risk, timed exit; stop first if both are hit in one bar. */
export function simulateSetups(O: number[], H: number[], L: number[], C: number[], atr: number[], events: readonly SetupEvent[], p: SetupParams, cost: number): Trade[] {
  const n = H.length;
  const out: Trade[] = [];
  let last = -1;
  for (const { idx: i, dir: d } of events) {
    if (i < 1 || i + 1 > n - 1 || atr[i] <= 0 || i <= last) continue;
    const entry = O[i + 1];
    const risk = p.stopAtr * atr[i];
    const sl = entry - d * risk;
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

export interface SetupBoard {
  /** A setup whose signal bar is the last closed bar: entry shown at the last close, stop and target from the ATR of that bar. */
  live: { type: "pullback" | "squeeze"; dir: 1 | -1; entry: number; stop: number; target: number } | null;
  recent: Array<{ type: "pullback" | "squeeze"; dir: 1 | -1; entryTime: string; exitTime: string | null; entry: number; stop: number; target: number; result: Trade["result"] }>;
  scores: { pullback: Score; squeeze: Score };
  counts: { pullback: number; squeeze: number };
}

export function computeSetupBoard(bars: readonly Bar[], cost: number, p: SetupParams = SETUP_DEFAULTS, drawN = 10): SetupBoard {
  const O = bars.map((b) => b.open);
  const H = bars.map((b) => b.high);
  const L = bars.map((b) => b.low);
  const C = bars.map((b) => b.close);
  const n = bars.length;
  const atr = atrWilder(H, L, C);
  const ef = emaOf(C, 20);
  const em = emaOf(C, 50);
  const es = emaOf(C, 200);
  const pullEv = pullbackEvents(H, L, ef, trendState(ef, em, es, atr));
  const sq = squeezeCalc(H, L, C);
  const sqEv = squeezeEvents(C, sq);
  const pullTrades = simulateSetups(O, H, L, C, atr, pullEv, p, cost);
  const sqTrades = simulateSetups(O, H, L, C, sq.atr, sqEv, p, cost);

  let live: SetupBoard["live"] = null;
  const lastPull = pullEv[pullEv.length - 1];
  const lastSq = sqEv[sqEv.length - 1];
  const make = (type: "pullback" | "squeeze", ev: SetupEvent, a: number): NonNullable<SetupBoard["live"]> => {
    const entry = C[n - 1];
    const risk = p.stopAtr * a;
    return { type, dir: ev.dir, entry, stop: entry - ev.dir * risk, target: entry + ev.dir * p.rr * risk };
  };
  if (lastPull && lastPull.idx === n - 1) live = make("pullback", lastPull, atr[n - 1]);
  else if (lastSq && lastSq.idx === n - 1) live = make("squeeze", lastSq, sq.atr[n - 1]);

  const tag = (type: "pullback" | "squeeze", t: Trade) => ({
    type,
    dir: t.dir,
    entryTime: bars[t.idx + 1].time,
    exitTime: t.exitIdx >= 0 ? bars[t.exitIdx].time : null,
    entry: t.entry,
    stop: t.sl,
    target: t.tp,
    result: t.result,
    at: t.idx,
  });
  const recent = [...pullTrades.map((t) => tag("pullback", t)), ...sqTrades.map((t) => tag("squeeze", t))]
    .sort((a, b) => a.at - b.at)
    .slice(-drawN)
    .map((x) => ({ type: x.type, dir: x.dir, entryTime: x.entryTime, exitTime: x.exitTime, entry: x.entry, stop: x.stop, target: x.target, result: x.result }));
  return { live, recent, scores: { pullback: scoreTrades(pullTrades), squeeze: scoreTrades(sqTrades) }, counts: { pullback: pullTrades.length, squeeze: sqTrades.length } };
}
