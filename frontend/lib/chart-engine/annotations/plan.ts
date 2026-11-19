// lib/chart-engine/annotations/plan.ts
// Trade-plan card for Professional Mode (policy: trade plans ARE allowed 2026-11-19, with evidence, risk and a
// MEASURED record; no promises, no invented numbers). Everything here is a pure function of the candle series.
//
// Plan rule ("structure retest"), the same rule is measured on the loaded history:
//   1. Bias = direction of the latest BOS / CHoCH.
//   2. Setup = the last close sits inside an active order-block / OTE zone of that bias (a retest).
//   3. Entry = last close. Stop = beyond the far edge of the zone by 0.25 ATR. Target = entry +/- 2 x risk.
//   4. Otherwise: "stand aside" with the reason stated.
// Score = number of confluences present (max 5): order block, OTE overlap, FVG overlap, price in discount (long) /
// premium (short), and a recent sweep in the same direction. It is a count of rules that agree, NOT a probability.
// Record = the same rule replayed bar by bar on the loaded candles (no look-ahead; stop first if both hit in one
// bar; open trades marked to market after MAX_HOLD bars): n, average R, share that reached the target first.

import type { ChartCandle } from "@/types/chart-data";
import { computeAnnotations } from "./compute";
import type { ZoneAnnotation } from "./types";

export const PLAN_RR = 2;
const MAX_HOLD = 48;
const STOP_BUFFER_ATR = 0.25;
const LOOKBACK = 120;
const STEP = 3;

export interface PlanRecord { n: number; avgR: number; targetShare: number; bars: number }

export type TradePlan =
  | { state: "standAside"; reason: string }
  | {
      state: "plan";
      dir: "long" | "short";
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

export function planAt(candles: ChartCandle[]): TradePlan {
  const res = computeAnnotations(candles);
  const atr = res.params.atr;
  if (!(atr > 0) || candles.length < 20) return { state: "standAside", reason: "Not enough candles to read structure." };
  const last = candles[candles.length - 1];
  const breaks = res.annotations.filter((a) => a.type === "structure").sort((a, b) => (a.type === "structure" && b.type === "structure" ? a.toTime - b.toTime : 0));
  const lastBreak = breaks[breaks.length - 1];
  if (!lastBreak || lastBreak.type !== "structure") return { state: "standAside", reason: "No confirmed structure break (BOS / CHoCH) yet, so there is no bias." };
  const bias = lastBreak.bias;
  const zones = res.annotations.filter((a): a is ZoneAnnotation => a.type === "zone" && a.endTime === null);
  const inside = (z: ZoneAnnotation) => last.close >= z.low && last.close <= z.high;
  const base = zones.filter((z) => z.bias === bias && (z.kind === "orderBlock" || z.kind === "ote") && inside(z));
  if (base.length === 0) return { state: "standAside", reason: `Bias is ${bias} (latest ${lastBreak.kind}), but price is not retesting an active order block / OTE zone. Waiting for a retest.` };

  const hasOb = base.some((z) => z.kind === "orderBlock");
  const farEdge = bias === "bullish" ? Math.min(...base.map((z) => z.low)) : Math.max(...base.map((z) => z.high));
  const entry = last.close;
  const stop = bias === "bullish" ? farEdge - STOP_BUFFER_ATR * atr : farEdge + STOP_BUFFER_ATR * atr;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || risk > 4 * atr) return { state: "standAside", reason: "The zone is too wide for a sensible stop (more than 4 ATR)." };
  const target = bias === "bullish" ? entry + PLAN_RR * risk : entry - PLAN_RR * risk;

  const conf: string[] = [];
  if (hasOb) conf.push(bias === "bullish" ? "Demand order block retest" : "Supply order block retest");
  if (base.some((z) => z.kind === "ote")) conf.push("Inside OTE (61.8-78.6 %)");
  if (zones.some((z) => z.kind === "fvg" && z.bias === bias && z.low <= last.high && z.high >= last.low)) conf.push("Overlaps a fair value gap");
  const prem = zones.find((z) => z.kind === "premium"), disc = zones.find((z) => z.kind === "discount");
  if (bias === "bullish" && disc && last.close <= disc.high) conf.push("Price in discount");
  if (bias === "bearish" && prem && last.close >= prem.low) conf.push("Price in premium");
  const recentSweep = res.annotations.some((a) => a.type === "marker" && a.bias === bias && a.time >= candles[Math.max(0, candles.length - 15)].time);
  if (recentSweep) conf.push("Liquidity sweep in the same direction");

  const step = Math.pow(10, Math.floor(Math.log10(atr)) - 2); // price rounding derived from volatility (gold 0.1, EURUSD 0.000001)
  const rnd = (v: number) => Math.round(v / step) * step;
  return {
    state: "plan",
    dir: bias === "bullish" ? "long" : "short",
    entry: rnd(entry), stop: rnd(stop), target: rnd(target),
    rr: PLAN_RR,
    score: conf.length,
    scoreMax: 5,
    confluences: conf,
    source: `Structure retest rule: latest ${lastBreak.kind} ${bias}, price inside ${base.map((z) => z.label).join(" + ")}`,
    record: null,
  };
}

/** Replays planAt() over history. Deterministic; returns null when there are too few trades to say anything. */
export function measurePlanRecord(candles: ChartCandle[]): PlanRecord | null {
  const total = candles.length;
  if (total < LOOKBACK + 60) return null;
  const rs: number[] = [];
  let hits = 0;
  let i = LOOKBACK;
  while (i < total - 2) {
    const window = candles.slice(Math.max(0, i - LOOKBACK + 1), i + 1);
    const p = planAt(window);
    if (p.state !== "plan") { i += STEP; continue; }
    const risk = Math.abs(p.entry - p.stop);
    let r: number | null = null;
    let j = i + 1;
    for (; j < Math.min(total, i + 1 + MAX_HOLD); j++) {
      const c = candles[j];
      const stopHit = p.dir === "long" ? c.low <= p.stop : c.high >= p.stop;
      const tgtHit = p.dir === "long" ? c.high >= p.target : c.low <= p.target;
      if (stopHit) { r = -1; break; }
      if (tgtHit) { r = PLAN_RR; hits++; break; }
    }
    if (r === null) {
      const exitPrice = candles[Math.min(total - 1, i + MAX_HOLD)].close;
      r = ((p.dir === "long" ? exitPrice - p.entry : p.entry - exitPrice) / risk);
      j = Math.min(total - 1, i + MAX_HOLD);
    }
    rs.push(r);
    i = j + 1; // one trade at a time
  }
  if (rs.length < 5) return null;
  return { n: rs.length, avgR: rs.reduce((a, b) => a + b, 0) / rs.length, targetShare: hits / rs.length, bars: total };
}


/** Plan for the current chart, with the measured record attached (spread / commission NOT included). */
export function buildTradePlan(candles: ChartCandle[]): TradePlan {
  const p = planAt(candles);
  if (p.state !== "plan") return p;
  return { ...(p as RawPlan), record: measurePlanRecord(candles) };
}
