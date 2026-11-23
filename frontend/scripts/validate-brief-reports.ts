// scripts/validate-brief-reports.ts
// Market Brief 2.0 report types (offline, deterministic): Economic Calendar Preview, Weekly Market Review, Fundamental Analysis.
// Checks: the real publish validator, unique non-empty headings, createDraft's body rules, forbidden wording, disclaimer, fallbacks (null).
// Run: npx tsx scripts/validate-brief-reports.ts
import { readFileSync } from "node:fs";
import { validateArticle } from "../services/ai/publishing/article-validator.service";
import { buildSeo } from "../services/ai/publishing/seo.service";
import type { Article, ArticleSection } from "../types/article";
import type { EconomicEvent } from "../types/economic-calendar";
import type { ChartCandle } from "../types/chart-data";
import { buildBriefFacts } from "../lib/publishing/brief/facts";
import { buildCalendarBrief, buildFundamentalBrief, buildWeeklyBrief, eventsForSymbol, istStamp, type BuiltReport } from "../lib/publishing/brief/report-builders";

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.log("FAIL:", msg); } }
const PRINT = process.argv.includes("--print");
const FORBIDDEN = /\b(guaranteed|risk[- ]free|sure[- ]shot|100% accuracy|will (rise|fall|go up|go down|reach|hit)|win[- ]?rate|no edge|failed|fails|passed the test|buy now|sell now)\b/i;
const PLACEHOLDER = ["lorem ipsum", "[insert", "todo:", "xxx", "placeholder text"];

function fixture(name: string): ChartCandle[] { return JSON.parse(readFileSync(`scripts/fixtures/brief/${name}_H1.json`, "utf8")); }

function check(name: string, r: BuiltReport | null, title: string) {
  ok(!!r, `${name}: built`);
  if (!r) return;
  const hd = r.sections.map((s) => s.heading.trim().toLowerCase());
  ok(hd.every((h) => h.length > 0) && new Set(hd).size === hd.length, `${name}: headings non-empty and unique (${hd.join(" | ")})`);
  ok(r.sections.every((s) => s.body.trim().length >= 40), `${name}: every body >= 40 chars: ${r.sections.filter((s) => s.body.trim().length < 40).map((s) => s.heading).join(", ")}`);
  ok(r.sections.every((s) => !PLACEHOLDER.some((m) => s.body.toLowerCase().includes(m))), `${name}: no placeholder markers`);
  const seo = buildSeo(title, ["x analysis", "x forecast", "x levels"]);
  const v = validateArticle({ sections: r.sections as ArticleSection[], disclaimer: "d", summary: r.summary, seo } as unknown as Article);
  ok(v.issues.filter((i) => !/SEO|keywords/i.test(i)).length === 0, `${name}: publish validator: ${v.issues.join("; ")}`);
  const text = [r.summary, ...r.sections.flatMap((s) => [s.heading, s.body, ...(s.bullets ?? []), ...(s.cards?.flatMap((c) => [c.title, c.body]) ?? []), ...(s.chips?.flatMap((c) => [c.value, c.label]) ?? [])])].join("\n");
  ok(!FORBIDDEN.test(text), `${name}: forbidden wording: ${text.match(FORBIDDEN)?.[0]}`);
  ok(/not financial advice/i.test(text), `${name}: disclaimer`);
  ok(r.summary.length >= 20 && r.summary.length <= 300, `${name}: summary length ${r.summary.length}`);
  console.log(`${name}: ${r.sections.length} sections ok`);
  if (PRINT) for (const s of r.sections) console.log(`\n[${s.kind}] ${s.heading}\n${s.body}`);
}

// ---- calendar ----------------------------------------------------------------------------------------------------------------
const mk = (iso: string, cur: string, title: string, impact: EconomicEvent["impact"] = "high", extra: Partial<EconomicEvent> = {}): EconomicEvent =>
  ({ id: iso + title, title, currency: cur, impact, isHoliday: false, eventTime: iso, allDay: false, forecast: null, previous: null, ...extra } as EconomicEvent);
const MON = new Date("2026-11-23T06:15:00Z");
const events = [
  mk("2026-11-23T14:30:00Z", "USD", "Flash Manufacturing PMI", "high", { forecast: "52.1", previous: "51.8" }),
  mk("2026-11-24T13:30:00Z", "USD", "CB Consumer Confidence"),
  mk("2026-11-25T13:30:00Z", "USD", "Core PCE Price Index", "high", { forecast: "0.2%", previous: "0.3%" }),
  mk("2026-11-25T09:00:00Z", "EUR", "German Ifo Business Climate"),
  mk("2026-11-26T12:30:00Z", "USD", "Unemployment Claims"),
  mk("2026-11-26T09:00:00Z", "EUR", "Minor release", "low"),
];
check("calendar", buildCalendarBrief(MON, events), "Economic Calendar Preview - Week of 23 Nov 2026");
ok(buildCalendarBrief(MON, events.slice(0, 2)) === null, "calendar: fewer than 3 high-impact events returns null (fallback)");
ok(istStamp(new Date("2026-11-23T13:30:00Z")) === "Mon 23 Nov, 7:00 PM IST", `istStamp: ${istStamp(new Date("2026-11-23T13:30:00Z"))}`);
const near = eventsForSymbol("EURUSD", events, new Date("2026-11-25T06:00:00Z"));
ok(near.length === 3 && near[0].title === "German Ifo Business Climate" && near.every((x) => ["EUR", "USD"].includes(x.currency ?? "")), `eventsForSymbol picks EUR+USD within 48h, max 3, earliest first: ${near.map((e) => e.title).join(", ")}`);
ok(eventsForSymbol("XAUUSD", events, new Date("2026-11-25T06:00:00Z")).every((e) => e.currency === "USD"), "eventsForSymbol Gold = USD only");

// ---- weekly + fundamental ----------------------------------------------------------------------------------------------------
const CH = "https://example.invalid/chart.png";
const mkFacts = (file: string, name: string, pair: string, category: "crypto" | "metal" | "forex") => {
  const candles = fixture(file);
  const facts = buildBriefFacts({ symbol: file, displayName: name, pair, category, timeframeLabel: "H1", candles })!;
  const wk = candles.slice(-120);
  return { facts, week: { high: Math.max(...wk.map((k) => k.high)), low: Math.min(...wk.map((k) => k.low)), changePct: ((wk[wk.length - 1].close - wk[0].open) / wk[0].open) * 100, bars: wk.length } };
};
const g = mkFacts("XAUUSD", "Gold", "XAU/USD", "metal");
const b = mkFacts("BTCUSD", "Bitcoin", "BTC/USD", "crypto");
const e = mkFacts("EURUSD", "EUR/USD", "EUR/USD", "forex");
check("weekly", buildWeeklyBrief(new Date("2026-11-22T06:15:00Z"), [{ label: "Gold", chartUrl: CH, ...g }, { label: "EUR/USD", chartUrl: CH, ...e }, { label: "Bitcoin", chartUrl: CH, ...b }]), "Weekly Market Review - Week Ending 22 Nov 2026");
ok(buildWeeklyBrief(new Date(), [{ label: "Gold", chartUrl: CH, ...g }]) === null, "weekly: fewer than 2 assets returns null (fallback)");

const fund = (over: Partial<Parameters<typeof buildFundamentalBrief>[0]> = {}) => buildFundamentalBrief({
  facts: g.facts,
  chartUrl: CH,
  overview: "Gold is supported by easing Treasury yields and a softer dollar, while a firm equity tone limits safe-haven demand.",
  supporting: ["Treasury yields eased over the last session, which supports gold.", "The dollar index slipped, a tailwind for dollar-priced metals."],
  opposing: ["Risk appetite is firm, which reduces demand for safe havens."],
  unknown: ["The next central-bank speaker schedule is not in the data."],
  risk: ["Overall risk is medium.", "Confidence is moderate."],
  events: [{ whenIst: "Mon 23 Nov, 7:00 PM IST", title: "Flash Manufacturing PMI", currency: "USD", forecast: "52.1", previous: "51.8" }],
  ...over,
});
check("fundamental", fund(), "Gold (XAU/USD) Fundamental Analysis - 24 Nov 2026");
check("fundamental (no events, no unknowns)", fund({ events: [], unknown: [] }), "Gold (XAU/USD) Fundamental Analysis - 24 Nov 2026");
ok(fund({ supporting: [], opposing: [] }) === null, "fundamental: no evidence returns null (fallback)");
ok(fund({ overview: "short" }) === null, "fundamental: short overview returns null (fallback)");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
