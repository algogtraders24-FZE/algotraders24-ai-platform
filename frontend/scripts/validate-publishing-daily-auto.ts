// scripts/validate-publishing-daily-auto.ts - the daily auto-publisher: plan per date, report content, skip-not-fake,
// idempotent re-run, cron wiring. Pure / in-memory. `npm run validate:publishing-daily-auto`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DailyAutoPublisherService,
  buildReportContent,
  buildCalendarContent,
  buildWeeklyContent,
  toPlainText,
  planDailyReports,
  reportTitle,
  type DailyAutoPublisherDeps,
} from "../services/publishing/daily-auto-publisher.service";
import { buildSeo } from "../services/ai/publishing/seo.service";
import { validateArticle } from "../services/ai/publishing/article-validator.service";
import type { Article } from "../types/article";
import type { EconomicEvent } from "../types/economic-calendar";
import type { MarketAnalysisOutcome } from "../types/market-analysis-orchestration";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const line = (text: string) => ({ text, basis: [] });
function completed(symbol: string): MarketAnalysisOutcome {
  return {
    status: "completed",
    run: {} as never,
    result: {
      symbol,
      intent: "outlook",
      summary: `Evidence for ${symbol} currently leans mixed; price is inside a range with no confirmed break.`,
      explainable: {
        symbol,
        executiveSummary: `${symbol} is range-bound with mixed evidence at the moment.`,
        marketThesis: "t",
        supportingEvidence: [line("Price holds above the 20-day average.")],
        opposingEvidence: [line("Headline flow is negative.")],
        unknownFactors: ["Upcoming data release"],
        assumptions: [],
        limitations: ["Single timeframe only."],
        confidenceSummary: "Confidence is moderate.",
        riskSummary: "Risk is elevated into the release.",
        recommendationBasis: "b",
        metadata: { explainerVersion: "1", sourcePipelineVersion: "1", generatedAt: "2026-10-14T06:15:00.000Z" },
      },
      risk: {} as never,
      confidence: {} as never,
    },
  } as unknown as MarketAnalysisOutcome;
}

const ev = (i: number, impact: EconomicEvent["impact"], currency = "USD", title = `Event ${i}`): EconomicEvent => ({
  id: `e${i}`,
  title,
  currency,
  impact,
  isHoliday: false,
  eventTime: `2026-10-${String(19 + (i % 4)).padStart(2, "0")}T12:30:00.000Z`,
  allDay: false,
  forecast: "0.3%",
  previous: "0.4%",
  actual: null,
  provider: "t",
});
const CAL: EconomicEvent[] = [ev(1, "high", "USD", "CPI m/m"), ev(2, "high", "EUR", "ECB Rate Decision"), ev(3, "high", "USD", "Fed Chair Speaks"), ev(4, "low"), ev(5, "medium")];
const MON = new Date("2026-10-19T06:15:00Z");
const TUE = new Date("2026-10-20T06:15:00Z");
const THU = new Date("2026-10-22T06:15:00Z");
const SUN = new Date("2026-10-18T06:15:00Z");

const WED = new Date("2026-10-14T06:15:00Z"); // Wednesday
const SAT = new Date("2026-10-17T06:15:00Z");

function makeDeps(over: Partial<DailyAutoPublisherDeps> = {}, store = new Set<string>()) {
  const published: string[] = [];
  const created: { title: string; sections: number }[] = [];
  const deps: DailyAutoPublisherDeps = {
    analyze: async (symbol) => completed(symbol),
    slugExists: async (slug) => store.has(slug),
    createDraft: async (input) => {
      created.push({ title: input.custom.title, sections: input.custom.sections.length });
      store.add(buildSeo(input.custom.title, input.keywords).slug);
      return { id: `art-${created.length}` } as Article;
    },
    publishNow: async (id) => void published.push(id),
    getCalendarEvents: async () => CAL,
    now: () => WED,
    ...over,
  };
  return { deps, published, created, store };
}

const root = join(__dirname, "..");

async function main(): Promise<void> {
  console.log("validate-publishing-daily-auto\n");

  await test("weekday plan = gold + that day's forex pair + a crypto pair (3 different reports)", () => {
    const plan = planDailyReports(WED);
    assert.deepEqual(plan.map((p) => p.category), ["gold-analysis", "forex-analysis", "crypto-analysis"]);
    assert.equal(plan[1].symbol, "USDJPY"); // Wednesday
    assert.equal(new Set(plan.map((p) => p.symbol)).size, 3);
  });

  await test("weekend plan = crypto only (gold/forex markets closed)", () => {
    const plan = planDailyReports(SAT);
    assert.deepEqual(plan.map((p) => p.category), ["crypto-analysis"]);
  });

  await test("forex pair and crypto pair rotate across days", () => {
    const fx = new Set<string>();
    const cr = new Set<string>();
    for (let d = 0; d < 14; d++) {
      for (const p of planDailyReports(new Date(WED.getTime() + d * 86_400_000))) {
        if (p.category === "forex-analysis") fx.add(p.symbol);
        if (p.category === "crypto-analysis") cr.add(p.symbol);
      }
    }
    assert.ok(fx.size >= 3, `forex pairs ${[...fx]}`);
    assert.equal(cr.size, 4);
  });

  await test("titles carry the date, so every day gets a distinct slug", () => {
    const [gold] = planDailyReports(WED);
    const next = new Date(WED.getTime() + 86_400_000);
    assert.equal(reportTitle(gold, WED), "Gold (XAU/USD) Analysis - 14 Oct 2026");
    assert.notEqual(buildSeo(reportTitle(gold, WED), gold.keywords).slug, buildSeo(reportTitle(gold, next), gold.keywords).slug);
  });

  await test("built content passes the real validateArticle gate (3 distinct sections, SEO >= 70)", () => {
    const [gold] = planDailyReports(WED);
    const content = buildReportContent(gold, WED, completed("XAUUSD") as never)!;
    assert.ok(content);
    const seo = buildSeo(content.title, gold.keywords);
    const article = {
      sections: content.sections,
      disclaimer: "d",
      summary: content.summary,
      seo,
    } as unknown as Article;
    const v = validateArticle(article);
    assert.deepEqual(v.issues, []);
    assert.equal(content.sections.length, 3);
  });

  await test("a normal run creates + publishes all 3 reports", async () => {
    const { deps, published, created } = makeDeps();
    const out = await new DailyAutoPublisherService(deps).run();
    assert.deepEqual(out.results.map((r) => r.status), ["published", "published", "published"]);
    assert.equal(published.length, 3);
    assert.equal(created.length, 3);
  });

  await test("re-running the same day creates nothing (idempotent)", async () => {
    const store = new Set<string>();
    await new DailyAutoPublisherService(makeDeps({}, store).deps).run();
    const second = makeDeps({}, store);
    const out = await new DailyAutoPublisherService(second.deps).run();
    assert.deepEqual(out.results.map((r) => r.status), ["already-exists", "already-exists", "already-exists"]);
    assert.equal(second.created.length, 0);
    assert.equal(second.published.length, 0);
  });

  await test("no live data for a symbol -> that report is SKIPPED, never faked; the others still publish", async () => {
    const { deps, published } = makeDeps({
      analyze: async (symbol) =>
        symbol === "XAUUSD"
          ? ({ status: "provider-unavailable", run: {} as never, reason: "no key", provider: "x" } as MarketAnalysisOutcome)
          : completed(symbol),
    });
    const out = await new DailyAutoPublisherService(deps).run();
    assert.deepEqual(out.results.map((r) => r.status), ["skipped", "published", "published"]);
    assert.equal(published.length, 2);
  });

  await test("an AI failure or empty summary is skipped, not published", async () => {
    const { deps, published } = makeDeps({
      analyze: async () => ({ status: "ai-failed", run: {} as never, message: "busy" }) as MarketAnalysisOutcome,
    });
    const out = await new DailyAutoPublisherService(deps).run();
    assert.ok(out.results.every((r) => r.status === "skipped"));
    assert.equal(published.length, 0);
  });

  await test("one report throwing does not stop the rest; it is reported as failed", async () => {
    let n = 0;
    const { deps } = makeDeps({
      publishNow: async () => {
        n += 1;
        if (n === 1) throw new Error("publish exploded");
      },
    });
    const out = await new DailyAutoPublisherService(deps).run();
    assert.deepEqual(out.results.map((r) => r.status), ["failed", "published", "published"]);
    assert.match(out.results[0].reason ?? "", /exploded/);
  });

  await test("toPlainText removes markdown markers and the chat preamble, keeps the words and bullets", () => {
    const md = "Here is today's market report for XAUUSD:\n\n**Summary**\nPrice is *near* 4161.99 USD.\n\n**Key evidence**\n*   The spot price is 4161.991.\n*   A bearish FVG (4173.36-4177.60) sits above.\n## Outlook\nMixed.";
    const out = toPlainText(md);
    assert.ok(!out.includes("*") && !out.includes("#"), out);
    assert.ok(!/^Here is/i.test(out), out);
    assert.ok(out.includes("Summary\nPrice is near 4161.99 USD."), out);
    assert.ok(out.includes("- The spot price is 4161.991.") && out.includes("- A bearish FVG (4173.36-4177.60) sits above."), out);
    assert.ok(out.includes("Outlook\nMixed."), out);
  });

  await test("Mon adds the calendar preview, Tue/Thu add a fundamental report, Sun adds the weekly review (max 4 a day)", () => {
    assert.deepEqual(planDailyReports(MON).map((p) => p.kind ?? "analysis"), ["analysis", "analysis", "analysis", "calendar"]);
    const tue = planDailyReports(TUE);
    assert.equal(tue[3].kind, "fundamental");
    assert.equal(tue[3].symbol, "XAUUSD");
    assert.equal(planDailyReports(THU)[3].symbol, "EURUSD");
    assert.deepEqual(planDailyReports(SUN).map((p) => p.kind ?? "analysis"), ["analysis", "weekly"]);
    for (let d = 0; d < 14; d++) assert.ok(planDailyReports(new Date(WED.getTime() + d * 86_400_000)).length <= 4);
  });

  await test("titles per kind are distinct and dated", () => {
    assert.equal(reportTitle(planDailyReports(MON)[3], MON), "Economic Calendar Preview - Week of 19 Oct 2026");
    assert.equal(reportTitle(planDailyReports(SUN)[1], SUN), "Weekly Market Review - Week Ending 18 Oct 2026");
    assert.equal(reportTitle(planDailyReports(TUE)[3], TUE), "Gold (XAU/USD) Fundamental Analysis - 20 Oct 2026");
  });

  await test("calendar preview: only high-impact events, deterministic fields, passes validateArticle", () => {
    const spec = planDailyReports(MON)[3];
    const c = buildCalendarContent(spec, MON, CAL)!;
    assert.ok(c);
    const text = c.sections.map((x) => x.body).join("\n");
    assert.ok(text.includes("CPI m/m") && text.includes("ECB Rate Decision") && text.includes("forecast 0.3%, previous 0.4%"));
    assert.ok(!text.includes("Event 4") && !text.includes("Event 5"), "low/medium events must not be listed");
    const article = { sections: c.sections, disclaimer: "d", summary: c.summary, seo: buildSeo(c.title, spec.keywords) } as unknown as Article;
    assert.deepEqual(validateArticle(article).issues, []);
  });

  await test("calendar preview is skipped (not faked) with fewer than 3 high-impact events", () => {
    assert.equal(buildCalendarContent(planDailyReports(MON)[3], MON, [ev(1, "high"), ev(2, "low")]), null);
  });

  await test("weekly review needs >= 2 analysed assets, adds a risk section, passes validateArticle", () => {
    const spec = planDailyReports(SUN)[1];
    const parts = [
      { label: "Gold (XAU/USD)", outcome: completed("XAUUSD") as never },
      { label: "EUR/USD", outcome: completed("EURUSD") as never },
    ];
    const c = buildWeeklyContent(spec, SUN, parts)!;
    assert.deepEqual(c.sections.map((x) => x.heading), ["Gold (XAU/USD)", "EUR/USD", "Risk, Confidence and Limits"]);
    const article = { sections: c.sections, disclaimer: "d", summary: c.summary, seo: buildSeo(c.title, spec.keywords) } as unknown as Article;
    assert.deepEqual(validateArticle(article).issues, []);
    assert.equal(buildWeeklyContent(spec, SUN, parts.slice(0, 1)), null);
  });

  await test("Monday run publishes 4 reports incl. the calendar preview with no AI call for it", async () => {
    const asked: string[] = [];
    const { deps, published } = makeDeps({
      now: () => MON,
      analyze: async (symbol, q) => (asked.push(symbol), completed(symbol)),
    });
    const out = await new DailyAutoPublisherService(deps).run();
    assert.equal(out.results.length, 4);
    assert.ok(out.results.every((r) => r.status === "published"), JSON.stringify(out.results));
    assert.equal(published.length, 4);
    assert.ok(!asked.includes("CALENDAR"));
  });

  await test("Sunday run: weekly review analyses gold, EUR/USD and BTC; one failed asset still leaves a publishable review", async () => {
    const asked: string[] = [];
    const { deps } = makeDeps({
      now: () => SUN,
      analyze: async (symbol) => {
        asked.push(symbol);
        return symbol === "EURUSD" ? ({ status: "ai-failed", run: {} as never, message: "x" } as MarketAnalysisOutcome) : completed(symbol);
      },
    });
    const out = await new DailyAutoPublisherService(deps).run();
    const weekly = out.results.find((r) => r.category === "weekly-review")!;
    assert.equal(weekly.status, "published");
    for (const sym of ["XAUUSD", "EURUSD", "BTCUSD"]) assert.ok(asked.includes(sym), sym);
  });

  await test("a fundamental report asks a fundamentals question and uses the fundamental heading", async () => {
    let q = "";
    const { deps, created } = makeDeps({
      now: () => TUE,
      analyze: async (symbol, question) => {
        if (symbol === "XAUUSD" && /fundamental/i.test(question)) q = question;
        return completed(symbol);
      },
    });
    await new DailyAutoPublisherService(deps).run();
    assert.ok(/fundamental drivers/i.test(q), q);
    assert.ok(created.some((c) => c.title.includes("Fundamental Analysis")));
  });

  await test("blog article page has Article JSON-LD (with '<' escaped), a byline and a methodology link; /methodology exists and is in the sitemap", () => {
    const page = readFileSync(join(root, "app/blog/[slug]/page.tsx"), "utf8");
    assert.ok(page.includes('"@type": "Article"') && page.includes("datePublished") && page.includes("application/ld+json"));
    assert.ok(page.includes('replace(/</g, "\\\\u003c")'), "JSON-LD must escape '<'");
    assert.ok(page.includes('href="/methodology"'));
    assert.ok(readFileSync(join(root, "app/methodology/page.tsx"), "utf8").includes('canonical: "/methodology"'));
    assert.ok(readFileSync(join(root, "app/sitemap.ts"), "utf8").includes("/methodology"));
  });

  // ---- cron wiring (drift guards) ---------------------------------
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[] };

  await test("vercel.json has exactly one DAILY auto-daily cron, before the 07:00 dispatch", () => {
    const c = (vercel.crons ?? []).filter((x) => x.path === "/api/private/publishing/auto-daily");
    assert.equal(c.length, 1);
    const [min, hour, dom, mon, dow] = c[0].schedule.split(" ");
    assert.ok(/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*" && dow === "*", c[0].schedule);
  });

  await test("proxy.ts exempts the auto-daily path (still behind isValidCronSecret)", () => {
    const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
    assert.ok(proxy.includes('"/api/private/publishing/auto-daily"'));
    assert.ok(proxy.includes("CRON_SECRET_EXEMPT_PATHS.has(request.nextUrl.pathname) && isValidCronSecret(request)"));
  });

  await test("auto-daily route is cron-secret OR admin only", () => {
    const route = readFileSync(join(root, "app/api/private/publishing/auto-daily/route.ts"), "utf8");
    assert.ok(route.includes("isValidCronSecret(req)") && route.includes("requireAdmin("));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
