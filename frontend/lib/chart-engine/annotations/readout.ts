// lib/chart-engine/annotations/readout.ts
// The "Market analysis" paragraph of the Pro Chart: built only from numbers computed on the loaded candles (EMA 20 / 50, RSI 14, ATR,
// the structure map and the plan). Nothing is guessed and nothing is a prediction; every sentence states a measured fact.
import type { ChartCandle } from "@/types/chart-data";
import type { TradePlan } from "./plan";
import type { AnnotationResult } from "./types";

export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let v = closes.slice(0, period).reduce((a, b) => a + b, 0) / period; // seeded with the simple average of the first `period` closes
  for (let i = period; i < closes.length; i++) v = closes[i] * k + v * (1 - k);
  return v;
}

/** Wilder RSI. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export interface Readout {
  paragraph: string;
  facts: { ema20: number | null; ema50: number | null; rsi14: number | null; atr: number };
}

export function buildReadout(candles: ChartCandle[], analysis: AnalysisLike, plan: TradePlan | null, fmt: (n: number) => string): Readout | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), r = rsi(closes, 14);
  const atr = analysis.params.atr;
  const parts: string[] = [];

  // price against the averages
  if (e20 !== null && e50 !== null) {
    const rel20 = last >= e20 ? "above" : "below";
    const rel50 = last >= e50 ? "above" : "below";
    parts.push(`Price ${fmt(last)} is ${rel20} the EMA20 (${fmt(e20)}) and ${rel50} the EMA50 (${fmt(e50)}); the EMA20 is ${e20 >= e50 ? "above" : "below"} the EMA50.`);
  }
  // momentum
  if (r !== null) {
    const word = r >= 70 ? "overbought territory" : r <= 30 ? "oversold territory" : r >= 55 ? "firm momentum" : r <= 45 ? "weak momentum" : "neutral momentum";
    parts.push(`RSI(14) is ${r.toFixed(1)}, ${word}.`);
  }
  // structure
  const breaks = analysis.annotations.filter((a) => a.type === "structure").sort((a, b) => (a.type === "structure" && b.type === "structure" ? b.toTime - a.toTime : 0));
  const b = breaks[0];
  parts.push(b && b.type === "structure" ? `The latest structure break is a ${b.kind} ${b.bias} at ${fmt(b.price)}.` : "There is no confirmed structure break in the recent candles.");
  // levels
  const levels = analysis.annotations.flatMap((a) => (a.type === "level" ? [a] : []));
  const above = levels.filter((l) => l.price > last).sort((x, y) => x.price - y.price)[0];
  const below = levels.filter((l) => l.price < last).sort((x, y) => y.price - x.price)[0];
  if (above || below) parts.push(`Nearest mapped levels: ${above ? `resistance ${fmt(above.price)} (${above.touches} touches)` : "no resistance above"}, ${below ? `support ${fmt(below.price)} (${below.touches} touches)` : "no support below"}.`);
  // volatility
  parts.push(`ATR(14) is ${fmt(atr)}, ${((atr / last) * 100).toFixed(2)} % of price.`);
  // plan
  if (plan && plan.state === "plan") {
    const risk = Math.abs(plan.entry - plan.stop);
    parts.push(`The ${plan.dir} plan ${plan.entryType === "limit" ? "waits for a retrace to" : "enters at"} ${fmt(plan.entry)} with the stop at ${fmt(plan.stop)} (${(risk / atr).toFixed(1)} ATR) and the target at ${fmt(plan.target)} (${plan.rr} R).`);
  } else if (plan) {
    parts.push(`No plan: ${plan.reason}`);
  }
  return { paragraph: parts.join(" "), facts: { ema20: e20, ema50: e50, rsi14: r, atr } };
}

type AnalysisLike = Pick<AnnotationResult, "annotations" | "params">;
