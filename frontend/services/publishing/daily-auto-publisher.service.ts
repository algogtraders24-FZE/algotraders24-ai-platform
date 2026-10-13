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
import type { EconomicEvent } from "@/types/economic-calendar";
import { buildSeo } from "@/services/ai/publishing/seo.service";
import { escapeHtml } from "@/services/telegram/client";

/** analysis = daily instrument report; fundamental = macro-driver focus; calendar = deterministic weekly event preview; weekly = multi-asset review. */
export type ReportKind = "analysis" | "fundamental" | "calendar" | "weekly";

export interface DailyReportSpec {
  kind?: ReportKind;
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

const FUNDAMENTAL_GOLD: DailyReportSpec = {
  kind: "fundamental",
  category: "fundamental-analysis",
  symbol: "XAUUSD",
  label: "Gold (XAU/USD)",
  keywords: ["gold fundamentals", "xauusd", "fundamental analysis"],
};
const FUNDAMENTAL_EUR: DailyReportSpec = {
  kind: "fundamental",
  category: "fundamental-analysis",
  symbol: "EURUSD",
  label: "EUR/USD",
  keywords: ["eurusd fundamentals", "euro dollar", "fundamental analysis"],
};
const CALENDAR_PREVIEW: DailyReportSpec = {
  kind: "calendar",
  category: "economic-preview",
  symbol: "CALENDAR",
  label: "Economic Calendar",
  keywords: ["economic calendar", "high impact news", "forex news this week"],
};
const WEEKLY_REVIEW: DailyReportSpec = {
  kind: "weekly",
  category: "weekly-review",
  symbol: "WEEKLY",
  label: "Weekly",
  keywords: ["weekly market review", "gold eurusd bitcoin", "market outlook"],
};
/** The assets covered by the Sunday weekly review. */
const WEEKLY_ASSETS: { symbol: string; label: string }[] = [
  { symbol: "XAUUSD", label: "Gold (XAU/USD)" },
  { symbol: "EURUSD", label: "EUR/USD" },
  { symbol: "BTCUSD", label: "Bitcoin (BTC/USD)" },
];

/**
 * Which reports to write on a given UTC date (at most 4):
 *  - Mon-Fri: gold + that day's forex pair + a rotating crypto pair
 *  - Mon: + Economic Calendar Preview (deterministic, no AI)
 *  - Tue/Thu: + a Fundamental Analysis report (gold / EUR/USD)
 *  - Sat: crypto only (gold/forex closed - a "daily" report would restate Friday's close)
 *  - Sun: crypto + the Weekly Market Review
 */
export function planDailyReports(date: Date): DailyReportSpec[] {
  const weekday = date.getUTCDay(); // 0 = Sunday
  const dayNumber = Math.floor(date.getTime() / 86_400_000);
  const crypto = CRYPTO_ROTATION[dayNumber % CRYPTO_ROTATION.length];
  if (weekday === 6) return [crypto];
  if (weekday === 0) return [crypto, WEEKLY_REVIEW];
  const plan = [GOLD, FOREX_BY_WEEKDAY[weekday], crypto];
  if (weekday === 1) plan.push(CALENDAR_PREVIEW);
  if (weekday === 2) plan.push(FUNDAMENTAL_GOLD);
  if (weekday === 4) plan.push(FUNDAMENTAL_EUR);
  return plan;
}

export function reportTitle(spec: DailyReportSpec, date: Date): string {
  switch (spec.kind ?? "analysis") {
    case "calendar":
      return `Economic Calendar Preview - Week of ${formatReportDate(date)}`;
    case "weekly":
      return `Weekly Market Review - Week Ending ${formatReportDate(date)}`;
    case "fundamental":
      return `${spec.label} Fundamental Analysis - ${formatReportDate(date)}`;
    default: {
      const kind = spec.category === "gold-analysis" ? "Analysis" : spec.category === "forex-analysis" ? "Forex Analysis" : "Crypto Analysis";
      return `${spec.label} ${kind} - ${formatReportDate(date)}`;
    }
  }
}

/**
 * The /blog renders article text as PLAIN text (never HTML), so the AI's markdown would show as raw
 * asterisks. Strip bold/italic/heading markers, turn "* item" bullets into "- item", and drop a
 * leading "Here is ...:" chat preamble.
 */
export function toPlainText(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*[*+]\s+/, "- ")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/`+/g, "")
        .trimEnd(),
    );
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  if (lines.length > 1 && /^here('s| is| are)\b.*:$/i.test(lines[0].trim())) lines.shift();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  const overview = toPlainText(result.summary);
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
    summary: toPlainText(ex.executiveSummary && ex.executiveSummary.trim().length >= 20 ? ex.executiveSummary : overview).slice(0, 300),
    sections: [
      { heading: spec.kind === "fundamental" ? "Fundamental Overview" : "Market Overview", body: overview },
      { heading: "Evidence Behind This Reading", body: evidenceParts.join("\n\n") },
      { heading: "Risk, Confidence and Limits", body: riskParts.join("\n\n") },
    ],
  };
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** The week's high-impact events as a plain-text schedule. Deterministic: only fields the feed carries; null when there is nothing to show. */
export function buildCalendarContent(
  spec: DailyReportSpec,
  date: Date,
  events: readonly EconomicEvent[],
): { title: string; summary: string; sections: ArticleSection[] } | null {
  const high = events
    .filter((e) => e.impact === "high" && !e.isHoliday)
    .slice()
    .sort((x, y) => x.eventTime.localeCompare(y.eventTime));
  if (high.length < 3) return null;

  const detail = (e: EconomicEvent): string => {
    const parts: string[] = [];
    if (e.forecast) parts.push(`forecast ${e.forecast}`);
    if (e.previous) parts.push(`previous ${e.previous}`);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
  };

  const byDay = new Map<string, string[]>();
  for (const e of high) {
    const t = new Date(e.eventTime);
    const key = `${WEEKDAY_NAMES[t.getUTCDay()]} ${formatReportDate(t)}`;
    const line = `- ${two(t.getUTCHours())}:${two(t.getUTCMinutes())} UTC - ${e.currency} - ${e.title}${detail(e)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), line]);
  }
  const schedule = [...byDay.entries()].map(([day, lines]) => `${day}\n${lines.join("\n")}`).join("\n\n");

  const perCurrency = new Map<string, number>();
  for (const e of high) perCurrency.set(e.currency, (perCurrency.get(e.currency) ?? 0) + 1);
  const focus = [...perCurrency.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}: ${n} high-impact release${n === 1 ? "" : "s"}`);

  return {
    title: reportTitle(spec, date),
    summary: `${high.length} high-impact economic releases are scheduled this week, led by ${focus[0].split(":")[0]}. Times are UTC.`,
    sections: [
      { heading: "High-Impact Events This Week", body: schedule },
      { heading: "Currencies in Focus", body: `${focus.join("\n")}\n\nMore scheduled releases for a currency means more potential for volatility in the pairs and metals that trade against it.` },
      {
        heading: "How to Read This Calendar",
        body:
          "Impact ratings come from the calendar feed and describe how much a release has historically moved prices, not which direction it will move them. Forecast and previous values are the feed's consensus and prior reading; the actual release can differ. All times are UTC, and scheduled times can change - confirm close to the release. This page is general information, not a trading recommendation.",
      },
    ],
  };
}

/** Sunday roundup: one section per asset that analysed successfully, plus a shared risk section. Null with fewer than 2 assets. */
export function buildWeeklyContent(
  spec: DailyReportSpec,
  date: Date,
  parts: { label: string; outcome: CompletedOutcome }[],
): { title: string; summary: string; sections: ArticleSection[] } | null {
  if (parts.length < 2) return null;
  const sections: ArticleSection[] = parts.map((p) => ({ heading: p.label, body: toPlainText(p.outcome.result.summary) }));
  const riskLines = parts
    .map((p) => {
      const ex = p.outcome.result.explainable;
      return `${p.label}: ${[ex.riskSummary, ex.confidenceSummary].filter((x) => x && x.trim().length > 0).join(" ")}`;
    })
    .filter((l) => l.length > 0);
  if (sections.some((s) => s.body.length === 0) || riskLines.length === 0) return null;
  sections.push({
    heading: "Risk, Confidence and Limits",
    body: `${riskLines.join("\n\n")}\n\nThese readings restate computed evidence at the time of writing and can change quickly. They are general information, not a trading recommendation.`,
  });
  return {
    title: reportTitle(spec, date),
    summary: `This week's evidence-based read on ${parts.map((p) => p.label).join(", ")}, with the risk and confidence behind each reading.`,
    sections,
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
  /** This week's calendar events (all impacts; the builder filters). */
  getCalendarEvents: () => Promise<readonly EconomicEvent[]>;
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

        const content = await this.buildContent(spec, date);
        if ("skip" in content) {
          results.push({ ...base, status: "skipped", reason: content.skip });
          continue;
        }

        const article = await this.deps.createDraft({ category: spec.category, keywords: spec.keywords, custom: content.content });
        await this.deps.publishNow(article.id);
        results.push({ ...base, status: "published", articleId: article.id });
      } catch (err) {
        results.push({ ...base, status: "failed", reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { date: date.toISOString(), results };
  }

  private async buildContent(
    spec: DailyReportSpec,
    date: Date,
  ): Promise<{ content: { title: string; summary: string; sections: ArticleSection[] } } | { skip: string }> {
    const kind = spec.kind ?? "analysis";

    if (kind === "calendar") {
      const content = buildCalendarContent(spec, date, await this.deps.getCalendarEvents());
      return content ? { content } : { skip: "fewer than 3 high-impact events in the feed" };
    }

    if (kind === "weekly") {
      const parts: { label: string; outcome: CompletedOutcome }[] = [];
      for (const asset of WEEKLY_ASSETS) {
        const outcome = await this.deps.analyze(
          asset.symbol,
          `Summarise the past week and the current evidence for ${asset.label}: what drove it, key levels, and the main risks. Use hedged, evidence-based language - never a directive to buy or sell.`,
        );
        if (outcome.status === "completed") parts.push({ label: asset.label, outcome });
      }
      const content = buildWeeklyContent(spec, date, parts);
      return content ? { content } : { skip: "fewer than 2 assets analysed" };
    }

    const question =
      kind === "fundamental"
        ? `Explain the fundamental drivers for ${spec.label}: macro data, central-bank expectations, real yields and the dollar, news flow, and what could change the picture. Focus on fundamentals, not chart patterns. Use hedged, evidence-based language - never a directive to buy or sell.`
        : `Write today's market report for ${spec.label}: current structure, key levels, what could change the picture, and risks. Use hedged, evidence-based language - never a directive to buy or sell.`;
    const outcome = await this.deps.analyze(spec.symbol, question);
    if (outcome.status !== "completed") return { skip: `analysis ${outcome.status}` };
    const content = buildReportContent(spec, date, outcome);
    return content ? { content } : { skip: "analysis had no usable content" };
  }
}

/**
 * The owner's Telegram summary of one run (HTML, every dynamic value escaped). Doubles as the monitor:
 * a skipped or failed report is otherwise visible only in Vercel logs.
 */
export function dailyRunTelegramMessage(results: readonly DailyReportResult[], siteUrl: string): string {
  const icon: Record<DailyReportStatus, string> = { published: "OK", "already-exists": "SAME", skipped: "SKIPPED", failed: "FAILED" };
  const lines = results.map((r) => {
    const url = `${siteUrl}/blog/${buildSeo(r.title, []).slug}`;
    const head = r.status === "published" || r.status === "already-exists" ? `<a href="${escapeHtml(url)}">${escapeHtml(r.title)}</a>` : escapeHtml(r.title);
    return `${icon[r.status]} - ${head}${r.reason ? ` (${escapeHtml(r.reason.slice(0, 120))})` : ""}`;
  });
  const bad = results.filter((r) => r.status === "skipped" || r.status === "failed").length;
  return `<b>AT24 daily blog run</b>${bad > 0 ? ` - ${bad} need attention` : ""}\n${lines.join("\n")}`;
}
