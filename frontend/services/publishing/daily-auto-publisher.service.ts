// services/publishing/daily-auto-publisher.service.ts
// Daily auto-publish: once a day the cron writes a few DIFFERENT market reports
// (gold, a forex pair, a crypto pair - rotated by date) from the same live
// evidence pipeline the Market Intelligence page uses, and publishes them to /blog
// through the normal Publishing Engine (draft -> validate -> job -> attempt).
//
// Honesty rules: every report body comes from the deterministic ExplainableAnalysis
// plus the AI's restatement of it - nothing is invented here. If a symbol has no
// live data or the AI fails, that report is SKIPPED (reported as such), never
// filled with placeholder text. Re-running the same day is safe: the slug carries
// the date, and an existing article for that slug is left alone.
import type { Article, ArticleSection } from "@/types/article";
import type { ContentCategory } from "@/types/content-category";
import type { MarketAnalysisOutcome } from "@/types/market-analysis-orchestration";
import { buildSeo } from "@/services/ai/publishing/seo.service";

export interface DailyReportSpec {
  category: ContentCategory;
  symbol: string;
  /** Name used in the title, e.g. "Gold (XAU/USD)". */
  label: string;
  keywords: string[];
}

const FOREX_BY_WEEKDAY: Record<number, DailyReportSpec> = {
  1: { category: "forex-analysis", symbol: "EURUSD", label: "EUR/USD", keywords: ["eurusd", "euro dollar", "forex analysis"] },
  2: { category: "forex-analysis", symbol: "GBPUSD", label: "GBP/USD", keywords: ["gbpusd", "pound dollar", "forex analysis"] },
  3: { category: "forex-analysis", symbol: "USDJPY", label: "USD/JPY", keywords: ["usdjpy", "dollar yen", "forex analysis"] },
  4: { category: "forex-analysis", symbol: "EURUSD", label: "EUR/USD", keywords: ["eurusd", "euro dollar", "forex analysis"] },
  5: { category: "forex-analysis", symbol: "GBPUSD", label: "GBP/USD", keywords: ["gbpusd", "pound dollar", "forex analysis"] },
};

const GOLD: DailyReportSpec = {
  category: "gold-analysis",
  symbol: "XAUUSD",
  label: "Gold (XAU/USD)",
  keywords: ["gold", "xauusd", "gold analysis"],
};

const CRYPTO_ROTATION: DailyReportSpec[] = [
  { category: "crypto-analysis", symbol: "BTCUSD", label: "Bitcoin (BTC/USD)", keywords: ["bitcoin", "btcusd", "crypto analysis"] },
  { category: "crypto-analysis", symbol: "ETHUSD", label: "Ethereum (ETH/USD)", keywords: ["ethereum", "ethusd", "crypto analysis"] },
  { category: "crypto-analysis", symbol: "SOLUSD", label: "Solana (SOL/USD)", keywords: ["solana", "solusd", "crypto analysis"] },
  { category: "crypto-analysis", symbol: "XRPUSD", label: "XRP (XRP/USD)", keywords: ["xrp", "xrpusd", "crypto analysis"] },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Oct 2026" in UTC - the cron runs on a UTC clock, so the date is stable for the run. */
export function formatReportDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Which reports to write on a given UTC date. Weekdays: gold + that day's forex pair
 * + a rotating crypto pair. Weekends: crypto only (gold/forex markets are closed, so a
 * "daily" report would just restate Friday's close).
 */
export function planDailyReports(date: Date): DailyReportSpec[] {
  const weekday = date.getUTCDay(); // 0 = Sunday
  const dayNumber = Math.floor(date.getTime() / 86_400_000);
  const crypto = CRYPTO_ROTATION[dayNumber % CRYPTO_ROTATION.length];
  if (weekday === 0 || weekday === 6) return [crypto];
  return [GOLD, FOREX_BY_WEEKDAY[weekday], crypto];
}

export function reportTitle(spec: DailyReportSpec, date: Date): string {
  const kind = spec.category === "gold-analysis" ? "Analysis" : spec.category === "forex-analysis" ? "Forex Analysis" : "Crypto Analysis";
  return `${spec.label} ${kind} - ${formatReportDate(date)}`;
}

type CompletedOutcome = Extract<MarketAnalysisOutcome, { status: "completed" }>;

/** Builds the 3 sections of a report from a completed analysis. Returns null if there is no real content. */
export function buildReportContent(
  spec: DailyReportSpec,
  date: Date,
  outcome: CompletedOutcome,
): { title: string; summary: string; sections: ArticleSection[] } | null {
  const { result } = outcome;
  const ex = result.explainable;
  const overview = result.summary.trim();
  if (overview.length === 0) return null;

  const lines = (items: { text: string }[]): string => items.map((i) => `- ${i.text}`).join("\n");
  const evidenceParts: string[] = [];
  if (ex.supportingEvidence.length > 0) evidenceParts.push(`Supporting evidence:\n${lines(ex.supportingEvidence)}`);
  if (ex.opposingEvidence.length > 0) evidenceParts.push(`Opposing evidence:\n${lines(ex.opposingEvidence)}`);
  if (ex.unknownFactors.length > 0) evidenceParts.push(`Unknown factors:\n${ex.unknownFactors.map((f) => `- ${f}`).join("\n")}`);

  const riskParts = [ex.riskSummary, ex.confidenceSummary, ...ex.limitations.map((l) => `Limitation: ${l}`)].filter(
    (p) => p && p.trim().length > 0,
  );
  if (evidenceParts.length === 0 || riskParts.length === 0) return null;

  return {
    title: reportTitle(spec, date),
    summary: (ex.executiveSummary && ex.executiveSummary.trim().length >= 20 ? ex.executiveSummary : overview).slice(0, 300),
    sections: [
      { heading: "Market Overview", body: overview },
      { heading: "Evidence Behind This Reading", body: evidenceParts.join("\n\n") },
      { heading: "Risk, Confidence and Limits", body: riskParts.join("\n\n") },
    ],
  };
}

export type DailyReportStatus = "published" | "already-exists" | "skipped" | "failed";
export interface DailyReportResult {
  symbol: string;
  category: ContentCategory;
  title: string;
  status: DailyReportStatus;
  articleId?: string;
  reason?: string;
}

export interface DailyAutoPublisherDeps {
  analyze: (symbol: string, question: string) => Promise<MarketAnalysisOutcome>;
  /** True when an article with this slug already exists for the owner (deleted ones excluded). */
  slugExists: (slug: string) => Promise<boolean>;
  createDraft: (input: {
    category: ContentCategory;
    keywords: string[];
    custom: { title: string; summary: string; sections: ArticleSection[] };
  }) => Promise<Article>;
  publishNow: (articleId: string) => Promise<void>;
  now?: () => Date;
}

export class DailyAutoPublisherService {
  constructor(private readonly deps: DailyAutoPublisherDeps) {}

  async run(): Promise<{ date: string; results: DailyReportResult[] }> {
    const date = (this.deps.now ?? (() => new Date()))();
    const results: DailyReportResult[] = [];

    // Sequential on purpose: each analysis is a live-data + AI round trip, and a
    // burst would trip the provider's rate limits.
    for (const spec of planDailyReports(date)) {
      const title = reportTitle(spec, date);
      const base = { symbol: spec.symbol, category: spec.category, title };
      try {
        if (await this.deps.slugExists(buildSeo(title, spec.keywords).slug)) {
          results.push({ ...base, status: "already-exists" });
          continue;
        }

        const outcome = await this.deps.analyze(
          spec.symbol,
          `Write today's market report for ${spec.label}: current structure, key levels, what could change the picture, and risks. Use hedged, evidence-based language - never a directive to buy or sell.`,
        );
        if (outcome.status !== "completed") {
          results.push({ ...base, status: "skipped", reason: `analysis ${outcome.status}` });
          continue;
        }

        const content = buildReportContent(spec, date, outcome);
        if (!content) {
          results.push({ ...base, status: "skipped", reason: "analysis had no usable content" });
          continue;
        }

        const article = await this.deps.createDraft({ category: spec.category, keywords: spec.keywords, custom: content });
        await this.deps.publishNow(article.id);
        results.push({ ...base, status: "published", articleId: article.id });
      } catch (err) {
        results.push({ ...base, status: "failed", reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { date: date.toISOString(), results };
  }
}
