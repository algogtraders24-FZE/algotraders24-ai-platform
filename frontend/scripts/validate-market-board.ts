// scripts/validate-market-board.ts
// Replays the MetaTrader 5 self-test files (ea-research/indicators/*/test/*_selftest.csv) through services/market-board/indicators.ts and
// compares every zone, divergence event, trade, score, heatmap field and correlation value with what the MT5 builds produced.
// Run via `npm run validate:market-board`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  ZONE_DEFAULTS, DIVERGENCE_DEFAULTS, atrWilder, rsiWilder, detectZones, zoneTrades, divergenceEvents, divergenceTrades, scoreTrades,
  computeOverviewRow, computeCorrelation, shiftStatus, verdictOf, type Bar,
} from "../services/market-board/indicators";

const ROOT = path.resolve(__dirname, "..", "..", "ea-research", "indicators");
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : String(err));
  }
}

function rowsOf(file: string): string[][] | null {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) {
    skipped += 1;
    console.log(`  skip - ${file} not found`);
    return null;
  }
  return readFileSync(p, "utf-8").split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(","));
}

const close = (a: number, b: number, tol = 1e-4) => Math.abs(a - b) < tol * Math.max(1, Math.abs(a));

function arrays(rows: string[][]) {
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 5).map(Number));
  return { O: bars.map((b) => b[0]), H: bars.map((b) => b[1]), L: bars.map((b) => b[2]), C: bars.map((b) => b[3]) };
}

function asBars(a: { O: number[]; H: number[]; L: number[]; C: number[] }): Bar[] {
  return a.C.map((c, i) => ({ time: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(), open: a.O[i], high: a.H[i], low: a.L[i], close: c, volume: 0 }));
}

function checkScore(label: string, mine: ReturnType<typeof scoreTrades>, ref: string[]) {
  const theirs = ref.slice(2).map(Number); // n, wins, hit, avgR, sumR, t, pFlip, open
  const m = [mine.n, mine.wins, mine.hitPct, mine.avgR, mine.sumR, mine.t, mine.pFlip, mine.open];
  m.forEach((v, i) => assert.ok(close(v, theirs[i]), `${label}: field ${i} mine ${v} vs MT5 ${theirs[i]}`));
}

function checkTrades(t: ReturnType<typeof zoneTrades>, ref: string[][]) {
  assert.equal(t.length, ref.length);
  t.forEach((x, i) => {
    const r = ref[i];
    assert.equal(x.idx, +r[2]);
    assert.equal(x.dir, +r[3]);
    assert.ok(close(x.entry, +r[4]) && close(x.sl, +r[5]) && close(x.tp, +r[6]) && close(x.risk, +r[7]), `trade ${i} levels`);
    assert.equal(x.exitIdx, +r[8]);
    assert.equal(x.result, +r[9]);
    assert.ok(close(x.r, +r[10]), `trade ${i} R`);
  });
}

function zoneParity() {
  const rows = rowsOf("AT24_Zone_Pro/test/ZN_selftest.csv");
  if (!rows) return;
  const m = rows.find((r) => r[0] === "meta") as string[];
  const p = { ...ZONE_DEFAULTS, impK: +m[2], baseMax: +m[3], maxBase: +m[4], maxH: +m[5], slBuf: +m[6], rr: +m[7], hold: +m[8], maxAge: +m[9] };
  const cost = +m[10];
  const { O, H, L, C } = arrays(rows);
  const zones = detectZones(O, H, L, C, atrWilder(H, L, C), p);
  const refZ = rows.filter((r) => r[0] === "zone");
  test(`zones identical to MT5 (${zones.length})`, () => {
    assert.equal(zones.length, refZ.length);
    zones.forEach((z, i) => {
      const r = refZ[i];
      assert.equal(z.idx, +r[1]);
      assert.equal(z.dir, +r[2]);
      assert.ok(close(z.top, +r[3], 1e-3) && close(z.bottom, +r[4], 1e-3));
      assert.equal(z.touch, +r[6]);
    });
  });
  for (const filt of [0, 1, -1] as const) {
    const t = zoneTrades(O, H, L, C, zones, filt, p, cost);
    const ref = rows.filter((r) => r[0] === "trade" && +r[1] === filt);
    test(`zone trades filter ${filt} identical (${t.length})`, () => checkTrades(t, ref));
    const sc = rows.find((r) => r[0] === "score" && +r[1] === filt) as string[];
    test(`zone score filter ${filt} identical`, () => checkScore(`zone ${filt}`, scoreTrades(t), sc));
  }
}

function divergenceParity() {
  const rows = rowsOf("AT24_Divergence_Pro/test/DV_selftest.csv");
  if (!rows) return;
  const m = rows.find((r) => r[0] === "meta") as string[];
  const p = { ...DIVERGENCE_DEFAULTS, k: +m[2], minSep: +m[3], maxSep: +m[4], minDiff: +m[5], slBuf: +m[6], maxRisk: +m[7], rr: +m[8], hold: +m[9] };
  const cost = +m[10];
  const { O, H, L, C } = arrays(rows);
  const atr = atrWilder(H, L, C);
  const rsi = rsiWilder(C);
  test("RSI samples identical to MT5", () => rows.filter((r) => r[0] === "rsi").forEach((r) => assert.ok(Math.abs(rsi[+r[1]] - +r[2]) < 1e-4)));
  const ev = divergenceEvents(H, L, rsi, p);
  const refE = rows.filter((r) => r[0] === "ev");
  test(`divergence events identical (${ev.length})`, () => {
    assert.equal(ev.length, refE.length);
    ev.forEach((e, i) => assert.deepEqual([e.idx, e.dir, e.p, e.q], refE[i].slice(1).map(Number)));
  });
  for (const filt of [0, 1, -1] as const) {
    const t = divergenceTrades(O, H, L, C, atr, ev, filt, p, cost);
    const ref = rows.filter((r) => r[0] === "trade" && +r[1] === filt);
    test(`divergence trades filter ${filt} identical (${t.length})`, () => checkTrades(t, ref));
    const sc = rows.find((r) => r[0] === "score" && +r[1] === filt) as string[];
    test(`divergence score filter ${filt} identical`, () => checkScore(`div ${filt}`, scoreTrades(t), sc));
  }
}

function heatmapParity() {
  for (const f of ["HM_selftest_0.csv", "HM_selftest_1.csv"]) {
    const rows = rowsOf(`AT24_Market_Heatmap/test/${f}`);
    if (!rows) continue;
    const row = computeOverviewRow(asBars(arrays(rows)));
    const ref = (rows.find((r) => r[0] === "row") as string[]).slice(1).map(Number);
    test(`overview row identical to MT5 (${f})`, () => {
      assert.ok(row);
      const r = row as NonNullable<typeof row>;
      const trend = r.trend === "up" ? 1 : r.trend === "down" ? -1 : 0;
      const mine = [1, r.last, r.change1dPct, r.change5dPct, r.change21dPct, r.atrPct, r.moveAtr, trend, r.rsi, r.rangePct, r.fromHighPct];
      mine.forEach((v, i) => assert.ok(close(v, ref[i]), `field ${i}: mine ${v} vs MT5 ${ref[i]}`));
    });
  }
}

function correlationParity() {
  const rows = rowsOf("AT24_Correlation_Shift/test/CS_selftest.csv");
  if (!rows) return;
  const toBars = (tag: string): Bar[] => rows.filter((r) => r[0] === tag).map((r) => ({ time: new Date(+r[1] * 1000).toISOString(), open: +r[2], high: +r[2], low: +r[2], close: +r[2], volume: 0 }));
  const a = toBars("a");
  const b = toBars("b");
  const c = computeCorrelation(a, b, 20, 120, 750);
  const ref = rows.find((r) => r[0] === "row") as string[];
  test("correlation row identical to MT5", () => {
    assert.ok(c);
    const x = c as NonNullable<typeof c>;
    assert.equal(x.matchedDays, +ref[1]);
    assert.ok(Math.abs(x.short - +ref[4]) < 1e-6 && Math.abs(x.long - +ref[5]) < 1e-6 && Math.abs(x.delta - +ref[6]) < 1e-6 && Math.abs(x.percentile - +ref[7]) < 1e-4);
  });
  test("known answer: a series against itself has correlation 1", () => {
    const s = computeCorrelation(a, a, 20, 120, 750);
    assert.ok(s && Math.abs(s.short - 1) < 1e-9 && Math.abs(s.delta) < 1e-9);
  });
}

function smallChecks() {
  test("verdict rules: too few under 30, positive only beyond luck, negative only beyond luck, else no edge", () => {
    assert.equal(verdictOf(29, 1, 0.001), "too_few");
    assert.equal(verdictOf(40, 0.2, 0.01), "positive");
    assert.equal(verdictOf(40, -0.2, 0.99), "negative");
    assert.equal(verdictOf(40, 0.2, 0.3), "no_edge");
  });
  test("shift status follows the MT5 rule", () => {
    const base = { matchedDays: 500, short: 0, long: 0, percentile: 50 };
    assert.equal(shiftStatus({ ...base, delta: 0.45 }), "shifted_up");
    assert.equal(shiftStatus({ ...base, delta: -0.45 }), "shifted_down");
    assert.equal(shiftStatus({ ...base, delta: 0.1, percentile: 97 }), "extreme");
    assert.equal(shiftStatus({ ...base, delta: 0.1 }), "normal");
  });
}

console.log("Market Board maths vs the MetaTrader 5 builds");
zoneParity();
divergenceParity();
heatmapParity();
correlationParity();
smallChecks();
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
if (failed > 0) process.exit(1);
