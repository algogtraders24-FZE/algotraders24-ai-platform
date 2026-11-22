// scripts/render-pro-chart-image.ts
// Renders the REAL Pro Chart (same renderChart() + computeAnnotations() + buildTradePlan() the dashboard uses) to a PNG
// on a server canvas, for blog posts, social cards and videos. No second chart engine: this file only wires inputs.
// Prototype data source: Exness H1 CSV exports (E:/at24_kill/live/KX_<SYMBOL>_H1.csv). Production: same candles as /dashboard/chart.
// Run: npx tsx scripts/render-pro-chart-image.ts XAUUSD [out.png] [width] [height]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { renderChart } from "../lib/chart-engine/renderer";
import { computeAnnotations } from "../lib/chart-engine/annotations/compute";
import { buildTradePlan } from "../lib/chart-engine/annotations/plan";
import { PRO_LAYERS_DEFAULT } from "../lib/chart-engine/annotations/types";
import { fitToRecent } from "../lib/chart-engine/viewport";
import { resolveChartColors } from "../lib/chart-engine/canvas-colors";
import { formatPrice } from "../lib/financial-format";
import type { ChartCandle } from "../types/chart-data";

const SYMBOL = (process.argv[2] ?? "XAUUSD").toUpperCase();
const OUT = process.argv[3] ?? `../docs/social/blogchart/${SYMBOL}_H1_pro_chart.png`;
const W = Number(process.argv[4] ?? 1600);
const H = Number(process.argv[5] ?? 900);
const PRICE_AXIS_WIDTH = 74; // same constants as NativeChart.tsx
const TIME_AXIS_HEIGHT = 22;
const HEADER = 64; // our own title strip above the chart (the dashboard draws its title in HTML)
const SCALE = 2; // retina-like output

function loadCsv(symbol: string): ChartCandle[] {
  const lines = readFileSync(`E:/at24_kill/live/KX_${symbol}_H1.csv`, "utf8").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const ix = (n: string) => head.indexOf(n);
  const out: ChartCandle[] = [];
  const seen = new Set<number>();
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const t = Date.parse(c[ix("time")].replace(/\./g, "-").replace(" ", "T") + ":00Z");
    if (!Number.isFinite(t) || seen.has(t)) continue;
    seen.add(t);
    out.push({ time: t, open: +c[ix("open")], high: +c[ix("high")], low: +c[ix("low")], close: +c[ix("close")] });
  }
  return out.sort((a, b) => a.time - b.time);
}

const candles = loadCsv(SYMBOL).slice(-2000);
if (candles.length < 300) throw new Error(`not enough candles for ${SYMBOL}`);

const analysis = computeAnnotations(candles);
const plan = buildTradePlan(candles);
const fmtP = (n: number) => formatPrice(n, { maxDecimals: Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 100 ? 3 : Math.abs(n) >= 10 ? 4 : 5 });
const viewport = fitToRecent(candles, 110, 30);
const colors = resolveChartColors("pro");

const canvas = createCanvas(W * SCALE, H * SCALE);
const ctx = canvas.getContext("2d");
ctx.scale(SCALE, SCALE);
ctx.fillStyle = "#0b0e14";
ctx.fillRect(0, 0, W, H);

// the chart itself lives in the area under the header: translate so renderChart() sees a normal (0,0) canvas
ctx.save();
ctx.translate(0, HEADER);
renderChart({
  ctx: ctx as unknown as CanvasRenderingContext2D,
  dims: { width: W, height: H - HEADER, priceAxisWidth: PRICE_AXIS_WIDTH, timeAxisHeight: TIME_AXIS_HEIGHT },
  candles,
  viewport,
  timeframe: "1h" as never,
  colors,
  annotations: analysis.annotations,
  annotationLayers: PRO_LAYERS_DEFAULT,
  planBox: plan.state === "plan" ? { dir: plan.dir, entryType: plan.entryType, entry: plan.entry, stop: plan.stop, target: plan.target, rr: plan.rr } : null,
  formatPlanPrice: fmtP,
  fontKind: "sans",
});
ctx.restore();

// header: pair, timeframe, last price, timestamp, brand
const last = candles[candles.length - 1];
const pair = SYMBOL.length === 6 ? `${SYMBOL.slice(0, 3)}/${SYMBOL.slice(3)}` : SYMBOL;
ctx.fillStyle = "#e8ecf4";
ctx.font = "700 24px 'Segoe UI', Arial, sans-serif";
ctx.fillText(`${pair}  ·  H1`, 24, 38);
ctx.fillStyle = "#9aa4b8";
ctx.font = "400 16px 'Segoe UI', Arial, sans-serif";
const when = new Date(last.time).toISOString().replace("T", " ").slice(0, 16) + " UTC";
ctx.fillText(`${fmtP(last.close)}   ·   last candle ${when}`, 24, 58);
ctx.textAlign = "right";
ctx.fillStyle = "#d4af37";
ctx.font = "700 18px 'Segoe UI', Arial, sans-serif";
ctx.fillText("ALGOTRADERS24 AI", W - 24, 36);
ctx.fillStyle = "#9aa4b8";
ctx.font = "400 13px 'Segoe UI', Arial, sans-serif";
ctx.fillText("Pro Chart  ·  context, not advice", W - 24, 56);
ctx.textAlign = "left";

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, canvas.toBuffer("image/png"));
console.log(`wrote ${OUT}  ${W}x${H} @${SCALE}x  candles=${candles.length}  annotations=${analysis.annotations.length}  plan=${plan.state}`);
