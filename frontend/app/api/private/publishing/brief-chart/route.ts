// app/api/private/publishing/brief-chart/route.ts
// Market Brief 2.0 - renders the real Pro Chart image for one market (candles from the SAME market-data layer the dashboard chart uses).
//   GET ?symbol=BTCUSD&size=blog            -> PNG (use this on a Vercel preview to prove the server canvas, fonts and bundling work)
//   GET ?symbol=BTCUSD&size=blog&upload=1   -> stores the PNG in Supabase Storage (bucket brief-charts) and returns its public URL
// PRIVILEGED: a valid cron secret OR an authenticated admin (same gate as ../auto-daily). Not linked from the site.
import { NextResponse } from "next/server";
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { requireAdmin } from "@/lib/auth/adminRoute";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { marketData } from "@/services/market-data/shared-instance";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { ensureExnessInstrumentRegistered } from "@/lib/market-data/exness-instruments";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import { renderBriefChartPng, BRIEF_CHART_SIZES, type BriefChartSize } from "@/lib/publishing/brief/brief-chart";
import { uploadBriefChart } from "@/lib/publishing/brief/brief-storage";

export const maxDuration = 60;
export const runtime = "nodejs";

function pairLabel(symbol: string): string {
  return /^[A-Z]{6}$/.test(symbol) ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
}

async function handle(req: Request, ctx: { requestId: string; startedAt: number }) {
  if (!isValidCronSecret(req)) {
    const gate = await requireAdmin(ctx.requestId, ctx.startedAt);
    if (!gate.ok) return gate.response;
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const sizeRaw = url.searchParams.get("size") ?? "blog";
  const upload = url.searchParams.get("upload") === "1";
  if (!(sizeRaw in BRIEF_CHART_SIZES)) {
    return ApiResponse.error({ code: "VALIDATION", message: "size must be blog, carousel or story." }, ctx.requestId, 400, ctx.startedAt);
  }
  const size = sizeRaw as BriefChartSize;
  if (symbol && !getCanonicalInstrument(symbol)) await ensureExnessInstrumentRegistered(symbol);
  if (!symbol || !getCanonicalInstrument(symbol)) {
    return ApiResponse.error({ code: "VALIDATION", message: "symbol must be a known canonical instrument." }, ctx.requestId, 400, ctx.startedAt);
  }

  const series = await marketData.getTimeSeriesWithProvenance({ symbol, interval: PROVIDER_INTERVAL["1h"], outputSize: 1000 });
  const { candles } = normalizeCandles(series.candles);
  if (candles.length < 300) {
    return ApiResponse.error({ code: "NOT_ENOUGH_DATA", message: `Only ${candles.length} candles available for ${symbol}.` }, ctx.requestId, 422, ctx.startedAt);
  }

  const result = await renderBriefChartPng({ candles, pair: pairLabel(symbol), timeframeLabel: "H1", size });
  if (upload) {
    const publicUrl = await uploadBriefChart({ symbol, dateIso: new Date(candles[candles.length - 1].time).toISOString(), size, png: result.png });
    return ApiResponse.success({ symbol, size, url: publicUrl, width: result.width, height: result.height, annotations: result.annotationCount, plan: result.planState, provider: series.provider }, ctx.requestId, 200, ctx.startedAt);
  }
  return new NextResponse(new Uint8Array(result.png), { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}

export const GET = withContext(handle);
