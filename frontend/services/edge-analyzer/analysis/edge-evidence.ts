// services/edge-analyzer/analysis/edge-evidence.ts
// AT24 Trader Edge Analyzer (E2) - "is this result distinguishable from luck?"
//
// Deterministic (seeded), no LLM. Two independent tools on the per-trade net
// results:
//   1. a percentile BOOTSTRAP 95% interval for the mean (expectancy);
//   2. a SIGN-FLIP PERMUTATION test of "true mean = 0" (two-sided p-value).
// The output is an evidence LEVEL, never a promise and never "validated".
//
// Honest limits, built into the output:
//   - both tools assume trades are roughly independent. Real accounts often hold
//     overlapping positions and size up after losses; we MEASURE overlap and lag-1
//     autocorrelation and, if dependence is material, positive evidence is
//     capped at "weak" (we refuse to make strong claims on correlated trades);
//   - fewer than 30 trades is "insufficient", whatever the mean looks like;
//   - the same test is repeated on result-per-lot as a sensitivity check.

import type { ClosedTrade } from "../types";
import { sortByCloseTime } from "./core";
import { DEFAULT_SEED, mulberry32, percentile } from "./rng";

export type EdgeLevel = "insufficient" | "negative" | "none" | "weak" | "moderate" | "strong";

export const MIN_TRADES_FOR_EVIDENCE = 30;
export const OVERLAP_DEPENDENCE_PCT = 30;
export const AUTOCORR_DEPENDENCE = 0.15;

export interface SampleEvidence {
  level: EdgeLevel;
  n: number;
  mean: number;
  sd: number;
  /** mean / (sd / sqrt(n)); descriptive only. */
  tStat: number | null;
  ci95: [number, number];
  /** Two-sided sign-flip permutation p-value for "mean = 0". */
  pValue: number;
  /** Rough number of trades needed for a 95% interval to exclude zero at the current mean/variance (null if mean <= 0). */
  tradesNeeded: number | null;
}

export interface EdgeEvidence extends SampleEvidence {
  /** Plain-language one-sentence result, templated from the numbers (no LLM). */
  headline: string;
  lag1Autocorrelation: number | null;
  /** % of trades that overlap in time with at least one other trade. */
  overlapPct: number;
  dependenceFlag: boolean;
  /** Same test on net-per-lot; agreement raises confidence, disagreement is a warning. */
  perLot: SampleEvidence | null;
  caveats: string[];
  seed: number;
  resamples: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function meanOf(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return x.length ? s / x.length : 0;
}

function sdOf(x: ArrayLike<number>, mean: number): number {
  if (x.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i]! - mean) ** 2;
  return Math.sqrt(s / (x.length - 1));
}

export function resamplesFor(n: number): number {
  return Math.min(5000, Math.max(1000, Math.floor(2e7 / Math.max(1, n))));
}

/** Pure decision table (exported for direct testing). */
export function classifyEdge(input: { n: number; mean: number; ciLo: number; ciHi: number; p: number; dependence: boolean }): EdgeLevel {
  if (input.n < MIN_TRADES_FOR_EVIDENCE) return "insufficient";
  if (input.ciHi < 0 && input.p < 0.05) return "negative";
  if (input.mean <= 0) return "none";
  let level: EdgeLevel;
  if (input.ciLo > 0 && input.p < 0.01) level = "strong";
  else if (input.ciLo > 0 && input.p < 0.05) level = "moderate";
  else if (input.p < 0.1) level = "weak";
  else level = "none";
  if (input.dependence && (level === "strong" || level === "moderate")) level = "weak";
  return level;
}

export function evidenceForSample(x: Float64Array, seed: number, dependence: boolean): SampleEvidence {
  const n = x.length;
  const mean = meanOf(x);
  const sd = sdOf(x, mean);
  const B = resamplesFor(n);
  const rand = mulberry32(seed);

  // Percentile bootstrap of the mean.
  const means = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[(rand() * n) | 0]!;
    means[b] = s / n;
  }
  means.sort();
  const lo = percentile(means, 2.5);
  const hi = percentile(means, 97.5);

  // Sign-flip permutation test of mean = 0 (two-sided).
  const abs = new Float64Array(n);
  for (let i = 0; i < n; i++) abs[i] = Math.abs(x[i]!);
  let extreme = 0;
  const target = Math.abs(mean) - 1e-12;
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? -abs[i]! : abs[i]!;
    if (Math.abs(s / n) >= target) extreme += 1;
  }
  const p = (extreme + 1) / (B + 1);

  const se = n > 0 ? sd / Math.sqrt(n) : 0;
  return {
    level: classifyEdge({ n, mean, ciLo: lo, ciHi: hi, p, dependence }),
    n,
    mean: r2(mean),
    sd: r2(sd),
    tStat: se > 0 ? r2(mean / se) : null,
    ci95: [r2(lo), r2(hi)],
    pValue: r4(p),
    tradesNeeded: mean > 0 && sd > 0 ? Math.ceil(((1.96 * sd) / mean) ** 2) : null,
  };
}

/** Fraction (%) of trades that overlap in time with at least one other trade. */
export function overlapPercent(trades: readonly ClosedTrade[]): number {
  if (trades.length < 2) return 0;
  const byOpen = [...trades].sort((a, b) => a.openTime - b.openTime);
  const overlapped = new Uint8Array(byOpen.length);
  let maxClose = -Infinity;
  let maxCloseIdx = -1;
  for (let i = 0; i < byOpen.length; i++) {
    const t = byOpen[i]!;
    if (t.openTime < maxClose) {
      overlapped[i] = 1;
      if (maxCloseIdx >= 0) overlapped[maxCloseIdx] = 1;
    }
    if (t.closeTime > maxClose) {
      maxClose = t.closeTime;
      maxCloseIdx = i;
    }
  }
  let c = 0;
  for (let i = 0; i < overlapped.length; i++) c += overlapped[i]!;
  return r2((c / byOpen.length) * 100);
}

export function lag1Autocorrelation(x: ArrayLike<number>): number | null {
  const n = x.length;
  if (n < 3) return null;
  const m = meanOf(x);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (x[i]! - m) ** 2;
    if (i > 0) num += (x[i]! - m) * (x[i - 1]! - m);
  }
  return den > 0 ? r4(num / den) : null;
}

function money(n: number, currency: string | null): string {
  const s = `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}`;
  return currency ? `${s} ${currency}` : s;
}

function headlineFor(e: SampleEvidence, dependenceFlag: boolean, currency: string | null): string {
  const range = `${money(e.ci95[0], currency)} to ${money(e.ci95[1], currency)}`;
  switch (e.level) {
    case "insufficient":
      return `Only ${e.n} closed trades: too few to say anything reliable about edge (at least ${MIN_TRADES_FOR_EVIDENCE} are needed, and more is better).`;
    case "negative":
      return `Average result per trade is ${money(e.mean, currency)}. The data points to a negative edge: the 95% range (${range}) stays below zero.`;
    case "none":
      return `Average result per trade is ${money(e.mean, currency)}, but with ${e.n} trades the 95% range (${range}) includes zero, so this cannot be told apart from luck.`;
    default:
      return `Average result per trade is ${money(e.mean, currency)} (95% range ${range}). Evidence of a positive edge is ${e.level}${dependenceFlag ? ", limited because many trades overlap or depend on each other" : ""}.`;
  }
}

export function computeEdgeEvidence(trades: readonly ClosedTrade[], opts: { seed?: number; currency?: string | null } = {}): EdgeEvidence {
  const seed = opts.seed ?? DEFAULT_SEED;
  const ordered = sortByCloseTime(trades);
  const nets = Float64Array.from(ordered, (t) => t.net);
  const overlapPct = overlapPercent(ordered);
  const acf = lag1Autocorrelation(nets);
  const dependenceFlag = overlapPct >= OVERLAP_DEPENDENCE_PCT || (acf !== null && Math.abs(acf) >= AUTOCORR_DEPENDENCE);

  const primary = evidenceForSample(nets, seed, dependenceFlag);
  const perLotSample = Float64Array.from(ordered, (t) => (t.volume > 0 ? t.net / t.volume : 0));
  const perLot = nets.length >= MIN_TRADES_FOR_EVIDENCE ? evidenceForSample(perLotSample, seed + 1, dependenceFlag) : null;

  const caveats: string[] = [
    "Assumes trades are roughly independent. Real accounts often overlap positions or change size after losses, which makes results look more certain than they are.",
    "Describes the past only. It does not predict future results and is not investment advice.",
  ];
  if (dependenceFlag) {
    caveats.unshift(
      `Dependence detected (${overlapPct}% of trades overlap in time${acf !== null ? `, lag-1 autocorrelation ${acf}` : ""}). Positive evidence is capped at "weak" because the independence assumption does not hold.`,
    );
  }
  if (perLot && perLot.level !== primary.level) {
    caveats.push(`Result per lot gives a different reading ("${perLot.level}" vs "${primary.level}"): position sizing is influencing the outcome.`);
  }
  return {
    ...primary,
    headline: headlineFor(primary, dependenceFlag, opts.currency ?? null),
    lag1Autocorrelation: acf,
    overlapPct,
    dependenceFlag,
    perLot,
    caveats,
    seed,
    resamples: resamplesFor(nets.length),
  };
}
