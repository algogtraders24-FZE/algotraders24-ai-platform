// lib/publishing/brief/brief-pipeline.ts
// Market Brief 2.0: one call that turns a symbol into a finished article (chart uploaded + structured sections).
// Used by the daily auto-publisher behind the BRIEF_V2 flag. Returns null when anything is missing (too few candles, no facts,
// chart upload failed): the caller then publishes the previous report format instead, so a brief problem never blocks the day.
import type { ArticleSection } from "@/types/article";
import { marketData } from "@/services/market-data/shared-instance";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { normalizeCandles } from "@/lib/chart-engine/candle-normalizer";
import { buildBriefFacts, type BriefInput } from "./facts";
import { buildBriefSections, type PreviousBrief } from "./templates";
import { renderBriefChartPng } from "./brief-chart";
import { uploadBriefChart } from "./brief-storage";

export interface BriefMarket { displayName: string; pair: string; category: BriefInput["category"] }

/** Markets the brief supports so far (phase 4 starts with Gold and Bitcoin). */
export const BRIEF_MARKETS: Record<string, BriefMarket> = {
  XAUUSD: { displayName: "Gold", pair: "XAU/USD", category: "metal" },
  BTCUSD: { displayName: "Bitcoin", pair: "BTC/USD", category: "crypto" },
};

/** BRIEF_V2=on enables the brief; BRIEF_V2_SYMBOLS (comma list, default XAUUSD,BTCUSD) narrows it. */
export function briefEnabledFor(symbol: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.BRIEF_V2 ?? "").trim().toLowerCase() !== "on") return false;
  const list = (env.BRIEF_V2_SYMBOLS ?? "XAUUSD,BTCUSD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.includes(symbol.toUpperCase()) && symbol.toUpperCase() in BRIEF_MARKETS;
}

export async function buildDailyBrief(symbol: string): Promise<{ title: string; summary: string; sections: ArticleSection[] } | null> {
  const market = BRIEF_MARKETS[symbol.toUpperCase()];
  if (!market || !getCanonicalInstrument(symbol)) return null;
  const series = await marketData.getTimeSeriesWithProvenance({ symbol, interval: PROVIDER_INTERVAL["1h"], outputSize: 1000 });
  const { candles } = normalizeCandles(series.candles);
  if (candles.length < 324) return null;

  const input: Omit<BriefInput, "candles"> = { symbol, displayName: market.displayName, pair: market.pair, category: market.category, timeframeLabel: "H1" };
  const facts = buildBriefFacts({ ...input, candles });
  if (!facts) return null;

  // "yesterday's check": the levels the brief would have shown 24 hours ago, against what price did since (all from the same candles)
  let previous: PreviousBrief | null = null;
  const prevCandles = candles.slice(0, candles.length - 24);
  const prevFacts = prevCandles.length >= 300 ? buildBriefFacts({ ...input, candles: prevCandles }) : null;
  if (prevFacts) {
    const after = candles.slice(prevCandles.length);
    previous = { levels: prevFacts.scenarioLevels, high: Math.max(...after.map((k) => k.high)), low: Math.min(...after.map((k) => k.low)), close: after[after.length - 1].close };
  }

  const chart = await renderBriefChartPng({ candles, pair: market.pair, timeframeLabel: "H1", size: "blog" });
  const chartUrl = await uploadBriefChart({ symbol, dateIso: new Date(facts.asOfMs).toISOString(), size: "blog", png: chart.png });
  const built = buildBriefSections(facts, { chartUrl, previous });
  return { title: built.title, summary: built.summary, sections: built.sections };
}
