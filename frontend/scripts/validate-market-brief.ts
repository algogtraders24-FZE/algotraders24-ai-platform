// scripts/validate-market-brief.ts
// Market Brief 2.0 checks (offline, deterministic, saved candles): facts build, section order, plain-text fallback bodies, no hard-coded
// numbers (every number in the text was written by a template from the facts), forbidden wording, positive headline, disclaimer, determinism.
// Run: npx tsx scripts/validate-market-brief.ts   (add --print to see the generated post)
import { readFileSync } from "node:fs";
import { buildBriefFacts, type BriefInput } from "../lib/publishing/brief/facts";
import { buildBriefSections, type PreviousBrief } from "../lib/publishing/brief/templates";
import { validateArticle } from "../services/ai/publishing/article-validator.service";
import { buildSeo } from "../services/ai/publishing/seo.service";
import type { Article } from "../types/article";
import type { ChartCandle } from "../types/chart-data";

let failures = 0;
function ok(cond: boolean, msg: string) { if (!cond) { failures++; console.log("FAIL:", msg); } }
const PRINT = process.argv.includes("--print");

const FORBIDDEN = /\b(guaranteed|risk[- ]free|sure[- ]shot|100% accuracy|will (rise|fall|go up|go down|reach|hit)|win[- ]?rate|no edge|failed|fails|passed the test|buy now|sell now)\b/i;
const SMALL_OK = new Set([0, 1, 2, 3, 4, 5, 6, 12, 14, 20, 24, 30, 50, 100]); // constants named in the text (periods, gate size, "30 seconds")

function fixture(name: string): ChartCandle[] { return JSON.parse(readFileSync(`scripts/fixtures/brief/${name}_H1.json`, "utf8")); }

const MARKETS: { input: Omit<BriefInput, "candles">; file: string; macro?: BriefInput["macro"]; events?: BriefInput["events"] }[] = [
  { file: "BTCUSD", input: { symbol: "BTCUSD", displayName: "Bitcoin", pair: "BTC/USD", category: "crypto", timeframeLabel: "H1" }, macro: { alignmentPct: 35, label: "Mixed", driversWithData: 5, driversTotal: 5 } },
  { file: "XAUUSD", input: { symbol: "XAUUSD", displayName: "Gold", pair: "XAU/USD", category: "metal", timeframeLabel: "H1" }, events: [{ whenIst: "Thu 19 Nov, 12:30 AM IST", title: "FOMC Meeting Minutes", currency: "USD" }] },
  { file: "EURUSD", input: { symbol: "EURUSD", displayName: "EUR/USD", pair: "EUR/USD", category: "forex", timeframeLabel: "H1" } },
  { file: "USDJPY", input: { symbol: "USDJPY", displayName: "USD/JPY", pair: "USD/JPY", category: "forex", timeframeLabel: "H1" } },
];

function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z])[+-]?\d[\d,]*\.?\d*/g)) {
    const v = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(Math.abs(v));
  }
  return out;
}
function traced(tok: number, used: number[]): boolean {
  if (SMALL_OK.has(tok)) return true;
  return used.some((u) => {
    const a = Math.abs(u);
    if (a === 0) return tok === 0;
    return Math.abs(tok - a) / a <= 0.006 || Math.abs(tok - a) <= 0.051; // rounding in the displayed text
  });
}

for (const m of MARKETS) {
  const candles = fixture(m.file);
  const facts = buildBriefFacts({ ...m.input, candles, macro: m.macro, events: m.events });
  ok(!!facts, `${m.file}: facts built`);
  if (!facts) continue;

  // previous brief = the same market 24 hours earlier
  const prevCandles = candles.slice(0, candles.length - 24);
  const prevFacts = buildBriefFacts({ ...m.input, candles: prevCandles });
  let previous: PreviousBrief | null = null;
  if (prevFacts) {
    const after = candles.slice(prevCandles.length);
    previous = { levels: prevFacts.scenarioLevels, high: Math.max(...after.map((k) => k.high)), low: Math.min(...after.map((k) => k.low)), close: after[after.length - 1].close };
  }

  const built = buildBriefSections(facts, { chartUrl: "https://example.invalid/chart.png", previous });
  const again = buildBriefSections(facts, { chartUrl: "https://example.invalid/chart.png", previous });
  ok(JSON.stringify(built) === JSON.stringify(again), `${m.file}: deterministic`);

  const kinds = built.sections.map((s) => s.kind);
  const order = ["headline", "chips", "hero", "bullets", "bullets", "fit", "scenarios", "plan", "check", "learn", "footer"];
  ok(JSON.stringify(kinds) === JSON.stringify(order), `${m.file}: section order ${kinds.join(",")}`);
  ok(built.sections.every((s) => s.body.trim().length > 0), `${m.file}: every section has a plain-text body`);
  ok(built.title.length <= 120 && built.title.length >= 20, `${m.file}: headline length ${built.title.length}`);
  ok(built.summary.length <= 300, `${m.file}: summary length`);
  const hero = built.sections.find((s) => s.kind === "hero");
  ok(!!hero?.image && hero.image.alt.length > 10 && hero.image.caption.length > 10, `${m.file}: hero has alt + caption`);

  const text = [built.title, built.summary, ...built.sections.flatMap((s) => [s.heading, s.body, ...(s.bullets ?? []), ...(s.cards?.flatMap((c) => [c.title, c.body]) ?? []), ...(s.chips?.flatMap((c) => [c.value, c.label]) ?? [])])].join("\n");
  ok(!FORBIDDEN.test(text), `${m.file}: forbidden wording found: ${text.match(FORBIDDEN)?.[0]}`);
  ok(/not financial advice/i.test(text), `${m.file}: disclaimer present`);
  ok(/rule-based/i.test(text), `${m.file}: names the source (rule-based system)`);

  // the publishing validator (the same one publish runs): unique non-empty headings, summary length, etc.
  const hd = built.sections.map((s) => s.heading.trim().toLowerCase());
  ok(hd.every((h) => h.length > 0) && new Set(hd).size === hd.length, `${m.file}: headings must be non-empty and unique`);
  const seo = buildSeo(`${m.input.displayName} Analysis - 23 Nov 2026`, ["x analysis", "x forecast", "x levels"]);
  const vr = validateArticle({ sections: built.sections, disclaimer: "d", summary: built.summary, seo } as unknown as Article);
  ok(vr.issues.filter((i) => !/SEO|keywords/i.test(i)).length === 0, `${m.file}: publish validator issues: ${vr.issues.join("; ")}`);

  // number tracing: ignore the date/time line and the readable lesson names
  const traceText = built.sections.filter((s) => s.kind !== "headline" && s.kind !== "learn" && s.kind !== "footer").map((s) => s.body).join("\n").replace(/Thu 19 Nov, 12:30 AM IST/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const untraced = numbersIn(traceText).filter((n) => !traced(n, built.usedNumbers));
  ok(untraced.length === 0, `${m.file}: numbers not produced from facts: ${[...new Set(untraced)].join(", ")}`);

  // plan wording
  if (facts.plan.state === "standAside") ok(built.sections.find((s) => s.kind === "plan")!.body.includes("waiting for a cleaner area"), `${m.file}: stand-aside wording`);

  console.log(`${m.file}: ${built.sections.length} sections, ${built.usedNumbers.length} numbers traced, plan=${facts.plan.state}, short=${facts.shortTrend}, 4h=${facts.higherTrend}`);
  if (PRINT) {
    console.log("\n=== " + built.title + " ===");
    for (const s of built.sections) console.log(`\n[${s.kind}] ${s.heading}\n${s.body}`);
    console.log();
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
