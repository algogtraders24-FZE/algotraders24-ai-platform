// scripts/validate-evidence-sources.ts
// The extra evidence sources (economic calendar -> macro, macro drivers -> cross-asset,
// stored news) and their wiring into the Market Intelligence pipeline. Pure/in-memory:
// every feed is an injected fake. `npm run validate:evidence-sources`.

import assert from "node:assert/strict";
import { EconomicCalendarEvidenceSource, endOfFetchedWeek, CALENDAR_EVIDENCE_SOURCE, type CalendarRow } from "../services/evidence-sources/calendar-evidence-source";
import { MacroDriverEvidenceSource, MACRO_DRIVER_EVIDENCE_SOURCE } from "../services/evidence-sources/macro-driver-evidence-source";
import { currenciesForSymbol } from "../services/evidence-sources/symbol-currencies";
import { StoredNewsEvidenceProvider, STORED_NEWS_SOURCE } from "../services/evidence-sources/stored-news-provider";
import { isRelevantHeadline } from "../services/evidence-sources/news-relevance";
import { parseRichText } from "../components/ui/RichText";
import { MarketIntelligencePipelineService, EXTRA_SOURCE_TIMEOUT_MS } from "../services/ai/market-intelligence-pipeline.service";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import { computeMacroAlignment, ASSET_PROFILES, type MacroInputs } from "../services/macro/macro-alignment";
import type { MacroAlignmentSnapshot } from "../services/macro/macro-service";
import type { EvidenceExtraSource } from "../types/evidence-fusion";
import { presentEvidenceTypes, ALL_EVIDENCE_TYPES } from "../services/intelligence/overview/evidence-coverage";
import type { EvidenceItem, EvidenceType } from "../types/evidence";
import type { MarketDataProvider, MarketContextResult } from "../types/market-data-provider";

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

// Wednesday 2026-10-14 10:00 UTC
const NOW = new Date("2026-10-14T10:00:00Z");
const row = (over: Partial<CalendarRow>): CalendarRow => ({ title: "Core CPI m/m", currency: "USD", impact: "high", eventTime: "2026-10-14T12:30:00Z", forecast: "0.2%", previous: "0.3%", ...over });

function snapshot(inputs: MacroInputs): MacroAlignmentSnapshot {
  const alignment = computeMacroAlignment(inputs, ASSET_PROFILES.gold);
  return { asset: "gold", title: "Gold", alignment, price: null, fetchedAt: NOW.toISOString(), attribution: null };
}
const GOLD_INPUTS: MacroInputs = {
  realYield: { value: -0.15, unit: "pp", source: "FRED DFII10", asOf: "2026-10-13T00:00:00Z" },
  dollar: { value: -0.3, unit: "%", source: "DXY (US dollar index, Exness)", asOf: "2026-10-14T00:00:00Z" },
  yields: { value: 0.2, unit: "%", source: "IEF (Treasury proxy)", asOf: "2026-10-14T09:59:00Z" },
  riskBarometer: { value: null, unit: "%", source: "AUDJPY (risk barometer, Exness)", asOf: null },
  momentum: { value: 0.4, unit: "%", source: "XAUUSD (Exness)", asOf: "2026-10-14T00:00:00Z" },
};

const fakeProvider = (over: Partial<MarketContextResult> = {}): MarketDataProvider => ({
  name: "fake-mt5",
  isConfigured: () => true,
  getMarketContext: async (req) => ({
    symbol: req.symbol,
    provider: "fake-mt5",
    retrievedAt: NOW.toISOString(),
    evidence: [{ claim: "XAUUSD last price 4167.44", source: "fake-mt5", asOf: NOW.toISOString() }],
    ...over,
  }) as MarketContextResult,
});

const present = (types: readonly EvidenceType[]) => new Set(types);

async function main(): Promise<void> {
  console.log("validate-evidence-sources\n");

  // ── calendar ──
  await test("calendar: the next high-impact events become macro evidence with forecast/previous, one source name", async () => {
    const src = new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => [row({}), row({ title: "Fed Chair speaks", eventTime: "2026-10-14T18:00:00Z", forecast: null, previous: null })] });
    const items = await src.collect({ symbol: "XAUUSD" });
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => i.type === "macro" && i.source === CALENDAR_EVIDENCE_SOURCE));
    assert.match(items[0].claim, /High-impact USD event ahead: Core CPI m\/m on .* IST \(in 2h 30m\), forecast 0\.2%, previous 0\.3%/);
    assert.match(items[1].claim, /Fed Chair speaks/);
    assert.ok(!/forecast/.test(items[1].claim));
  });

  await test("calendar: only high-impact, timed, non-holiday events inside 48h, soonest first, max 3", async () => {
    const rows = [
      row({ title: "later", eventTime: "2026-10-16T12:00:00Z" }), // > 48h
      row({ title: "past", eventTime: "2026-10-14T08:00:00Z" }),
      row({ title: "low", impact: "low" }),
      row({ title: "holiday", isHoliday: true }),
      row({ title: "allday", allDay: true }),
      row({ title: "a", eventTime: "2026-10-14T11:00:00Z" }),
      row({ title: "b", eventTime: "2026-10-14T12:00:00Z" }),
      row({ title: "c", eventTime: "2026-10-14T13:00:00Z" }),
      row({ title: "d", eventTime: "2026-10-14T14:00:00Z" }),
    ];
    const items = await new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => rows }).collect({ symbol: "XAUUSD" });
    assert.deepEqual(items.map((i) => /ahead: (\w+)/.exec(i.claim)?.[1]), ["a", "b", "c"]);
  });

  await test("calendar: nothing scheduled and the window is inside the fetched week -> says so (a real observation)", async () => {
    const items = await new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => [] }).collect({ symbol: "EURUSD" });
    assert.equal(items.length, 1);
    assert.match(items[0].claim, /No high-impact USD\/EUR economic events are scheduled in the next 48 hours/);
  });

  await test("calendar: window reaches into NEXT week's feed (Saturday) -> no 'none' claim, because we cannot know; Friday noon is still inside the week", async () => {
    const saturday = new Date("2026-10-17T12:00:00Z");
    const items = await new EconomicCalendarEvidenceSource({ now: () => saturday, getEvents: async () => [] }).collect({ symbol: "XAUUSD" });
    assert.deepEqual(items, []);
    const friday = new Date("2026-10-16T12:00:00Z"); // window ends Sunday noon, before Monday 00:00 UTC
    assert.equal((await new EconomicCalendarEvidenceSource({ now: () => friday, getEvents: async () => [] }).collect({ symbol: "XAUUSD" })).length, 1);
    assert.equal(endOfFetchedWeek(friday).toISOString(), "2026-10-19T00:00:00.000Z");
    assert.equal(endOfFetchedWeek(new Date("2026-10-18T10:00:00Z")).toISOString(), "2026-10-19T00:00:00.000Z"); // Sunday
  });

  await test("calendar: a feed failure throws (the pipeline then skips the source); currencies per symbol", async () => {
    const src = new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => { throw new Error("feed down"); } });
    await assert.rejects(() => src.collect({ symbol: "XAUUSD" }));
    assert.deepEqual(currenciesForSymbol("EURUSD"), ["USD", "EUR"]);
    assert.deepEqual(currenciesForSymbol("USDJPY"), ["USD", "JPY"]);
    assert.deepEqual(currenciesForSymbol("XAUUSD"), ["USD"]);
    assert.deepEqual(currenciesForSymbol("SOLUSD"), ["USD"]);
    assert.deepEqual(currenciesForSymbol("AUDCAD"), ["AUD", "CAD"]);
  });

  // ── macro drivers ──
  await test("macro drivers: each AVAILABLE driver becomes cross-asset evidence naming its feed, plus the summary; unavailable ones are absent", async () => {
    const src = new MacroDriverEvidenceSource({ getSnapshot: async () => snapshot(GOLD_INPUTS) });
    const items = await src.collect({ symbol: "XAUUSD" });
    assert.equal(items.length, 5); // 4 available drivers + summary
    assert.ok(items.every((i) => i.type === "cross-asset" && i.source === MACRO_DRIVER_EVIDENCE_SOURCE));
    assert.ok(items.some((i) => /Dollar weaker .* \[DXY \(US dollar index, Exness\)\]/.test(i.claim)));
    assert.ok(items.some((i) => /\[FRED DFII10\]/.test(i.claim)));
    assert.ok(!items.some((i) => /AUDJPY/.test(i.claim)), "the unavailable barometer must not appear");
    const summary = items[items.length - 1].claim;
    assert.match(summary, /^Macro alignment \d+% - .* \(4\/5 drivers\) - a rule-based agreement of drivers, not a forecast$/);
  });

  await test("macro drivers: a symbol with no macro profile gives no evidence; a snapshot error throws; no summary when there is no score", async () => {
    let called = 0;
    const src = new MacroDriverEvidenceSource({ getSnapshot: async () => (called += 1, snapshot(GOLD_INPUTS)) });
    assert.deepEqual(await src.collect({ symbol: "SOLUSD" }), []);
    assert.equal(called, 0);
    await assert.rejects(() => new MacroDriverEvidenceSource({ getSnapshot: async () => { throw new Error("x"); } }).collect({ symbol: "XAUUSD" }));
    const sparse = await new MacroDriverEvidenceSource({ getSnapshot: async () => snapshot({ dollar: GOLD_INPUTS.dollar, momentum: GOLD_INPUTS.momentum }) }).collect({ symbol: "XAUUSD" });
    assert.equal(sparse.length, 2); // 2 readings, alignment has too few drivers -> no summary
  });

  // ── conflicts: new evidence must not create spurious ones ──
  await test("ranking: calendar + macro-driver + price evidence together produce ZERO conflicts (one source name per type)", async () => {
    const cal = await new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => [row({}), row({ title: "NFP", eventTime: "2026-10-14T13:00:00Z" })] }).collect({ symbol: "XAUUSD" });
    const mac = await new MacroDriverEvidenceSource({ getSnapshot: async () => snapshot(GOLD_INPUTS) }).collect({ symbol: "XAUUSD" });
    const price: EvidenceItem = { type: "price", symbol: "XAUUSD", claim: "last 4167", source: "fake-mt5", asOf: NOW.toISOString(), retrievedAt: NOW.toISOString(), magnitude: 4167 };
    const bundle = new EvidenceRankingService().buildBundle("XAUUSD", [price, ...cal, ...mac], NOW.toISOString());
    assert.equal(bundle.conflicts.length, 0);
    assert.equal(bundle.items.length, 1 + cal.length + mac.length);
  });

  // ── pipeline ──
  const calSource = new EconomicCalendarEvidenceSource({ now: () => NOW, getEvents: async () => [row({})] });
  const macSource = new MacroDriverEvidenceSource({ getSnapshot: async () => snapshot(GOLD_INPUTS) });
  const newsProvider = new StoredNewsEvidenceProvider(async () => ({
    name: "fake-news",
    isConfigured: () => true,
    getNewsEvidence: async (r) => [{ type: "news" as const, symbol: r.symbol, claim: "Gold steady ahead of CPI", source: "Reuters", asOf: NOW.toISOString(), retrievedAt: NOW.toISOString() }],
  }));
  // StoredNewsEvidenceProvider.isConfigured() needs the AV key in the env; the pipeline checks it
  const withAvKey = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const saved = process.env.ALPHA_VANTAGE_API_KEY;
    process.env.ALPHA_VANTAGE_API_KEY = "test";
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = saved;
    }
  };
  const build = (extra: EvidenceExtraSource[], news = false) =>
    new MarketIntelligencePipelineService(fakeProvider(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, news ? newsProvider : null, extra);

  await test("stored news: headlines from several publishers share ONE source name (publisher kept in the claim) -> ZERO conflicts (was N(N-1)/2)", async () => {
    const heads = [["Gold steady ahead of CPI", "Reuters"], ["Dollar index slips as Treasury yields ease", "Bloomberg"], ["Fed speakers in focus after FOMC minutes", "FXStreet"], ["Gold eyes 4200", "Kitco"], ["Bullion holds near record as dollar weakens", "CNBC"]];
    const many = new StoredNewsEvidenceProvider(async () => ({
      name: "fake-news",
      isConfigured: () => true,
      getNewsEvidence: async (r) => heads.map(([h, p]) => ({ type: "news" as const, symbol: r.symbol, claim: h, source: p, asOf: NOW.toISOString(), retrievedAt: NOW.toISOString() })),
    }));
    const items = await many.getNewsEvidence({ symbol: "XAUUSD" });
    assert.equal(items.length, 5);
    assert.ok(items.every((i) => i.source === STORED_NEWS_SOURCE));
    assert.match(items[0].claim, /^Gold steady ahead of CPI \(Reuters\)$/);
    const bundle = new EvidenceRankingService().buildBundle("XAUUSD", items, NOW.toISOString());
    assert.equal(bundle.conflicts.length, 0);
    // contrast: the raw per-publisher items WOULD conflict pairwise
    const raw = await (await Promise.resolve({ getNewsEvidence: async () => heads.map(([h, p]) => ({ type: "news" as const, symbol: "XAUUSD" as const, claim: h, source: p, asOf: NOW.toISOString(), retrievedAt: NOW.toISOString() })) })).getNewsEvidence();
    assert.equal(new EvidenceRankingService().buildBundle("XAUUSD", raw, NOW.toISOString()).conflicts.length, 10);
  });

  await test("news relevance: names the instrument or is USD macro; company / stock-pick headlines and unrelated stories are dropped", () => {
    const keep: [string, string][] = [
      ["XAUUSD", "Gold prices rise as the dollar index slips"],
      ["XAUUSD", "Bullion holds near record ahead of Fed decision"],
      ["XAGUSD", "Silver rallies with precious metals"],
      ["EURUSD", "ECB's Lagarde signals patience on rate cuts"],
      ["EURUSD", "Euro steadies as the dollar index edges lower"],
      ["GBPUSD", "Sterling slips after Bank of England minutes"],
      ["USDJPY", "Citi Strategist Says JGBs Becoming Appealing as Yields Near Peak"],
      ["USDJPY", "Yen weakens as Bank of Japan holds"],
      ["BTCUSD", "Spot Bitcoin ETF inflows reach a monthly high"],
      ["ETHUSD", "Ethereum staking demand rises"],
    ];
    for (const [sym, h] of keep) assert.equal(isRelevantHeadline(sym, h), true, `${sym}: ${h}`);
    const drop: [string, string][] = [
      ["EURUSD", "Waste Management (WM): Is Its Landfill Moat the Best in the Market?"],
      ["EURUSD", "Will New Rewards Card Change Kroger (KR) Narrative"],
      ["EURUSD", "Great Southern Bancorp stock sits 4.15 percent below its high"],
      ["EURUSD", "Citi Strategist Says JGBs Becoming Appealing as Yields Near Peak"],
      ["XAUUSD", "Is Franco-Nevada (NYSE:FNV) stock swinging with gold royalties today?"],
      ["XAUUSD", "Can Agnico Eagle Mines (TSX:AEM) Beat Quarterly Market Expectations?"],
      ["XAUUSD", "Eldorado Gold (TSX:ELD): Is Skouries Production Finally Near?"],
      ["XAUUSD", "Stock Picks Today: Axis Bank, HDFC Bank, Trent, Marico And More On Brokerages' Radar"],
      ["BTCUSD", "Fed signals patience on rates"], // dollar macro does not count for crypto
      ["SOLUSD", "Oil edges higher"],
      ["NOSUCH", "Gold prices rise"], // no rule for the symbol: keep nothing rather than guess
    ];
    for (const [sym, h] of drop) assert.equal(isRelevantHeadline(sym, h), false, `${sym}: ${h}`);
  });

  await test("stored news: irrelevant headlines never become evidence (all dropped -> no news evidence at all)", async () => {
    const junk = new StoredNewsEvidenceProvider(async () => ({
      name: "fake-news",
      isConfigured: () => true,
      getNewsEvidence: async (r) => ["Waste Management (WM): Is Its Landfill Moat the Best in the Market?", "Will New Rewards Card Change Kroger (KR) Narrative"].map((h) => ({ type: "news" as const, symbol: r.symbol, claim: h, source: "Yahoo", asOf: NOW.toISOString(), retrievedAt: NOW.toISOString() })),
    }));
    assert.deepEqual(await junk.getNewsEvidence({ symbol: "EURUSD" }), []);
  });

  await test("rich text: bold, bullets, standalone-bold headings and paragraphs are parsed; nothing is injected as HTML", () => {
    const blocks = parseRichText(["**Summary**", "Gold is firm.", "Confidence is medium.", "", "**Key evidence**", "- Price 4150", "* 4h bias bullish", "", "1. first", "2. second", "<script>alert(1)</script>"].join("\n"));
    assert.deepEqual(blocks.map((b) => b.kind), ["h", "p", "h", "ul", "ol", "p"]);
    assert.equal((blocks[1] as { text: string }).text, "Gold is firm. Confidence is medium.");
    assert.deepEqual((blocks[3] as { items: string[] }).items, ["Price 4150", "4h bias bullish"]);
    assert.equal((blocks[5] as { text: string }).text, "<script>alert(1)</script>"); // stays plain text; React escapes it
  });

  await test("pipeline: with no extra sources behaviour is unchanged (price only)", async () => {
    const out = await build([]).run({ symbol: "XAUUSD" });
    assert.equal(out.status, "completed");
    if (out.status !== "completed") return;
    assert.deepEqual([...present(out.result.evidence.items.map((i) => i.type))], ["price"]);
  });

  await test("pipeline: calendar + macro drivers + news lift 1 of 8 present evidence types to 4 and the data-gap risk drops", async () => {
    await withAvKey(async () => {
      const out = await build([calSource, macSource], true).run({ symbol: "XAUUSD" });
      assert.equal(out.status, "completed");
      if (out.status !== "completed") return;
      const types = present(out.result.evidence.items.map((i) => i.type));
      assert.deepEqual([...types].sort(), ["cross-asset", "macro", "news", "price"]);
      assert.equal(out.result.evidence.conflicts.length, 0);
      const gap = out.result.reasoning.riskDrivers.find((d) => d.factor === "data-gap")!;
      assert.equal(gap.detail, "4 of 8 evidence types missing");
      assert.equal(gap.level, "medium"); // was "high" (7 of 8 missing)
    });
  });

  await test("pipeline: a failing or timing-out extra source is skipped; the others and the analysis are unaffected", async () => {
    const boom: EvidenceExtraSource = { name: "boom", sourceType: "sentiment", isConfigured: () => true, collect: async () => { throw new Error("down"); } };
    const slow: EvidenceExtraSource = { name: "slow", sourceType: "sentiment", isConfigured: () => true, collect: () => new Promise(() => {}) };
    const off: EvidenceExtraSource = { name: "off", sourceType: "sentiment", isConfigured: () => false, collect: async () => { throw new Error("must not be called"); } };
    const t0 = Date.now();
    const out = await build([boom, slow, off, macSource]).run({ symbol: "XAUUSD" });
    const elapsed = Date.now() - t0;
    assert.equal(out.status, "completed");
    if (out.status !== "completed") return;
    assert.deepEqual([...present(out.result.evidence.items.map((i) => i.type))].sort(), ["cross-asset", "price"]);
    assert.ok(elapsed >= EXTRA_SOURCE_TIMEOUT_MS - 200 && elapsed < EXTRA_SOURCE_TIMEOUT_MS + 3000, `took ${elapsed}ms`);
  });

  await test("pipeline: a symbol with no macro profile still completes (macro-driver source contributes nothing)", async () => {
    const out = await build([macSource]).run({ symbol: "SOLUSD" });
    assert.equal(out.status, "completed");
    if (out.status !== "completed") return;
    assert.deepEqual([...present(out.result.evidence.items.map((i) => i.type))], ["price"]);
  });

  await test("sentiment stays honestly missing: nothing in the production wiring invents it", async () => {
    await withAvKey(async () => {
      const out = await build([calSource, macSource], true).run({ symbol: "XAUUSD" });
      if (out.status !== "completed") throw new Error("not completed");
      assert.ok(!out.result.evidence.items.some((i) => i.type === "sentiment" || i.type === "historical-pattern"));
    });
  });

  await test("evidence coverage for the Signals cards: types present in the whole bundle, in canonical order", () => {
    const mk = (type: EvidenceItem["type"]): EvidenceItem => ({ type, symbol: "XAUUSD", claim: "c", source: "s", asOf: "a", retrievedAt: "r" });
    const types = presentEvidenceTypes([mk("cross-asset"), mk("price"), mk("news"), mk("macro"), mk("price")]);
    assert.deepEqual(types, ["price", "news", "macro", "cross-asset"]);
    assert.deepEqual(presentEvidenceTypes([]), []);
    assert.equal(ALL_EVIDENCE_TYPES.length, 8);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
