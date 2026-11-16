// scripts/validate-market-board-more.ts
// Replays the MetaTrader 5 self-test files of Absorption Map, FVG Zones, Order Block Lab and Volume Profile Levels through
// services/market-board/indicators-more.ts and compares every zone, gap, block, trade, score and statistic with the MT5 builds.
// Run via `npm run validate:market-board-more`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { atrWilder, scoreTrades, zoneTrades, ZONE_DEFAULTS } from "../services/market-board/indicators";
import {
  ABSORPTION_DEFAULTS, FVG_DEFAULTS, OB_DEFAULTS, VP_DEFAULTS, detectAbsorptionZones, detectGaps, fvgStats, detectOrderBlocks, obStats, buildVpDays, vpStudy,
} from "../services/market-board/indicators-more";
import { structureEvents, structureStats, STRUCTURE_DEFAULTS, buildErDays, erStats } from "../services/market-board/indicators-structure";
import { trendState, pullbackEvents, squeezeCalc, squeezeEvents, simulateSetups, SETUP_DEFAULTS } from "../services/market-board/indicators-setups";

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

function absorptionParity() {
  const rows = rowsOf("AT24_Absorption_Map/test/AB_selftest.csv");
  if (!rows) return;
  const m = rows.find((r) => r[0] === "meta") as string[];
  const p = { ...ABSORPTION_DEFAULTS, volK: +m[2], volN: +m[3], maxRange: +m[4], look: +m[5], moveAtr: +m[6], slBuf: +m[7], rr: +m[8], hold: +m[9], maxAge: +m[10] };
  const cost = +m[11];
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 6).map(Number));
  const O = bars.map((b) => b[0]);
  const H = bars.map((b) => b[1]);
  const L = bars.map((b) => b[2]);
  const C = bars.map((b) => b[3]);
  const TV = bars.map((b) => b[4]);
  const zones = detectAbsorptionZones(H, L, C, TV, atrWilder(H, L, C), p);
  const refZ = rows.filter((r) => r[0] === "zone");
  test(`absorption zones identical to MT5 (${zones.length})`, () => {
    assert.equal(zones.length, refZ.length);
    zones.forEach((z, i) => {
      const r = refZ[i];
      assert.equal(z.idx, +r[1]);
      assert.equal(z.dir, +r[2]);
      assert.ok(close(z.top, +r[3], 1e-3) && close(z.bottom, +r[4], 1e-3) && close(z.atr, +r[5]));
      assert.equal(z.touch, +r[6]);
    });
  });
  const zp = { ...ZONE_DEFAULTS, slBuf: p.slBuf, rr: p.rr, hold: p.hold, maxAge: p.maxAge };
  for (const filt of [0, 1, -1] as const) {
    const t = zoneTrades(O, H, L, C, zones, filt, zp, cost);
    const ref = rows.filter((r) => r[0] === "trade" && +r[1] === filt);
    test(`absorption trades filter ${filt} identical (${t.length})`, () => {
      assert.equal(t.length, ref.length);
      t.forEach((x, i) => {
        const r = ref[i];
        assert.equal(x.idx, +r[2]);
        assert.equal(x.dir, +r[3]);
        assert.ok(close(x.entry, +r[4]) && close(x.sl, +r[5]) && close(x.tp, +r[6]) && close(x.risk, +r[7]));
        assert.equal(x.exitIdx, +r[8]);
        assert.equal(x.result, +r[9]);
        assert.ok(close(x.r, +r[10]));
      });
    });
    const sc = rows.find((r) => r[0] === "score" && +r[1] === filt) as string[];
    test(`absorption score filter ${filt} identical`, () => {
      const s = scoreTrades(t);
      const theirs = sc.slice(2).map(Number);
      [s.n, s.wins, s.hitPct, s.avgR, s.sumR, s.t, s.pFlip, s.open].forEach((v, i) => assert.ok(close(v, theirs[i]), `field ${i}: mine ${v} vs MT5 ${theirs[i]}`));
    });
  }
}

function fvgParity() {
  const rows = rowsOf("AT24_FVG_Zones/test/FVG_selftest.csv");
  if (!rows) return;
  const bars = rows.filter((r) => r[0] === "bar");
  const H = bars.map((r) => +r[2]);
  const L = bars.map((r) => +r[3]);
  const C = bars.map((r) => +r[4]);
  const gaps = detectGaps(H, L, C, FVG_DEFAULTS);
  const ref = rows.filter((r) => r[0] === "gap");
  test(`FVG gaps identical to MT5 (${gaps.length})`, () => {
    assert.equal(gaps.length, ref.length);
    gaps.forEach((g, i) => {
      const r = ref[i];
      assert.equal(g.idx, +r[1]);
      assert.equal(g.dir, +r[2]);
      assert.ok(Math.abs(g.top - +r[3]) < 6e-4 && Math.abs(g.bottom - +r[4]) < 6e-4);
      assert.equal(g.touch, +r[5]);
      assert.equal(g.fill, +r[6]);
    });
  });
  test("FVG statistics identical to MT5", () => {
    const s = fvgStats(H, L, C, gaps, FVG_DEFAULTS);
    assert.ok(s);
    const x = s as NonNullable<typeof s>;
    const mt = (rows.find((r) => r[0] === "stats") as string[]).slice(1).map(Number);
    [x.measured, x.touchedPct, x.filledPct, x.medianWaitBars, x.controlPct, x.reactedPct, x.touchedN].forEach((v, i) => assert.ok(Math.abs(v - mt[i]) <= 1.1e-3, `stat ${i}: mine ${v} vs MT5 ${mt[i]}`));
  });
}

function obParity() {
  const rows = rowsOf("AT24_Order_Block_Lab/test/OB_selftest.csv");
  if (!rows) return;
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 5).map(Number));
  const O = bars.map((b) => b[0]);
  const H = bars.map((b) => b[1]);
  const L = bars.map((b) => b[2]);
  const C = bars.map((b) => b[3]);
  const blocks = detectOrderBlocks(O, H, L, C, OB_DEFAULTS);
  const ref = rows.filter((r) => r[0] === "ob");
  test(`order blocks identical to MT5 (${blocks.length})`, () => {
    assert.equal(blocks.length, ref.length);
    blocks.forEach((b, i) => {
      const r = ref[i];
      assert.deepEqual([b.idx, b.conf, b.dir], [+r[1], +r[2], +r[3]]);
      assert.ok(Math.abs(b.top - +r[4]) < 6e-4 && Math.abs(b.bottom - +r[5]) < 6e-4 && Math.abs(b.atr - +r[6]) < 6e-6);
      assert.deepEqual([b.touch, b.control, b.reaction, b.controlReaction], [+r[7], +r[8], +r[9], +r[10]]);
    });
  });
  test("order block statistics identical to MT5", () => {
    const s = obStats(blocks, bars.length, OB_DEFAULTS);
    assert.ok(s);
    const x = s as NonNullable<typeof s>;
    const mt = (rows.find((r) => r[0] === "stats") as string[]).slice(1).map(Number);
    [x.measured, x.touchedPct, x.controlTouchedPct, x.reactedPct, x.controlReactedPct, x.decided, x.controlDecided].forEach((v, i) => assert.ok(Math.abs(v - mt[i]) < 1e-4, `stat ${i}: mine ${v} vs MT5 ${mt[i]}`));
  });
}

function vpParity() {
  const rows = rowsOf("AT24_Volume_Profile_Levels/test/VP_selftest.csv");
  if (!rows) return;
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 7).map(Number));
  const T = bars.map((b) => b[0]);
  const O = bars.map((b) => b[1]);
  const H = bars.map((b) => b[2]);
  const L = bars.map((b) => b[3]);
  const C = bars.map((b) => b[4]);
  const V = bars.map((b) => b[5]);
  const days = buildVpDays(T, H, L, V, VP_DEFAULTS);
  const ref = rows.filter((r) => r[0] === "day");
  test(`volume profile days identical to MT5 (${days.length})`, () => {
    assert.equal(days.length, ref.length);
    days.forEach((d, i) => {
      const r = ref[i];
      assert.equal(d.first, +r[1]);
      assert.equal(d.last, +r[2]);
      assert.equal(Number(d.ok), +r[6]);
      if (d.ok) assert.ok(Math.abs(d.poc - +r[3]) < 1e-4 && Math.abs(d.vah - +r[4]) < 1e-4 && Math.abs(d.val - +r[5]) < 1e-4);
    });
  });
  const study = vpStudy(O, H, L, C, days, VP_DEFAULTS);
  for (const row of study) {
    test(`volume profile study ${row.name} identical to MT5`, () => {
      const mt = (rows.find((r) => r[0] === "study" && r[1] === row.name) as string[]).slice(2).map(Number);
      [row.days, row.touchPct, row.controlTouchPct, row.reactedPct, row.controlReactedPct, row.decided].forEach((v, i) => assert.ok(Math.abs(v - mt[i]) < 1e-4, `field ${i}: mine ${v} vs MT5 ${mt[i]}`));
    });
  }
}

function setupParity() {
  const rows = rowsOf("AT24_Setup_Pro/test/SP_selftest.csv");
  if (!rows) return;
  const m = rows.find((r) => r[0] === "meta") as string[];
  const p = { ...SETUP_DEFAULTS, stopAtr: +m[2], rr: +m[3], hold: +m[4] };
  const cost = +m[5];
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 5).map(Number));
  const O = bars.map((b) => b[0]);
  const H = bars.map((b) => b[1]);
  const L = bars.map((b) => b[2]);
  const C = bars.map((b) => b[3]);
  const atr = atrWilder(H, L, C);
  const ema = (src: number[], period: number) => {
    const a = 2 / (period + 1);
    const out: number[] = [];
    src.forEach((v, i) => out.push(i === 0 ? v : a * v + (1 - a) * out[i - 1]));
    return out;
  };
  const ef = ema(C, 20);
  const pull = pullbackEvents(H, L, ef, trendState(ef, ema(C, 50), ema(C, 200), atr));
  const sqc = squeezeCalc(H, L, C);
  const sq = squeezeEvents(C, sqc);
  for (const [ty, ev, a] of [[0, pull, atr], [1, sq, sqc.atr]] as const) {
    const refEv = rows.filter((r) => r[0] === "ev" && +r[1] === ty);
    test(`setup events type ${ty} identical to MT5 (${ev.length})`, () => {
      assert.equal(ev.length, refEv.length);
      ev.forEach((e, i) => assert.deepEqual([e.idx, e.dir], [+refEv[i][2], +refEv[i][3]]));
    });
    const t = simulateSetups(O, H, L, C, a, ev, p, cost);
    const ref = rows.filter((r) => r[0] === "setup" && +r[1] === ty);
    test(`setups type ${ty} identical (${t.length})`, () => {
      assert.equal(t.length, ref.length);
      t.forEach((x, i) => {
        const r = ref[i];
        assert.equal(x.idx, +r[2]);
        assert.equal(x.dir, +r[3]);
        assert.ok(close(x.entry, +r[4]) && close(x.sl, +r[5]) && close(x.tp, +r[6]) && close(x.risk, +r[7]));
        assert.equal(x.exitIdx, +r[8]);
        assert.equal(x.result, +r[9]);
        assert.ok(close(x.r, +r[10]));
      });
    });
    const sc = rows.find((r) => r[0] === "score" && +r[1] === ty) as string[];
    test(`setup score type ${ty} identical`, () => {
      const s2 = scoreTrades(t);
      const theirs = sc.slice(2).map(Number);
      [s2.n, s2.wins, s2.hitPct, s2.avgR, s2.sumR, s2.t, s2.pFlip, s2.open].forEach((v, i) => assert.ok(close(v, theirs[i]), `field ${i}: mine ${v} vs MT5 ${theirs[i]}`));
    });
  }
}

function structureParity() {
  const rows = rowsOf("AT24_Market_Structure/test/MS_selftest.csv");
  if (!rows) return;
  const bars = rows.filter((r) => r[0] === "bar");
  const H = bars.map((r) => +r[2]);
  const L = bars.map((r) => +r[3]);
  const C = bars.map((r) => +r[4]);
  const { events, trend } = structureEvents(H, L, C, STRUCTURE_DEFAULTS);
  const ref = rows.filter((r) => r[0] === "ev");
  test(`market structure events identical to MT5 (${events.length})`, () => {
    assert.equal(events.length, ref.length);
    events.forEach((e, i) => {
      const r = ref[i];
      assert.deepEqual([e.idx, e.pivot, e.dir, e.choch], [+r[1], +r[2], +r[4], +r[5]]);
      assert.ok(Math.abs(e.price - +r[3]) < 6e-4);
    });
    assert.equal(trend, +(rows.find((r) => r[0] === "state") as string[])[1]);
  });
  test("market structure statistics identical to MT5", () => {
    const s2 = structureStats(C, events, STRUCTURE_DEFAULTS);
    assert.ok(s2);
    const x = s2 as NonNullable<typeof s2>;
    const mt = (rows.find((r) => r[0] === "stats") as string[]).slice(1).map(Number);
    [x.bos, x.bosFollowPct, x.choch, x.chochFollowPct, x.baseUpPct, x.bosN, x.chochN].forEach((v, i) => assert.ok(Math.abs(v - mt[i]) <= 1.1e-3, `stat ${i}: mine ${v} vs MT5 ${mt[i]}`));
  });
}

function expectedRangeParity() {
  const rows = rowsOf("AT24_Expected_Range/test/ER_selftest.csv");
  if (!rows) return;
  const bars = rows.filter((r) => r[0] === "bar").map((r) => r.slice(1, 6).map(Number));
  const days = buildErDays(bars.map((b) => b[0]), bars.map((b) => b[1]), bars.map((b) => b[2]), bars.map((b) => b[3]), bars.map((b) => b[4]), 14);
  const ref = rows.filter((r) => r[0] === "day");
  test(`expected range days identical to MT5 (${days.length})`, () => {
    assert.equal(days.length, ref.length);
    days.forEach((d, i) => {
      const r = ref[i];
      assert.deepEqual([d.first, d.last, d.hit], [+r[1], +r[2], +r[4]]);
      assert.ok(Math.abs(d.exp - +r[3]) < 6e-5);
    });
  });
  test("expected range statistics identical to MT5", () => {
    const s2 = erStats(days);
    assert.ok(s2);
    const x = s2 as NonNullable<typeof s2>;
    const mt = (rows.find((r) => r[0] === "stats") as string[]).slice(1).map(Number);
    [x.days, x.medianRatio, x.reach100Pct, x.reach150Pct, x.hits, x.hit125Pct, x.hitMedian, x.directional50Pct].forEach((v, i) => assert.ok(Math.abs(v - mt[i]) <= 1.1e-3, `stat ${i}: mine ${v} vs MT5 ${mt[i]}`));
  });
}

console.log("More Market Board indicators vs the MetaTrader 5 builds");
absorptionParity();
fvgParity();
obParity();
vpParity();
setupParity();
structureParity();
expectedRangeParity();
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
if (failed > 0) process.exit(1);
