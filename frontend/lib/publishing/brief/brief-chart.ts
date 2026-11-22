// lib/publishing/brief/brief-chart.ts
// Market Brief 2.0: renders the REAL Pro Chart (renderChart + computeAnnotations + buildTradePlan, the same code the dashboard runs)
// to a PNG on a server canvas. No second chart engine: this file only wires inputs and a header strip. Used by the daily brief,
// the social card and the video. @napi-rs/canvas is loaded lazily (it is in serverExternalPackages, see next.config.ts).
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ChartCandle } from "@/types/chart-data";
import { renderChart } from "@/lib/chart-engine/renderer";
import { computeAnnotations } from "@/lib/chart-engine/annotations/compute";
import { buildTradePlan, type TradePlan } from "@/lib/chart-engine/annotations/plan";
import { PRO_LAYERS_DEFAULT, type AnnotationResult } from "@/lib/chart-engine/annotations/types";
import { fitToRecent } from "@/lib/chart-engine/viewport";
import { resolveChartColors } from "@/lib/chart-engine/canvas-colors";
import { formatPrice } from "@/lib/financial-format";

export type BriefChartSize = "blog" | "carousel" | "story";

export const BRIEF_CHART_SIZES: Record<BriefChartSize, { width: number; height: number; recent: number }> = {
  blog: { width: 1600, height: 900, recent: 110 },
  carousel: { width: 1080, height: 1350, recent: 80 },
  story: { width: 1080, height: 1920, recent: 70 },
};

const PRICE_AXIS_WIDTH = 74; // same constants as NativeChart.tsx
const TIME_AXIS_HEIGHT = 22;
const SCALE = 2;

export interface BriefChartOptions {
  candles: ChartCandle[];
  /** "BTC/USD" */
  pair: string;
  /** "H1" */
  timeframeLabel: string;
  size?: BriefChartSize;
  analysis?: AnnotationResult;
  plan?: TradePlan;
}

export interface BriefChartResult {
  png: Buffer;
  width: number;
  height: number;
  annotationCount: number;
  planState: TradePlan["state"];
}

let fontsReady = false;

/** Registers the bundled Liberation Sans under the family names the chart engine and the header ask for (serverless Linux has no system fonts). */
async function ensureFonts(): Promise<void> {
  if (fontsReady) return;
  const { GlobalFonts } = await import("@napi-rs/canvas");
  const dir = join(process.cwd(), "assets", "fonts");
  const regular = join(dir, "LiberationSans-Regular.ttf");
  const bold = join(dir, "LiberationSans-Bold.ttf");
  if (!existsSync(regular) || !existsSync(bold)) throw new Error("Brief chart fonts are missing (assets/fonts). Check outputFileTracingIncludes in next.config.ts.");
  const names = ["Liberation Sans", "Segoe UI", "Arial", "Helvetica", "Roboto", "ui-sans-serif", "system-ui", "Consolas", "Liberation Mono", "ui-monospace", "SFMono-Regular", "monospace"];
  for (const n of names) {
    GlobalFonts.registerFromPath(regular, n);
    GlobalFonts.registerFromPath(bold, n);
  }
  fontsReady = true;
}

export async function renderBriefChartPng(opts: BriefChartOptions): Promise<BriefChartResult> {
  const { candles } = opts;
  if (candles.length < 300) throw new Error(`renderBriefChartPng: need at least 300 candles, got ${candles.length}`);
  await ensureFonts();
  const { createCanvas } = await import("@napi-rs/canvas");

  const size = BRIEF_CHART_SIZES[opts.size ?? "blog"];
  const W = size.width;
  const H = size.height;
  const HEADER = 64;
  const analysis = opts.analysis ?? computeAnnotations(candles);
  const plan = opts.plan ?? buildTradePlan(candles);
  const fmtP = (n: number) => formatPrice(n, { maxDecimals: Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 100 ? 3 : Math.abs(n) >= 10 ? 4 : 5 });
  const viewport = fitToRecent(candles, size.recent, 30);

  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(0, HEADER);
  renderChart({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    dims: { width: W, height: H - HEADER, priceAxisWidth: PRICE_AXIS_WIDTH, timeAxisHeight: TIME_AXIS_HEIGHT },
    candles,
    viewport,
    timeframe: "1h",
    colors: resolveChartColors("pro"),
    annotations: analysis.annotations,
    annotationLayers: PRO_LAYERS_DEFAULT,
    planBox: plan.state === "plan" ? { dir: plan.dir, entryType: plan.entryType, entry: plan.entry, stop: plan.stop, target: plan.target, rr: plan.rr } : null,
    formatPlanPrice: fmtP,
    fontKind: "sans",
  });
  ctx.restore();

  const last = candles[candles.length - 1];
  const when = new Date(last.time).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  ctx.fillStyle = "#e8ecf4";
  ctx.font = "700 24px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${opts.pair}  ·  ${opts.timeframeLabel}`, 24, 38);
  ctx.fillStyle = "#9aa4b8";
  ctx.font = "400 16px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${fmtP(last.close)}   ·   latest candle ${when}`, 24, 58);
  ctx.textAlign = "right";
  ctx.fillStyle = "#d4af37";
  ctx.font = "700 18px 'Segoe UI', Arial, sans-serif";
  ctx.fillText("ALGOTRADERS24 AI", W - 24, 36);
  ctx.fillStyle = "#9aa4b8";
  ctx.font = "400 13px 'Segoe UI', Arial, sans-serif";
  ctx.fillText("Pro Chart  ·  context, not advice", W - 24, 56);
  ctx.textAlign = "left";

  return { png: canvas.toBuffer("image/png"), width: W, height: H, annotationCount: analysis.annotations.length, planState: plan.state };
}
