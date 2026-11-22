// scripts/validate-brief-chart.ts
// Market Brief 2.0 phase 2: the server-rendered Pro Chart image works with the BUNDLED fonts (no system fonts), at all three sizes.
// Offline (saved candles). Writes the PNGs to ../docs/social/blogchart/phase2/ for a visual check.
// Run: npx tsx scripts/validate-brief-chart.ts
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { renderBriefChartPng, BRIEF_CHART_SIZES, type BriefChartSize } from "../lib/publishing/brief/brief-chart";
import type { ChartCandle } from "../types/chart-data";

let failures = 0;
function ok(c: boolean, m: string) { if (!c) { failures++; console.log("FAIL:", m); } }
const OUT = "../docs/social/blogchart/phase2";
mkdirSync(OUT, { recursive: true });

async function main() {
  for (const [file, pair] of [["BTCUSD", "BTC/USD"], ["XAUUSD", "XAU/USD"]] as const) {
    const candles: ChartCandle[] = JSON.parse(readFileSync(`scripts/fixtures/brief/${file}_H1.json`, "utf8"));
    for (const size of Object.keys(BRIEF_CHART_SIZES) as BriefChartSize[]) {
      const t0 = Date.now();
      const r = await renderBriefChartPng({ candles, pair, timeframeLabel: "H1", size });
      const ms = Date.now() - t0;
      const sig = r.png.subarray(0, 8).toString("hex");
      ok(sig === "89504e470d0a1a0a", `${file}/${size}: PNG signature`);
      ok(r.width === BRIEF_CHART_SIZES[size].width && r.height === BRIEF_CHART_SIZES[size].height, `${file}/${size}: dimensions`);
      ok(r.png.length > 40_000, `${file}/${size}: image is not empty (${r.png.length} bytes)`);
      ok(r.annotationCount > 3, `${file}/${size}: annotations drawn (${r.annotationCount})`);
      writeFileSync(`${OUT}/${file}_${size}.png`, r.png);
      console.log(`${file} ${size}: ${r.width}x${r.height}, ${(r.png.length / 1024).toFixed(0)} KB, ${r.annotationCount} annotations, plan=${r.planState}, ${ms} ms`);
    }
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
