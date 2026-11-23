// lib/publishing/brief/report-builders.ts
// Market Brief 2.0 for the three other report types: Economic Calendar Preview, Weekly Market Review and Fundamental Analysis.
// Pure functions (no database, no network): the caller passes the data and the already-uploaded chart URLs. Same section kinds as the daily
// brief, so the blog page renders them with the same blocks. Every number comes from the inputs; wording is plain, positive-neutral, education only.
import type { ArticleSection } from "@/types/article";
import type { EconomicEvent } from "@/types/economic-calendar";
import { formatPrice } from "@/lib/financial-format";
import type { BriefEventInput, BriefFacts } from "./facts";
import { buildBriefSections } from "./templates";

export interface BuiltReport { title: string; summary: string; sections: ArticleSection[] }

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DISCLAIMER = "Education only, not financial advice.";
const two = (n: number) => String(n).padStart(2, "0");

/** "7:00 PM" in IST (UTC+5:30). */
export function istClock(d: Date): string {
  const t = new Date(d.getTime() + 330 * 60_000);
  const h = t.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${two(t.getUTCMinutes())} ${h >= 12 ? "PM" : "AM"}`;
}
/** "Mon 23 Nov, 7:00 PM IST". */
export function istStamp(d: Date): string {
  const t = new Date(d.getTime() + 330 * 60_000);
  return `${WEEKDAYS[t.getUTCDay()].slice(0, 3)} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${istClock(d)} IST`;
}
function dateLine(d: Date): string {
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Currencies whose releases matter for a market (used to pick the "next on the calendar" lines). */
const EVENT_CURRENCIES: Record<string, string[]> = {
  XAUUSD: ["USD"], BTCUSD: ["USD"], ETHUSD: ["USD"], SOLUSD: ["USD"], XRPUSD: ["USD"],
  EURUSD: ["EUR", "USD"], GBPUSD: ["GBP", "USD"], USDJPY: ["USD", "JPY"],
};

/** The next high-impact releases (next 48 hours, at most 3) for the currencies behind a market, formatted in IST. */
export function eventsForSymbol(symbol: string, events: readonly EconomicEvent[], now: Date): BriefEventInput[] {
  const cur = EVENT_CURRENCIES[symbol.toUpperCase()] ?? ["USD"];
  const from = now.getTime();
  const to = from + 48 * 3600_000;
  return events
    .filter((e) => e.impact === "high" && !e.isHoliday && cur.includes(e.currency))
    .filter((e) => { const t = new Date(e.eventTime).getTime(); return t >= from && t <= to; })
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime))
    .slice(0, 3)
    .map((e) => ({ whenIst: istStamp(new Date(e.eventTime)), title: e.title, currency: e.currency, forecast: e.forecast ?? undefined, previous: e.previous ?? undefined }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Economic Calendar Preview
// ---------------------------------------------------------------------------------------------------------------------------------
export function buildCalendarBrief(date: Date, events: readonly EconomicEvent[]): BuiltReport | null {
  const high = events.filter((e) => e.impact === "high" && !e.isHoliday).slice().sort((a, b) => a.eventTime.localeCompare(b.eventTime));
  if (high.length < 3) return null;

  const detail = (e: EconomicEvent) => {
    const p: string[] = [];
    if (e.forecast) p.push(`forecast ${e.forecast}`);
    if (e.previous) p.push(`previous ${e.previous}`);
    return p.length ? ` (${p.join(", ")})` : "";
  };

  const byDay = new Map<string, { label: string; lines: string[] }>();
  for (const e of high) {
    const t = new Date(e.eventTime);
    const key = t.toISOString().slice(0, 10);
    const label = `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
    const line = `${two(t.getUTCHours())}:${two(t.getUTCMinutes())} UTC (${istClock(t)} IST): ${e.currency} ${e.title}${detail(e)}`;
    const slot = byDay.get(key) ?? { label, lines: [] };
    slot.lines.push(line);
    byDay.set(key, slot);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

  const perCur = new Map<string, number>();
  for (const e of high) perCur.set(e.currency, (perCur.get(e.currency) ?? 0) + 1);
  const curRank = [...perCur.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const busiest = days.slice().sort((a, b) => b.lines.length - a.lines.length)[0];

  const sections: ArticleSection[] = [];
  sections.push({
    heading: `${high.length} high-impact releases scheduled this week`,
    kind: "headline",
    body: `Week of ${dateLine(date)} · times in UTC and IST · by Algotraders24 AI (rule-based system)`,
  });
  const chips = [
    { value: String(high.length), label: "high-impact releases this week" },
    { value: curRank[0][0], label: `most releases: ${curRank[0][1]} this week` },
    { value: busiest.label, label: `busiest day: ${busiest.lines.length} releases` },
  ];
  sections.push({ heading: "Key numbers", kind: "chips", chips, body: chips.map((c) => `${c.value}: ${c.label}`).join(" | ") });
  for (const d of days) sections.push({ heading: d.label, kind: "bullets", bullets: d.lines, body: d.lines.map((l) => `- ${l}`).join("\n") });
  const focus = curRank.map(([c, n]) => `${c}: ${n} high-impact release${n === 1 ? "" : "s"}`);
  const more = "More scheduled releases for a currency means more potential for movement in the pairs and metals that trade against it.";
  sections.push({
    heading: "Currencies in focus",
    kind: "bullets",
    bullets: [...focus, more],
    body: `${focus.map((l) => `- ${l}`).join("\n")}\n- ${more}`,
  });
  sections.push({
    heading: "How to read this calendar",
    kind: "learn",
    body: "Impact ratings come from the calendar feed and describe how much a release has historically moved prices, not which way it will move them. Forecast and previous values are the feed's consensus and prior reading; the actual release can differ. Scheduled times can change, so confirm close to the release. Watch the lesson \"The Economic Calendar\".",
  });
  sections.push({
    heading: "How this is made",
    kind: "footer",
    body: `The schedule comes from the economic-calendar feed and is listed without changes; counts are computed from it. ${DISCLAIMER}`,
  });

  return {
    title: `Economic Calendar Preview - Week of ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    summary: `${high.length} high-impact economic releases are scheduled this week, led by ${curRank[0][0]}. Times in UTC and IST.`,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Weekly Market Review
// ---------------------------------------------------------------------------------------------------------------------------------
export interface WeekStats { high: number; low: number; changePct: number; bars: number }
export interface WeeklyPart { label: string; facts: BriefFacts; chartUrl: string; week: WeekStats }

const fmtP = (n: number) => formatPrice(n, { maxDecimals: Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 100 ? 3 : Math.abs(n) >= 10 ? 4 : 5 });
const priceText = (f: BriefFacts, n: number) => (f.category === "forex" ? fmtP(n) : Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : fmtP(n));
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function buildWeeklyBrief(date: Date, parts: WeeklyPart[]): BuiltReport | null {
  if (parts.length < 2) return null;
  const names = parts.map((p) => p.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const sections: ArticleSection[] = [];
  sections.push({ heading: `The week in ${parts.length} markets: ${list}`, kind: "headline", body: `${dateLine(date)} · the last 120 hourly candles · by Algotraders24 AI (rule-based system)` });
  const chips = parts.map((p) => ({ value: priceText(p.facts, p.facts.price), label: `${p.label}, ${signed(p.week.changePct)} over the last 120 hours` }));
  sections.push({ heading: "Key numbers", kind: "chips", chips, body: chips.map((c) => `${c.value}: ${c.label}`).join(" | ") });

  for (const p of parts) {
    const built = buildBriefSections(p.facts, { chartUrl: p.chartUrl });
    const hero = built.sections.find((s) => s.kind === "hero");
    const tech = built.sections.find((s) => s.kind === "bullets");
    if (hero) sections.push({ ...hero, heading: `${p.label} chart` });
    const bullets = [
      `The week: ${p.label} moved ${signed(p.week.changePct)}, between a low of ${priceText(p.facts, p.week.low)} and a high of ${priceText(p.facts, p.week.high)}.`,
      ...(tech?.bullets ?? []).filter((b) => !/^Yesterday's range/.test(b)).slice(0, 4),
    ];
    sections.push({ heading: `${p.label}: the week and the picture`, kind: "bullets", bullets, body: bullets.map((b) => `- ${b}`).join("\n") });
  }
  sections.push({
    heading: "How to use the weekly picture",
    kind: "learn",
    body: "A weekly review sets the background: which way each market moved, where its nearest levels are, and how active it was. The daily reports then add the detail. Levels are areas to study, not forecasts. Watch the lesson \"Trend and Market Structure\".",
  });
  sections.push({
    heading: "How this is made",
    kind: "footer",
    body: `A rule-based system reads each market's hourly candles; every number comes from the same computed facts that draw the charts. These readings describe what already happened and can change quickly. ${DISCLAIMER}`,
  });
  return {
    title: "",
    summary: `This week's picture for ${list}: how far each market moved, where its nearest levels are and how active it was.`,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fundamental Analysis
// ---------------------------------------------------------------------------------------------------------------------------------
export interface FundamentalInput {
  facts: BriefFacts;
  chartUrl: string;
  /** Plain text (no markdown). */
  overview: string;
  supporting: string[];
  opposing: string[];
  unknown: string[];
  risk: string[];
  events: BriefEventInput[];
}

export function buildFundamentalBrief(inp: FundamentalInput): BuiltReport | null {
  const { facts: f } = inp;
  if (inp.overview.trim().length < 40 || (inp.supporting.length === 0 && inp.opposing.length === 0) || inp.risk.length === 0) return null;
  const base = buildBriefSections({ ...f, events: inp.events }, { chartUrl: inp.chartUrl });
  const chips = base.sections.find((s) => s.kind === "chips");
  const hero = base.sections.find((s) => s.kind === "hero");
  const d = new Date(f.asOfMs);
  const sections: ArticleSection[] = [];
  sections.push({ heading: `${f.displayName}: what the fundamentals say today`, kind: "headline", body: `${dateLine(d)} · latest hourly candle ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC · by Algotraders24 AI (rule-based system with an AI summary)` });
  if (chips) sections.push(chips);
  if (hero) sections.push(hero);
  sections.push({ heading: "The overview", kind: "fit", body: inp.overview });
  const list = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    const b = items.slice(0, 8);
    sections.push({ heading, kind: "bullets", bullets: b, body: b.map((x) => `- ${x}`).join("\n") });
  };
  list("What supports the picture", inp.supporting);
  list("What points the other way", inp.opposing);
  list("What is still unknown", inp.unknown);
  if (inp.events.length) {
    const ev = inp.events.map((e) => `${e.title} (${e.whenIst})${e.forecast ? `, forecast ${e.forecast}` : ""}${e.previous ? `, previous ${e.previous}` : ""}.`);
    sections.push({ heading: "Next on the calendar", kind: "bullets", bullets: ev, body: ev.map((x) => `- ${x}`).join("\n") });
  }
  sections.push({ heading: "Risk, confidence and limits", kind: "check", body: inp.risk.join(" ") });
  sections.push({
    heading: "Learn in 30 seconds",
    kind: "learn",
    body: "Fundamentals are the news and economic data behind a price: central-bank decisions, inflation, jobs, yields and the dollar. They explain why a market may be moving; the chart shows where. Use both together. Watch the lesson \"The Economic Calendar\".",
  });
  sections.push({
    heading: "How this is made",
    kind: "footer",
    body: `The evidence list comes from computed market data and macro drivers; an AI model restates it in plain words and adds nothing that is not in the evidence. Chart numbers come from the same computed facts that draw the chart. ${DISCLAIMER}`,
  });
  return {
    title: "",
    summary: `${f.displayName} fundamentals today: what supports the picture, what points the other way, and what is still unknown.`.slice(0, 300),
    sections,
  };
}
