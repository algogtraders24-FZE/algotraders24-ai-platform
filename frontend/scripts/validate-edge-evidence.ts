// scripts/validate-edge-evidence.ts
// AT24 Trader Edge Analyzer (E2): edge evidence (bootstrap CI + sign-flip
// permutation test + dependence cap) and the Monte-Carlo risk view.
// House style (node:assert/strict, tsx). Run: npm run validate:edge-evidence
// Optional real-file print (file never committed):
//   EDGE_REPORT_PATH="C:\path\Report.html" npm run validate:edge-evidence

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyEdge, computeEdgeEvidence, lag1Autocorrelation, overlapPercent, MIN_TRADES_FOR_EVIDENCE } from "../services/edge-analyzer/analysis/edge-evidence";
import { computeRuinAnalysis, MIN_TRADES_FOR_RUIN } from "../services/edge-analyzer/analysis/ruin";
import { mulberry32 } from "../services/edge-analyzer/analysis/rng";
import { analyzeMt5ReportBuffer } from "../services/edge-analyzer";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const MIN = 60_000;
function trade(i: number, net: number, over: Partial<ClosedTrade> = {}): ClosedTrade {
  const open = i * 10 * MIN;
  return {
    positionId: String(i), symbol: "X", direction: "buy", volume: 1, openTime: open, closeTime: open + MIN, openPrice: 1, closePrice: 1,
    stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: net, net, tag: "", ...over,
  };
}
/** Seeded normal(mean, sd) series (Box-Muller). */
function normalSeries(n: number, mean: number, sd: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  while (out.length < n) {
    const u1 = Math.max(rand(), 1e-12), u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(mean + sd * r * Math.cos(2 * Math.PI * u2));
    if (out.length < n) out.push(mean + sd * r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}
const series = (vals: number[]) => vals.map((v, i) => trade(i, Math.round(v * 100) / 100));

console.log("prng");
check("mulberry32: deterministic, in [0,1), roughly uniform", () => {
  const a = mulberry32(42), b = mulberry32(42);
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

console.log("decision table");
check("classifyEdge: levels, boundaries and the dependence cap", () => {
  const base = { n: 200, mean: 5, ciLo: 1, ciHi: 9, dependence: false };
  assert.equal(classifyEdge({ ...base, p: 0.001 }), "strong");
  assert.equal(classifyEdge({ ...base, p: 0.03 }), "moderate");
  assert.equal(classifyEdge({ ...base, ciLo: -1, p: 0.07 }), "weak");
  assert.equal(classifyEdge({ ...base, ciLo: -1, p: 0.4 }), "none");
  assert.equal(classifyEdge({ ...base, mean: -5, ciLo: -9, ciHi: -1, p: 0.01 }), "negative");
  assert.equal(classifyEdge({ ...base, mean: -5, ciLo: -9, ciHi: 2, p: 0.2 }), "none");
  assert.equal(classifyEdge({ ...base, n: MIN_TRADES_FOR_EVIDENCE - 1, p: 0.0001 }), "insufficient");
  assert.equal(classifyEdge({ ...base, p: 0.0001, dependence: true }), "weak");
  assert.equal(classifyEdge({ ...base, ciLo: -1, p: 0.07, dependence: true }), "weak");
  assert.equal(classifyEdge({ ...base, mean: 0, ciLo: -3, ciHi: 3, p: 0.9 }), "none");
});

console.log("edge evidence on data with a known answer");
check("fewer than 30 trades -> insufficient, however good the mean looks", () => {
  const e = computeEdgeEvidence(series(normalSeries(20, 50, 5, 3)));
  assert.equal(e.level, "insufficient");
  assert.match(e.headline, /too few/);
  assert.equal(e.perLot, null);
});
check("clear positive drift (mean 6, sd 10, n 400) -> strong, interval above zero, p tiny", () => {
  const e = computeEdgeEvidence(series(normalSeries(400, 6, 10, 11)), { currency: "USD" });
  assert.equal(e.level, "strong");
  assert.ok(e.ci95[0] > 0 && e.ci95[1] > e.ci95[0]);
  assert.ok(e.pValue < 0.01);
  assert.match(e.headline, /strong/);
  assert.match(e.headline, /USD/);
  assert.equal(e.dependenceFlag, false);
});
check("no drift (mean 0, sd 10, n 400) -> none, interval includes zero, headline says luck", () => {
  const e = computeEdgeEvidence(series(normalSeries(400, 0, 10, 5)));
  assert.equal(e.level, "none");
  assert.ok(e.ci95[0] < 0 && e.ci95[1] > 0);
  assert.match(e.headline, /luck/);
});
check("clear negative drift -> negative", () => {
  const e = computeEdgeEvidence(series(normalSeries(400, -6, 10, 13)));
  assert.equal(e.level, "negative");
  assert.ok(e.ci95[1] < 0);
});
check("interval brackets the sample mean and narrows as n grows", () => {
  const small = computeEdgeEvidence(series(normalSeries(100, 3, 10, 21)));
  const large = computeEdgeEvidence(series(normalSeries(1600, 3, 10, 21)));
  assert.ok(small.ci95[0] <= small.mean && small.mean <= small.ci95[1]);
  assert.ok(large.ci95[1] - large.ci95[0] < small.ci95[1] - small.ci95[0]);
});
check("tradesNeeded follows (1.96*sd/mean)^2; null when mean <= 0", () => {
  const e = computeEdgeEvidence(series(normalSeries(400, 6, 10, 11)));
  const expected = Math.ceil(((1.96 * e.sd) / e.mean) ** 2);
  assert.equal(e.tradesNeeded, expected);
  assert.equal(computeEdgeEvidence(series(normalSeries(400, -6, 10, 13))).tradesNeeded, null);
});
check("deterministic: same trades + seed -> identical result; a different seed changes the resampling", () => {
  const t = series(normalSeries(300, 2, 10, 7));
  assert.deepEqual(computeEdgeEvidence(t), computeEdgeEvidence(t));
  const a = computeEdgeEvidence(t, { seed: 1 });
  const b = computeEdgeEvidence(t, { seed: 2 });
  assert.equal(a.mean, b.mean);
  assert.notDeepEqual([a.ci95, a.pValue], [b.ci95, b.pValue]);
});
check("input order does not matter (uses close-time order internally)", () => {
  const t = series(normalSeries(200, 2, 10, 9));
  const shuffled = [...t].reverse();
  assert.deepEqual(computeEdgeEvidence(t), computeEdgeEvidence(shuffled));
});

console.log("dependence");
check("overlapPercent: none / all / partial", () => {
  assert.equal(overlapPercent(series([1, 2, 3, 4])), 0);
  const stacked = Array.from({ length: 10 }, (_, i) => trade(i, 1, { openTime: 0, closeTime: (i + 1) * MIN }));
  assert.equal(overlapPercent(stacked), 100);
  const half = [trade(0, 1, { openTime: 0, closeTime: 10 * MIN }), trade(1, 1, { openTime: 5 * MIN, closeTime: 12 * MIN }), trade(2, 1, { openTime: 100 * MIN, closeTime: 101 * MIN })];
  assert.equal(overlapPercent(half), 66.67);
});
check("lag1Autocorrelation: ~0 for noise, high for persistent runs, null if too short", () => {
  assert.ok(Math.abs(lag1Autocorrelation(normalSeries(2000, 0, 1, 4))!) < 0.08);
  const runs = Array.from({ length: 200 }, (_, i) => (Math.floor(i / 20) % 2 === 0 ? 5 : -5));
  assert.ok(lag1Autocorrelation(runs)! > 0.8);
  assert.equal(lag1Autocorrelation([1, 2]), null);
});
check("heavily overlapping trades: a would-be 'strong' result is capped at weak, with an explicit caveat", () => {
  const vals = normalSeries(400, 6, 10, 11).map((v) => Math.round(v * 100) / 100);
  const stacked = vals.map((v, i) => trade(i, v, { openTime: 0, closeTime: (i + 1) * MIN }));
  const e = computeEdgeEvidence(stacked);
  assert.equal(e.dependenceFlag, true);
  assert.equal(e.level, "weak");
  assert.match(e.caveats[0]!, /Dependence detected/);
  assert.match(e.headline, /limited because/);
});
check("per-lot sensitivity disagreeing with the headline is called out", () => {
  // Winners are tiny lots, losers are big lots: positive net per trade can mask a poor per-lot result or vice versa.
  const t = normalSeries(300, 6, 10, 31).map((v, i) => trade(i, Math.round(v * 100) / 100, { volume: i % 2 === 0 ? 0.1 : 5 }));
  const e = computeEdgeEvidence(t);
  assert.ok(e.perLot !== null);
  if (e.perLot && e.perLot.level !== e.level) assert.ok(e.caveats.some((c) => /position sizing/.test(c)));
});

console.log("risk of ruin (Monte Carlo)");
check("too few trades -> null", () => {
  assert.equal(computeRuinAnalysis(series(normalSeries(MIN_TRADES_FOR_RUIN - 1, 1, 1, 1)), 1000), null);
});
check("steady positive low-variance results: no 20% drawdown, 5th percentile finishes above start", () => {
  const r = computeRuinAnalysis(series(normalSeries(200, 10, 1, 2)), 10000)!;
  for (const s of r.scenarios) {
    assert.equal(s.probDrawdownReaches.find((x) => x.thresholdPct === 20)!.probability, 0);
    assert.ok(s.finalBalancePercentiles.p5 > 10000);
    assert.equal(s.probFinishBelowStart, 0);
  }
});
check("negative drift: almost always finishes below start; deep drawdowns likely", () => {
  const r = computeRuinAnalysis(series(normalSeries(200, -20, 10, 3)), 5000, { horizonTrades: 200 })!;
  for (const s of r.scenarios) {
    assert.ok(s.probFinishBelowStart > 0.95);
    assert.ok(s.probLoseHalfOfStart! > 0.5);
    assert.ok(s.medianMaxDrawdownPct > 30);
  }
});
check("streaky history: the streak-preserving scenario shows MORE drawdown risk than independent", () => {
  const runs = Array.from({ length: 240 }, (_, i) => (Math.floor(i / 10) % 2 === 0 ? 20 : -20));
  const r = computeRuinAnalysis(series(runs), 1000, { horizonTrades: 240 })!;
  const [ind, streak] = r.scenarios as [typeof r.scenarios[0], typeof r.scenarios[0]];
  assert.equal(ind.name, "independent");
  assert.equal(streak.name, "streak-preserving");
  assert.ok(streak.medianMaxDrawdownPct > ind.medianMaxDrawdownPct);
});
check("percentiles are ordered; probabilities within [0,1]; thresholds monotone", () => {
  const r = computeRuinAnalysis(series(normalSeries(300, 1, 15, 8)), 5000)!;
  for (const s of r.scenarios) {
    const p = s.finalBalancePercentiles;
    assert.ok(p.p5 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p95);
    const probs = s.probDrawdownReaches.map((x) => x.probability);
    for (const x of [...probs, s.probFinishBelowStart]) assert.ok(x >= 0 && x <= 1);
    assert.ok(probs[0]! >= probs[1]! && probs[1]! >= probs[2]!);
  }
});
check("deterministic for the same input+seed; start balance 0 -> no 'lose half' figure", () => {
  const t = series(normalSeries(150, 1, 10, 6));
  assert.deepEqual(computeRuinAnalysis(t, 3000), computeRuinAnalysis(t, 3000));
  const zero = computeRuinAnalysis(t, 0)!;
  assert.equal(zero.scenarios[0]!.probLoseHalfOfStart, null);
});
check("assumptions are disclosed with the numbers", () => {
  const r = computeRuinAnalysis(series(normalSeries(100, 1, 5, 1)), 1000)!;
  assert.ok(r.assumptions.some((a) => /not a forecast/i.test(a)));
  assert.ok(r.assumptions.some((a) => /compounding/i.test(a)));
});

const realPath = process.env.EDGE_REPORT_PATH;
if (realPath) {
  console.log(`real-file report (${realPath.split(/[\\/]/).pop()})`);
  check("REAL report: evidence + ruin computed, deterministic across two runs", () => {
    const buf = readFileSync(realPath);
    const a = analyzeMt5ReportBuffer(buf);
    const b = analyzeMt5ReportBuffer(buf);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.deepEqual(a.report.edge, b.report.edge);
    assert.deepEqual(a.report.ruin, b.report.ruin);
    const e = a.report.edge;
    console.log(`      level=${e.level} mean=${e.mean} ci95=[${e.ci95}] p=${e.pValue} needed=${e.tradesNeeded} overlap=${e.overlapPct}% acf=${e.lag1Autocorrelation} dependence=${e.dependenceFlag}`);
    console.log(`      headline: ${e.headline}`);
    if (e.perLot) console.log(`      per-lot: level=${e.perLot.level} mean=${e.perLot.mean} ci95=[${e.perLot.ci95}] p=${e.perLot.pValue}`);
    for (const s of a.report.ruin?.scenarios ?? []) {
      console.log(`      ${s.name}: DD>=20/30/50% = ${s.probDrawdownReaches.map((x) => x.probability).join(" / ")}, below start ${s.probFinishBelowStart}, lose half ${s.probLoseHalfOfStart}, median maxDD ${s.medianMaxDrawdownPct}%, final p5/p50/p95 ${s.finalBalancePercentiles.p5}/${s.finalBalancePercentiles.p50}/${s.finalBalancePercentiles.p95}`);
    }
  });
}

console.log(`\nvalidate-edge-evidence: ${passed} checks passed`);
