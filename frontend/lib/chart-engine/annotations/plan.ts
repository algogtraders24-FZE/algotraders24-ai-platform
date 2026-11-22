// lib/chart-engine/annotations/plan.ts
// Trade-plan card for Professional Mode (policy: trade plans ARE allowed 2026-11-19, with evidence, risk and a
// MEASURED record; no promises, no invented numbers). Everything here is a pure function of the candle series.
//
// Plan rule ("structure retest"), the same rule is measured on the loaded history:
//   1. Bias = direction of the latest BOS / CHoCH.
//   2. Setup = an active order-block / OTE / FVG zone of that bias: price inside it = market entry; otherwise a limit entry at the
//      nearest zone on the retracement side (at most 3 ATR away). Stop = beyond the far edge of the zone by 0.25 ATR. Target = entry +/- 2 x risk.
//   4. Otherwise: "stand aside" with the reason stated.
// Score = number of confluences present (max 5): order block, OTE overlap, FVG overlap, price in discount (long) /
// premium (short), and a recent sweep in the same direction. It is a count of rules that agree, NOT a probability.
// Record = the same rule replayed bar by bar on the loaded candles (no look-ahead; stop first if both hit in one
// bar; open trades marked to market after MAX_HOLD bars): n, average R, share that reached the target first.

import type { ChartCandle } from "@/types/chart-data";
import { computeAnnotations } from "./compute";
import { ema } from "./readout";
import type { ZoneAnnotation } from "./types";

export const PLAN_RR = 2;
const MAX_HOLD = 48;
const STOP_BUFFER_ATR = 0.25;
const LOOKBACK = 120;
const STEP = 3;
const FILL_WINDOW = 24;

export interface PlanRecord {
  n: number;
  avgR: number;
  targetShare: number;
  bars: number;
  /** Standard error of avgR (std of the trade results / sqrt(n)). */
  se: number;
  /** The same rule replayed on shuffled copies of this chart (structure destroyed): what a rule with no real edge scores in this simulation. */
  baselineAvgR?: number;
  baselineN?: number;
}

export type TradePlan =
  | { state: "standAside"; reason: string }
  | {
      state: "plan";
      dir: "long" | "short";
      /** market = price is already inside the zone; limit = wait for price to retrace to the entry. */
      entryType: "market" | "limit";
      entry: number;
      stop: number;
      target: number;
      rr: number;
      score: number;
      scoreMax: number;
      confluences: string[];
      source: string;
      record: PlanRecord | null;
    };

type RawPlan = Exclude<TradePlan, { state: "standAside" }>;

/** A signal needs at least this many of the SCORE_MAX confluences; anything weaker is "no clean setup" (stand aside). */
export const PLAN_MIN_SCORE = 3;
export const PLAN_SCORE_MAX = 6;

export function planAt(candles: ChartCandle[], minScore: number = PLAN_MIN_SCORE): TradePlan {
  const res = computeAnnotations(candles);
  const atr = res.params.atr;
  if (!(atr > 0) || candles.length < 20) return { state: "standAside", reason: "Not enough candles to read structure." };
  const last = candles[candles.length - 1];
  const breaks = res.annotations.filter((a) => a.type === "structure").sort((a, b) => (a.type === "structure" && b.type === "structure" ? a.toTime - b.toTime : 0));
  const lastBreak = breaks[breaks.length - 1];
  let bias: "bullish" | "bearish";
  let biasText: string;
  if (lastBreak && lastBreak.type === "structure") {
    bias = lastBreak.bias;
    biasText = `latest ${lastBreak.kind} ${bias}`;
  } else {
    // no confirmed break in the loaded window: use price against its 50-bar average as a weaker bias
    const n = Math.min(50, candles.length);
    const avg = candles.slice(-n).reduce((sum, c) => sum + c.close, 0) / n;
    if (Math.abs(last.close - avg) < 0.25 * atr) return { state: "standAside", reason: "No confirmed structure break and price sits on its 50-bar average, so there is no bias." };
    bias = last.close > avg ? "bullish" : "bearish";
    biasText = `price ${bias === "bullish" ? "above" : "below"} its 50-bar average (no structure break yet)`;
  }
  const bull = bias === "bullish";
  const zones = res.annotations.filter((a): a is ZoneAnnotation => a.type === "zone" && a.endTime === null);
  const kinds = new Set(["orderBlock", "ote", "fvg", "breaker"]);
  const biasZones = zones.filter((z) => z.bias === bias && kinds.has(z.kind));
  const inside = biasZones.filter((z) => last.close >= z.low && last.close <= z.high);

  let entryType: "market" | "limit";
  let entry: number;
  let farEdge: number;
  let baseZones: ZoneAnnotation[];
  if (inside.length > 0) {
    entryType = "market";
    entry = last.close;
    baseZones = inside;
    farEdge = bull ? Math.min(...inside.map((z) => z.low)) : Math.max(...inside.map((z) => z.high));
  } else {
    // wait for a retest: a limit order at the nearest active zone on the retracement side of price
    const candidates = bull ? biasZones.filter((z) => z.high < last.close) : biasZones.filter((z) => z.low > last.close);
    if (candidates.length === 0) return { state: "standAside", reason: `Bias is ${bias} (${biasText}), but there is no active order block / OTE / FVG zone on the retracement side to enter from.` };
    const nearest = candidates.sort((x, y) => (bull ? y.high - x.high : x.low - y.low))[0];
    entryType = "limit";
    entry = bull ? nearest.high : nearest.low;
    if (Math.abs(last.close - entry) > 3 * atr) return { state: "standAside", reason: `Bias is ${bias} (${biasText}), but the nearest zone (${nearest.label}) is ${(Math.abs(last.close - entry) / atr).toFixed(1)} ATR away, too far to plan an entry.` };
    baseZones = biasZones.filter((z) => entry >= z.low - 1e-9 && entry <= z.high + 1e-9);
    farEdge = bull ? Math.min(...baseZones.map((z) => z.low)) : Math.max(...baseZones.map((z) => z.high));
  }
  const stop = bull ? farEdge - STOP_BUFFER_ATR * atr : farEdge + STOP_BUFFER_ATR * atr;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || risk > 4 * atr) return { state: "standAside", reason: "The zone is too wide for a sensible stop (more than 4 ATR)." };
  const target = bull ? entry + PLAN_RR * risk : entry - PLAN_RR * risk;

  const conf: string[] = [];
  if (baseZones.some((z) => z.kind === "orderBlock" || z.kind === "breaker")) conf.push(bull ? "Demand order block" : "Supply order block");
  if (zones.some((z) => z.kind === "ote" && z.bias === bias && entry >= z.low && entry <= z.high)) conf.push("Inside OTE (61.8-78.6 %)");
  if (baseZones.some((z) => z.kind === "fvg") || zones.some((z) => z.kind === "fvg" && z.bias === bias && entry >= z.low && entry <= z.high)) conf.push("Overlaps a fair value gap");
  const prem = zones.find((z) => z.kind === "premium"), disc = zones.find((z) => z.kind === "discount");
  if (bull && disc && entry <= disc.high) conf.push("Entry in discount");
  if (!bull && prem && entry >= prem.low) conf.push("Entry in premium");
  const recentSweep = res.annotations.some((a) => a.type === "marker" && a.bias === bias && a.time >= candles[Math.max(0, candles.length - 15)].time);
  if (recentSweep) conf.push("Liquidity sweep in the same direction");
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  if (e20 !== null && e50 !== null && (bull ? e20 > e50 : e20 < e50)) conf.push("EMA20 / EMA50 trend aligned");
  if (conf.length < minScore) {
    return { state: "standAside", reason: `Bias is ${bias} (${biasText}) but only ${conf.length} of ${PLAN_SCORE_MAX} confluences line up${conf.length > 0 ? ` (${conf.join(", ")})` : ""}; a signal needs at least ${minScore}. No clean entry right now.` };
  }

  const step = Math.pow(10, Math.floor(Math.log10(atr)) - 2); // price rounding derived from volatility (gold 0.1, EURUSD 0.000001)
  const rnd = (v: number) => Math.round(v / step) * step;
  return {
    state: "plan",
    dir: bull ? "long" : "short",
    entryType,
    entry: rnd(entry), stop: rnd(stop), target: rnd(target),
    rr: PLAN_RR,
    score: conf.length,
    scoreMax: PLAN_SCORE_MAX,
    confluences: conf,
    source: entryType === "market"
      ? `Structure retest rule: ${biasText}, price inside ${baseZones.map((z) => z.label).join(" + ")}`
      : `Structure retest rule: ${biasText}; limit entry at the nearest ${baseZones.map((z) => z.label).join(" + ")} (${(Math.abs(last.close - entry) / atr).toFixed(1)} ATR from price)`,
    record: null,
  };
}

/** Replays planAt() over history. A limit plan only counts if price actually reaches its entry within FILL_WINDOW bars. Deterministic; null when there are too few trades to say anything. */
export function measurePlanRecord(candles: ChartCandle[], minScore: number = PLAN_MIN_SCORE): PlanRecord | null {
  const total = candles.length;
  if (total < LOOKBACK + 60) return null;
  const rs: number[] = [];
  let hits = 0;
  let i = LOOKBACK;
  while (i < total - 2) {
    const window = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
    const p = planAt(window, minScore);
    if (p.state !== "plan") { i += STEP; continue; }
    const risk = Math.abs(p.entry - p.stop);
    const long = p.dir === "long";
    let start = i + 1; // first bar in which the trade is live
    if (p.entryType === "limit") {
      let filled = -1;
      for (let j = i + 1; j < Math.min(total, i + 1 + FILL_WINDOW); j++) {
        const c = candles[j];
        if (long ? c.low <= p.stop : c.high >= p.stop) break; // went through the stop zone without a fill: cancelled
        if (long ? c.low <= p.entry : c.high >= p.entry) { filled = j; break; }
      }
      if (filled < 0) { i += STEP; continue; }
      start = filled;
    }
    let r: number | null = null;
    let j = start;
    for (; j < Math.min(total, start + MAX_HOLD); j++) {
      const c = candles[j];
      const stopHit = long ? c.low <= p.stop : c.high >= p.stop;
      // on the bar a limit order fills, the order of high and low inside the bar is unknown: the target is only credited from the next bar (conservative)
      const tgtHit = !(p.entryType === "limit" && j === start) && (long ? c.high >= p.target : c.low <= p.target);
      if (stopHit) { r = -1; break; }
      if (tgtHit) { r = PLAN_RR; hits++; break; }
    }
    if (r === null) {
      const endIdx = Math.min(total - 1, start + MAX_HOLD);
      const exitPrice = candles[endIdx].close;
      r = ((long ? exitPrice - p.entry : p.entry - exitPrice) / risk);
      j = endIdx;
    }
    rs.push(r);
    i = j + 1; // one trade at a time
  }
  if (rs.length < 5) return null;
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const variance = rs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rs.length - 1);
  return { n: rs.length, avgR: mean, targetShare: hits / rs.length, bars: total, se: Math.sqrt(variance / rs.length) };
}

/** Same candle shapes (gap, body, wicks) in a seeded random order: keeps volatility and size, destroys all structure. xorshift32, seed fixed so results are repeatable. */
export function shuffledCopy(c: ChartCandle[], seed: number): ChartCandle[] {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const shapes = c.slice(1).map((k, i) => ({ gap: k.open - c[i].close, body: k.close - k.open, up: k.high - Math.max(k.open, k.close), dn: Math.min(k.open, k.close) - k.low }));
  for (let i = shapes.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shapes[i], shapes[j]] = [shapes[j], shapes[i]]; }
  const out: ChartCandle[] = [{ ...c[0] }];
  shapes.forEach((sh, i) => {
    const prev = out[out.length - 1];
    const open = prev.close + sh.gap;
    const close = open + sh.body;
    out.push({ time: c[i + 1].time, open, close, high: Math.max(open, close) + sh.up, low: Math.min(open, close) - sh.dn });
  });
  return out;
}

/** The record plus its luck baseline: the same rule on 3 shuffled copies of the chart. */
export function measureWithBaseline(candles: ChartCandle[]): PlanRecord | null {
  const rec = measurePlanRecord(candles);
  if (!rec) return null;
  let n = 0, sum = 0;
  for (const seed of [20261118, 20261119, 20261120]) {
    const b = measurePlanRecord(shuffledCopy(candles, seed));
    if (b) { n += b.n; sum += b.avgR * b.n; }
  }
  return n > 0 ? { ...rec, baselineAvgR: sum / n, baselineN: n } : rec;
}

/** Plan for the current chart, with the measured record attached (spread / commission NOT included). */
export function buildTradePlan(candles: ChartCandle[]): TradePlan {
  const p = planAt(candles);
  if (p.state !== "plan") return p;
  return { ...(p as RawPlan), record: measureWithBaseline(candles) };
}
