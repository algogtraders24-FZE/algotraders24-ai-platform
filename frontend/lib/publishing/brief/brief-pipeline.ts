// lib/publishing/brief/brief-pipeline.ts
// Market Brief 2.0: one call that turns a symbol into a finished article (chart uploaded + structured sections).
// Used by the daily auto-publisher behind the BRIEF_V2 flag. Returns null when anything is missing (too few candles, no facts,
// chart upload failed): the caller then publishes the previous report format instead, so a brief problem never blocks the day.
import type { ArticleSection } from "@/types/article";
import { marketData } from "@/services/market-data/shared-instance";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { ensureExnessInstrumentRegistered } from "@/lib/market-data/exness-instruments";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import { buildBriefFacts, type BriefEventInput, type BriefFacts, type BriefInput } from "./facts";
import type { WeekStats } from "./report-builders";
import { buildBriefSections, type PreviousBrief } from "./templates";
import { renderBriefChartPng } from "./brief-chart";
import { uploadBriefChart } from "./brief-storage";

export interface BriefMarket { displayName: string; pair: string; category: BriefInput["category"] }

/** Every market the daily analysis rotation covers. */
export const BRIEF_MARKETS: Record<string, BriefMarket> = {
  XAUUSD: { displayName: "Gold", pair: "XAU/USD", category: "metal" },
  BTCUSD: { displayName: "Bitcoin", pair: "BTC/USD", category: "crypto" },
  ETHUSD: { displayName: "Ethereum", pair: "ETH/USD", category: "crypto" },
  SOLUSD: { displayName: "Solana", pair: "SOL/USD", category: "crypto" },
  XRPUSD: { displayName: "XRP", pair: "XRP/USD", category: "crypto" },
  EURUSD: { displayName: "EUR/USD", pair: "EUR/USD", category: "forex" },
  GBPUSD: { displayName: "GBP/USD", pair: "GBP/USD", category: "forex" },
  USDJPY: { displayName: "USD/JPY", pair: "USD/JPY", category: "forex" },
};

/** BRIEF_V2=on enables the brief; BRIEF_V2_SYMBOLS (comma list, default: all of BRIEF_MARKETS) narrows it. */
export function briefEnabledFor(symbol: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.BRIEF_V2 ?? "").trim().toLowerCase() !== "on") return false;
  const list = (env.BRIEF_V2_SYMBOLS?.trim() ? env.BRIEF_V2_SYMBOLS : Object.keys(BRIEF_MARKETS).join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.includes(symbol.toUpperCase()) && symbol.toUpperCase() in BRIEF_MARKETS;
}

export interface BriefAssets {
  facts: BriefFacts;
  previous: PreviousBrief | null;
  chartUrl: string;
  week: WeekStats;
}

/** Loads candles, builds the facts, renders and uploads the chart. Null when anything needed is missing. */
export async function loadBriefAssets(symbol: string, events: BriefEventInput[] = []): Promise<BriefAssets | null> {
  const market = BRIEF_MARKETS[symbol.toUpperCase()];
  if (!market) return null;
  if (!getCanonicalInstrument(symbol)) await ensureExnessInstrumentRegistered(symbol);
  if (!getCanonicalInstrument(symbol)) return null;
  const series = await marketData.getTimeSeriesWithProvenance({ symbol, interval: PROVIDER_INTERVAL["1h"], outputSize: 1000 });
  const { candles } = normalizeCandles(series.candles);
  if (candles.length < 324) return null;

  const input: Omit<BriefInput, "candles"> = { symbol, displayName: market.displayName, pair: market.pair, category: market.category, timeframeLabel: "H1" };
  const facts = buildBriefFacts({ ...input, candles, events });
  if (!facts) return null;

  // "yesterday's check": the levels the brief would have shown 24 hours ago, against what price did since (all from the same candles)
  let previous: PreviousBrief | null = null;
  const prevCandles = candles.slice(0, candles.length - 24);
  const prevFacts = prevCandles.length >= 300 ? buildBriefFacts({ ...input, candles: prevCandles }) : null;
  if (prevFacts) {
    const after = candles.slice(prevCandles.length);
    previous = { levels: prevFacts.scenarioLevels, high: Math.max(...after.map((k) => k.high)), low: Math.min(...after.map((k) => k.low)), close: after[after.length - 1].close };
  }

  // the last 5 trading days (120 hourly bars) for the weekly review
  const wk = candles.slice(-120);
  const week: WeekStats = { high: Math.max(...wk.map((k) => k.high)), low: Math.min(...wk.map((k) => k.low)), changePct: ((wk[wk.length - 1].close - wk[0].open) / wk[0].open) * 100, bars: wk.length };

  const chart = await renderBriefChartPng({ candles, pair: market.pair, timeframeLabel: "H1", size: "blog" });
  const chartUrl = await uploadBriefChart({ symbol, dateIso: new Date(facts.asOfMs).toISOString(), size: "blog", png: chart.png });
  return { facts, previous, chartUrl, week };
}

export async function buildDailyBrief(symbol: string, events: BriefEventInput[] = []): Promise<{ title: string; summary: string; sections: ArticleSection[] } | null> {
  const a = await loadBriefAssets(symbol, events);
  if (!a) return null;
  const built = buildBriefSections(a.facts, { chartUrl: a.chartUrl, previous: a.previous });
  return { title: built.title, summary: built.summary, sections: built.sections };
}
