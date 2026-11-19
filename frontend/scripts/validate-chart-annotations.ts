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

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
