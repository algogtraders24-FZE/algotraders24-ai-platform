// scripts/validate-publishing-daily-auto.ts - the daily auto-publisher: plan per date, report content, skip-not-fake,
// idempotent re-run, cron wiring. Pure / in-memory. `npm run validate:publishing-daily-auto`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DailyAutoPublisherService,
  buildReportContent,
  toPlainText,
  planDailyReports,
  reportTitle,
  type DailyAutoPublisherDeps,
} from "../services/publishing/daily-auto-publisher.service";
import { buildSeo } from "../services/ai/publishing/seo.service";
import { validateArticle } from "../services/ai/publishing/article-validator.service";
import type { Article } from "../types/article";
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
    now: () => WED,
    ...over,
  };
  return { deps, published, created, store };
}

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

  // ---- cron wiring (drift guards) ---------------------------------
  const root = join(__dirname, "..");
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
