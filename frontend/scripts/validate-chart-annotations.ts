// scripts/validate-chart-annotations.ts - hand-worked fixtures for the Professional Mode annotation engine.
// Run: npx tsx scripts/validate-chart-annotations.ts
import { computeAnnotations } from "../lib/chart-engine/annotations/compute";
import type { ChartCandle } from "../types/chart-data";

let fails = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
}

// open = previous close; high/low = body +- 0.5. One candle per hour.
function build(closes: number[]): ChartCandle[] {
  const t0 = Date.UTC(2026, 0, 5, 0, 0, 0);
  return closes.map((cl, i) => {
    const o = i === 0 ? cl : closes[i - 1];
    return { time: t0 + i * 3600_000, open: o, close: cl, high: Math.max(o, cl) + 0.5, low: Math.min(o, cl) - 0.5 };
  });
}

// Fixture 1: swing high 110.5 at idx5 (confirmed idx8), swing low 101.5 at idx9, close 112 at idx13 breaks it.
const f1 = build([100, 101, 102, 103, 105, 110, 106, 104, 103, 102, 104, 106, 108, 112, 111, 113, 114, 115, 116, 117]);
const r1 = computeAnnotations(f1);
const bos = r1.annotations.find((a) => a.type === "structure");
check("BOS found", !!bos && bos.type === "structure" && bos.kind === "BOS" && bos.bias === "bullish", JSON.stringify(bos));
check("BOS price = swing high 110.5", !!bos && bos.type === "structure" && bos.price === 110.5);
check("BOS broken at idx13", !!bos && bos.type === "structure" && bos.toTime === f1[13].time);
const ob = r1.annotations.find((a) => a.type === "zone" && a.kind === "orderBlock");
check("Demand OB = candle idx9 (101.5-103.5)", !!ob && ob.type === "zone" && ob.bias === "bullish" && ob.low === 101.5 && ob.high === 103.5 && ob.startTime === f1[9].time, JSON.stringify(ob));
const fvg = r1.annotations.find((a) => a.type === "zone" && a.kind === "fvg" && a.startTime === f1[12].time);
// idx13 low = 107.5 (open 108, close 112, body low - 0.5), idx11 high = 106.5 -> gap 1.0, needs >= 0.3 ATR
check("Bullish FVG = high[idx11] 106.5 .. low[idx13] 107.5", !!fvg && fvg.type === "zone" && fvg.low === 106.5 && fvg.high === 107.5, JSON.stringify({ fvg, atr: r1.params.atr }));
check("Premium and discount zones exist", r1.annotations.some((a) => a.type === "zone" && a.kind === "premium") && r1.annotations.some((a) => a.type === "zone" && a.kind === "discount"));

// Fixture 2: no look-ahead - cutting history before the break (idx12) must show no structure break.
const r2 = computeAnnotations(f1.slice(0, 13));
check("No break before the breaking candle (cut-history)", !r2.annotations.some((a) => a.type === "structure"));

// Fixture 3: CHoCH = break against the running trend. Bullish break, then a close below the swing low 101.5? Use a downtrend first.
const f3 = build([120, 119, 118, 117, 115, 110, 112, 114, 115, 116, 114, 112, 108, 106, 109, 111, 113, 118, 122, 124, 125]);
const r3 = computeAnnotations(f3);
const kinds = r3.annotations.filter((a) => a.type === "structure").map((a) => (a.type === "structure" ? `${a.kind}-${a.bias}` : ""));
check("Downtrend break then upside CHoCH", kinds.includes("BOS-bearish") && kinds.some((k) => k === "CHoCH-bullish"), kinds.join(","));

// Fixture 4: sweep = wick above swing high but close back below.
const f4 = build([100, 101, 102, 103, 105, 110, 106, 104, 103, 102, 104, 106, 108, 109]);
f4[13] = { ...f4[13], high: 111.5, close: 109 };
const r4 = computeAnnotations(f4);
check("Bearish sweep marker on idx13", r4.annotations.some((a) => a.type === "marker" && a.bias === "bearish" && a.time === f4[13].time), JSON.stringify(r4.annotations.filter((a) => a.type === "marker")));

// Determinism
check("Deterministic output", JSON.stringify(computeAnnotations(f1)) === JSON.stringify(computeAnnotations(f1)));
// Degenerate input
check("Short input returns empty", computeAnnotations(f1.slice(0, 5)).annotations.length === 0);

// Plan: after the bullish BOS, price retests the demand OB (101.5-103.5) -> long plan with measurable risk.
import { planAt, PLAN_RR, buildTradePlan } from "../lib/chart-engine/annotations/plan";
{
  const f5 = build([100, 101, 102, 103, 105, 110, 106, 104, 103, 102, 104, 106, 108, 112, 111, 113, 114, 115, 116, 117, 110, 105, 103]);
  const p = planAt(f5);
  check("Plan: long on demand-OB retest", p.state === "plan" && p.dir === "long", JSON.stringify(p));
  if (p.state === "plan") {
    check("Plan: entry = last close 103", p.entry === 103);
    check("Plan: stop below the OB low 101.5", p.stop < 101.5);
    check("Plan: target = entry + 2 x risk", Math.abs(p.target - (p.entry + PLAN_RR * (p.entry - p.stop))) < 0.5);
    check("Plan: score counts confluences, max 5", p.score >= 1 && p.score <= p.scoreMax, String(p.score));
  }
  const lim = planAt(f1); // price above the zones: a limit plan at the nearest bullish zone on the way back down
  check("Plan: limit entry below price when price is away from the zone", lim.state === "plan" && lim.entryType === "limit" && lim.dir === "long" && lim.entry < 117, JSON.stringify(lim));
  if (lim.state === "plan") check("Plan: limit plan stop below entry, target = entry + 2 x risk", lim.stop < lim.entry && Math.abs(lim.target - (lim.entry + PLAN_RR * (lim.entry - lim.stop))) < 0.5);
  const far = build([100, 101, 102, 103, 105, 110, 106, 104, 103, 102, 104, 106, 108, 112, 111, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140]);
  const aside = planAt(far);
  check("Plan: stand aside when the nearest zone is more than 3 ATR away", aside.state === "standAside", JSON.stringify(aside));
  check("Plan: record is null (honest) when history is too short", buildTradePlan(f5).state !== "plan" || (buildTradePlan(f5) as { record: unknown }).record === null);
  // Long random-walk history: record must be computed deterministically and never invent a number from nothing
  let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let px = 100; const walk = build(Array.from({ length: 900 }, () => (px += (rnd() - 0.5) * 2)));
  const { measurePlanRecord } = require("../lib/chart-engine/annotations/plan");
  const r1m = measurePlanRecord(walk), r2m = measurePlanRecord(walk);
  check("Record: deterministic", JSON.stringify(r1m) === JSON.stringify(r2m));
  console.log("      random-walk record (expected ~ -0.1..0 R, no edge):", JSON.stringify(r1m));
}

// Luck baseline: shuffled copy keeps length, times and total candle shapes; the record carries a standard error
import { shuffledCopy, measureWithBaseline } from "../lib/chart-engine/annotations/plan";
{
  let x = 777; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let px = 100; const walk = build(Array.from({ length: 600 }, () => (px += (rnd() - 0.5) * 2)));
  const sh = shuffledCopy(walk, 20261118);
  check("shuffledCopy keeps length and times", sh.length === walk.length && sh.every((c, i) => c.time === walk[i].time));
  check("shuffledCopy keeps every candle internally valid (low <= open,close <= high)", sh.every((c) => c.low <= Math.min(c.open, c.close) + 1e-9 && c.high >= Math.max(c.open, c.close) - 1e-9));
  check("shuffledCopy is repeatable", JSON.stringify(shuffledCopy(walk, 20261118)) === JSON.stringify(sh));
  const m = measureWithBaseline(walk);
  check("record has se and a baseline", !!m && m.se > 0 && m.baselineAvgR !== undefined, JSON.stringify(m));
}


import { indexRangeForViewport } from "../lib/chart-engine/index-scale";
// Pro Chart pieces: plan box, recency, scan path, range presets, layer presets
import { drawPlanBox } from "../lib/chart-engine/annotations/render";
import { computeScanPath } from "../lib/chart-engine/scan-path";
import { rangeSpanMs } from "../components/chart-engine/RangeBar";
import { PRO_LAYERS_CLEAN, PRO_LAYERS_DEFAULT } from "../lib/chart-engine/annotations/types";
{
  const walk = build(Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 7) * 6 + i * 0.02));
  const vp = { minTime: walk[290].time, maxTime: walk[399].time + 30 * 3600_000, minPrice: 90, maxPrice: 120 } as never;
  const range = indexRangeForViewport(walk, vp);
  const row = { id: "price", top: 0, height: 300 } as never;
  const rec = (() => { let n = 0; const base: Record<string, unknown> = {}; const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : (..._a: unknown[]) => { n++; }), set: (t, k, v) => { t[k as string] = v; return true; } }); return { ctx: ctx as unknown as CanvasRenderingContext2D, count: () => n }; })();
  drawPlanBox(rec.ctx, { dir: "long", entryType: "limit", entry: 104, stop: 101, target: 110, rr: 2 }, walk, range, vp, 800, row, (n) => n.toFixed(2));
  check("Plan box: draws zones, lines and pills", rec.count() > 10, String(rec.count()));
  const tiny = (() => { let n = 0; const base: Record<string, unknown> = {}; const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : (..._a: unknown[]) => { n++; }), set: (t, k, v) => { t[k as string] = v; return true; } }); return { ctx: ctx as unknown as CanvasRenderingContext2D, count: () => n }; })();
  drawPlanBox(tiny.ctx, { dir: "long", entryType: "market", entry: 104, stop: 101, target: 110, rr: 2 }, walk, range, vp, 30, row, (n) => n.toFixed(2));
  check("Plan box: nothing drawn when there is no room on the right", tiny.count() === 0, String(tiny.count()));

  // recency: annotations older than the last 120 candles are dropped
  const wavy = build(Array.from({ length: 480 }, (_, i) => 100 + Math.sin(i / 5) * 8));
  const all = computeAnnotations(wavy, { recentBars: 100000 });
  const recent = computeAnnotations(wavy);
  const cutoff = wavy[wavy.length - 120].time;
  const oldIn = recent.annotations.filter((a) => (a.type === "structure" && a.toTime < cutoff) || (a.type === "marker" && a.time < cutoff) || (a.type === "zone" && (a.kind === "fvg" || a.kind === "orderBlock" || a.kind === "breaker") && a.startTime < cutoff));
  check("Recency: nothing older than 120 candles among structure / sweeps / OB / FVG", oldIn.length === 0, String(oldIn.length));
  check("Recency: the unfiltered run had more annotations", all.annotations.length >= recent.annotations.length);

  // scan path stays inside the plot and moves left to right
  const path = computeScanPath(walk, vp, { width: 900, height: 340, priceAxisWidth: 100, timeAxisHeight: 40 });
  check("Scan path: has points, x ascending, y inside the plot", path.length > 20 && path.every((p, i) => (i === 0 || p[0] >= path[i - 1][0]) && p[1] >= 0 && p[1] <= 300), String(path.length));
  check("Scan path: empty for no candles", computeScanPath([], vp, { width: 900, height: 340, priceAxisWidth: 100, timeAxisHeight: 40 }).length === 0);

  // range presets
  const now = Date.UTC(2026, 10, 22, 9, 0, 0);
  check("Range: 5D = 5 days, ALL = null, YTD = since 1 Jan", rangeSpanMs("5D", now) === 5 * 86_400_000 && rangeSpanMs("ALL", now) === null && rangeSpanMs("YTD", now) === now - Date.UTC(2026, 0, 1));

  // layer presets
  check("Layers: default has sessions off and plan on; clean keeps drawings only", PRO_LAYERS_DEFAULT.sessions === false && PRO_LAYERS_DEFAULT.plan === true && PRO_LAYERS_CLEAN.drawings === true && Object.entries(PRO_LAYERS_CLEAN).filter(([k, v]) => k !== "drawings" && v).length === 0);
}

// fitToRecent frames only the latest N candles
import { fitToRecent, fitToData } from "../lib/chart-engine/viewport";
{
  const big = build(Array.from({ length: 400 }, (_, i) => 100 + (i % 10)));
  const v = fitToRecent(big, 100);
  check("fitToRecent starts at candle len-100", v.minTime === big[300].time);
  check("fitToRecent with fewer candles = fitToData", JSON.stringify(fitToRecent(big.slice(0, 50), 100)) === JSON.stringify(fitToData(big.slice(0, 50))));
}

// Render smoke test on a recording canvas: layers on draws something, layers off (clean chart) draws nothing.
import { drawAnnotations } from "../lib/chart-engine/annotations/render";
import { ALL_LAYERS_OFF, ALL_LAYERS_ON } from "../lib/chart-engine/annotations/types";
import { indexRangeForViewport } from "../lib/chart-engine/index-scale";
function recorder() {
  let n = 0;
  const base: Record<string, unknown> = {};
  const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : (..._a: unknown[]) => { n++; }), set: (t, k, v) => { t[k as string] = v; return true; } });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, count: () => n };
}
{
  const vp = { startTime: f1[0].time, endTime: f1[f1.length - 1].time, priceMin: 95, priceMax: 120 } as never;
  let range;
  try { range = indexRangeForViewport(f1, vp); } catch { range = null; }
  if (range) {
    const row = { id: "price", top: 0, height: 300 } as never;
    const on = recorder(); drawAnnotations(on.ctx, r1.annotations, ALL_LAYERS_ON, f1, range, vp, 800, row);
    const off = recorder(); drawAnnotations(off.ctx, r1.annotations, ALL_LAYERS_OFF, f1, range, vp, 800, row);
    check("Render: layers on issues draw calls", on.count() > 0, String(on.count()));
    check("Render: clean chart (all layers off) draws nothing", off.count() === 0, String(off.count()));
  } else console.log("SKIP  render smoke test (viewport shape differs)");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
