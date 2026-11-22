// lib/publishing/brief/facts.ts
// Market Brief 2.0: the ONE facts object a daily brief is built from. Pure function of the candle series (+ optional macro / calendar
// inputs that come from the market-intelligence services). The chart image, the text blocks, the social card and the next day's
// "yesterday's check" all read this same object, so the picture and the words can never disagree. Nothing here predicts anything:
// every field is a measurement of what price already did. Optional inputs that are missing stay undefined (never invented).
import type { ChartCandle } from "@/types/chart-data";
import { computeAnnotations, atr14 } from "@/lib/chart-engine/annotations/compute";
import { buildTradePlan, PLAN_MIN_SCORE, PLAN_SCORE_MAX, type TradePlan } from "@/lib/chart-engine/annotations/plan";
import { buildReadout, ema, rsi } from "@/lib/chart-engine/annotations/readout";
import type { ChartAnnotation, AnnotationResult, ZoneAnnotation } from "@/lib/chart-engine/annotations/types";

export type Trend = "bullish" | "bearish" | "mixed";

export interface BriefMacroInput {
  /** 0-100, share of driver weight pointing the same way (the "Alignment" number on the public market page). */
  alignmentPct: number;
  /** e.g. "Mixed", "Headwind", "Tailwind" - the label the market page already shows. */
  label: string;
  driversWithData?: number;
  driversTotal?: number;
}

export interface BriefEventInput {
  /** Pre-formatted in IST, e.g. "Mon 23 Nov, 7:00 PM IST". */
  whenIst: string;
  title: string;
  currency?: string;
  forecast?: string;
  previous?: string;
}

export interface BriefInput {
  symbol: string; // "BTCUSD"
  displayName: string; // "Bitcoin"
  pair: string; // "BTC/USD"
  category: "crypto" | "forex" | "metal" | "index";
  timeframeLabel: string; // "H1"
  candles: ChartCandle[]; // oldest-first, hourly
  macro?: BriefMacroInput;
  events?: BriefEventInput[];
}

export interface BriefZone { kind: ZoneAnnotation["kind"]; bias: ZoneAnnotation["bias"]; low: number; high: number }

export interface BriefFacts {
  symbol: string;
  displayName: string;
  pair: string;
  category: BriefInput["category"];
  timeframeLabel: string;
  asOfMs: number;
  price: number;
  change24hPct: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr: number;
  atrPctOfPrice: number;
  /** ATR(14) now divided by the average ATR(14) of the previous 100 bars. */
  atrRatio: number | null;
  volatilityWord: "quiet" | "normal" | "active";
  shortTrend: Trend; // 1-hour candles vs their EMA20 / EMA50
  higherTrend: Trend | null; // 4-hour candles vs their EMA20 / EMA50 (H1 resampled)
  lastBreak: { kind: "BOS" | "CHoCH"; bias: "bullish" | "bearish"; price: number } | null;
  resistance: { price: number; touches: number; distanceAtr: number } | null;
  support: { price: number; touches: number; distanceAtr: number } | null;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  zoneAbove: BriefZone | null;
  zoneBelow: BriefZone | null;
  plan: TradePlan;
  planGate: { min: number; max: number };
  readoutParagraph: string | null;
  macro?: BriefMacroInput;
  events: BriefEventInput[];
  weekend: boolean;
  /** Levels saved with the article so tomorrow's "yesterday's check" can compare them with what price did. */
  scenarioLevels: { time: number; resistance: number | null; support: number | null; ema20: number | null; ema50: number | null; price: number };
}

function trendOf(price: number, e20: number | null, e50: number | null): Trend {
  if (e20 === null || e50 === null) return "mixed";
  if (price > e20 && e20 > e50) return "bullish";
  if (price < e20 && e20 < e50) return "bearish";
  return "mixed";
}

/** Group hourly candles into 4-hour candles on UTC 4-hour boundaries (00, 04, 08, ...). */
export function resampleH4(c: ChartCandle[]): ChartCandle[] {
  const H4 = 4 * 3600_000;
  const out: ChartCandle[] = [];
  for (const k of c) {
    const bucket = Math.floor(k.time / H4) * H4;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, k.high);
      last.low = Math.min(last.low, k.low);
      last.close = k.close;
    } else out.push({ time: bucket, open: k.open, high: k.high, low: k.low, close: k.close });
  }
  return out;
}

function previousDayRange(c: ChartCandle[]): { high: number; low: number } | null {
  const DAY = 86_400_000;
  const todayStart = Math.floor(c[c.length - 1].time / DAY) * DAY;
  const prev = c.filter((k) => k.time >= todayStart - DAY && k.time < todayStart);
  if (prev.length < 12) return null;
  return { high: Math.max(...prev.map((k) => k.high)), low: Math.min(...prev.map((k) => k.low)) };
}

function nearestZone(annotations: ChartAnnotation[], price: number, side: "above" | "below"): BriefZone | null {
  const zones = annotations.flatMap((a) => (a.type === "zone" && (a.kind === "fvg" || a.kind === "orderBlock" || a.kind === "breaker") && a.endTime === null ? [a] : []));
  const cand = zones.filter((z) => (side === "above" ? z.low > price : z.high < price)).sort((x, y) => (side === "above" ? x.low - y.low : y.high - x.high))[0];
  return cand ? { kind: cand.kind, bias: cand.bias, low: cand.low, high: cand.high } : null;
}

export function buildBriefFacts(input: BriefInput, analysisIn?: AnnotationResult): BriefFacts | null {
  const c = input.candles;
  if (c.length < 200) return null;
  const last = c[c.length - 1];
  const price = last.close;
  const analysis = analysisIn ?? computeAnnotations(c);
  const plan = buildTradePlan(c);
  const fmt = (n: number) => String(n);
  const readout = buildReadout(c, analysis, plan, fmt);
  const closes = c.map((k) => k.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const atr = analysis.params.atr || atr14(c);

  // volatility now vs the previous 100 bars
  let atrRatio: number | null = null;
  if (c.length > 130) {
    const prev: number[] = [];
    for (let i = c.length - 101; i < c.length - 1; i += 5) prev.push(atr14(c, i));
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
    atrRatio = avg > 0 ? atr / avg : null;
  }
  const volatilityWord = atrRatio === null ? "normal" : atrRatio < 0.8 ? "quiet" : atrRatio > 1.25 ? "active" : "normal";

  const h4 = resampleH4(c);
  const h4c = h4.map((k) => k.close);
  const higherTrend = h4.length >= 60 ? trendOf(h4c[h4c.length - 1], ema(h4c, 20), ema(h4c, 50)) : null;

  const breaks = analysis.annotations.flatMap((a) => (a.type === "structure" ? [a] : [])).sort((x, y) => y.toTime - x.toTime);
  const lb = breaks[0];
  const levels = analysis.annotations.flatMap((a) => (a.type === "level" ? [a] : []));
  const up = levels.filter((l) => l.price > price).sort((x, y) => x.price - y.price)[0];
  const dn = levels.filter((l) => l.price < price).sort((x, y) => y.price - x.price)[0];
  const pd = previousDayRange(c);

  const idx24 = c.length - 25;
  const change24hPct = idx24 >= 0 ? ((price - c[idx24].close) / c[idx24].close) * 100 : null;
  const day = new Date(last.time).getUTCDay();
  const resistance = up ? { price: up.price, touches: up.touches, distanceAtr: (up.price - price) / atr } : null;
  const support = dn ? { price: dn.price, touches: dn.touches, distanceAtr: (price - dn.price) / atr } : null;

  return {
    symbol: input.symbol,
    displayName: input.displayName,
    pair: input.pair,
    category: input.category,
    timeframeLabel: input.timeframeLabel,
    asOfMs: last.time,
    price,
    change24hPct,
    ema20: e20,
    ema50: e50,
    rsi14: r,
    atr,
    atrPctOfPrice: (atr / price) * 100,
    atrRatio,
    volatilityWord,
    shortTrend: trendOf(price, e20, e50),
    higherTrend,
    lastBreak: lb ? { kind: lb.kind, bias: lb.bias, price: lb.price } : null,
    resistance,
    support,
    prevDayHigh: pd?.high ?? null,
    prevDayLow: pd?.low ?? null,
    zoneAbove: nearestZone(analysis.annotations, price, "above"),
    zoneBelow: nearestZone(analysis.annotations, price, "below"),
    plan,
    planGate: { min: PLAN_MIN_SCORE, max: PLAN_SCORE_MAX },
    readoutParagraph: readout?.paragraph ?? null,
    macro: input.macro,
    events: (input.events ?? []).slice(0, 3),
    weekend: day === 0 || day === 6,
    scenarioLevels: { time: last.time, resistance: resistance?.price ?? null, support: support?.price ?? null, ema20: e20, ema50: e50, price },
  };
}
