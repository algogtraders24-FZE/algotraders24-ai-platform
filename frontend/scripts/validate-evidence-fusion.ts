// scripts/validate-evidence-fusion.ts
// Sprint 15D.11 - Standalone validation for the Multi-Source Evidence
// Fusion Engine (EvidenceFusionService). No test framework exists in this
// project; run via `npm run validate:evidence-fusion`.
//
// Pure Node, no DB, no network, no AI call, no clock/randomness dependency
// - fusion never reads a clock itself. Fixtures include hand-built
// EvidenceItem[] (to exercise multi-source/duplicate scenarios no real
// collector can produce alone) and one test chaining the real, unmodified
// Sprint 15D.4 EvidenceCollectorService to prove genuine EvidenceItem[]
// compatibility end to end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceItem } from "../types/evidence";
import type {
  EvidenceProviderRequest,
  EvidenceSourceGroup,
  NewsProvider,
  EconomicCalendarProvider,
  SentimentProvider,
} from "../types/evidence-fusion";
import { EvidenceCollectorService } from "../services/ai/evidence/evidence-collector.service";
import { EvidenceFusionService } from "../services/ai/evidence-fusion.service";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T00:10:00.000Z"; // 10 min after T1

const fusion = new EvidenceFusionService();

function item(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    type: "price",
    symbol: "XAUUSD",
    claim: "Spot price: 2685.4000 USD",
    source: "provider-a",
    asOf: T1,
    retrievedAt: T1,
    ...overrides,
  };
}

function group(sourceType: EvidenceSourceGroup["sourceType"], items: EvidenceItem[]): EvidenceSourceGroup {
  return { sourceType, items };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: single-source evidence
  // ---------------------------------------------------------------------
  await test("1: single-source evidence - one item produces one FusedEvidence with base confidence and no corroboration", () => {
    const only = item({ source: "alpha-vantage" });
    const result = fusion.fuse([group("market-data", [only])]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].source, ["alpha-vantage"]);
    assert.deepEqual(result[0].sourceType, ["market-data"]);
    assert.equal(result[0].confidence, 60, "a single, uncorroborated source gets the base confidence");
    assert.equal(result[0].priority, 0, "price is the highest-priority category");
    assert.deepEqual(result[0].supportingData, [only]);
  });

  // ---------------------------------------------------------------------
  // 2: multi-source, non-duplicate evidence
  // ---------------------------------------------------------------------
  await test("2: multi-source evidence with distinct claims produces one FusedEvidence per claim, never merged", () => {
    const a = item({ source: "alpha-vantage", claim: "Spot price: 2685.4000 USD" });
    const b = item({ type: "news", source: "google-search", claim: "Fed signals rate pause" });
    const result = fusion.fuse([group("market-data", [a]), group("search", [b])]);
    assert.equal(result.length, 2);
    assert.ok(result.some((f) => f.claim === a.claim && f.source.length === 1));
    assert.ok(result.some((f) => f.claim === b.claim && f.source.length === 1));
  });

  // ---------------------------------------------------------------------
  // 3: duplicate merge (the sprint's own worked example)
  // ---------------------------------------------------------------------
  await test("3: identical claims from two sources merge into exactly one FusedEvidence", () => {
    const fromAlphaVantage = item({ type: "technical", source: "alpha-vantage", claim: "Gold gaining momentum" });
    const fromGoogleSearch = item({ type: "technical", source: "google-search", claim: "Gold gaining momentum", asOf: T2 });
    const result = fusion.fuse([group("market-data", [fromAlphaVantage]), group("search", [fromGoogleSearch])]);
    assert.equal(result.length, 1, "one fused item, not two");
    assert.deepEqual(result[0].source, ["alpha-vantage", "google-search"], "both sources listed, sorted");
    assert.deepEqual(result[0].sourceType, ["market-data", "search"]);
    assert.equal(result[0].confidence, 80, "60 base + 20 for one corroborating source");
    assert.equal(result[0].timestamp, T2, "the most recent of the merged timestamps");
  });

  await test("3b: near-identical claim text (case/whitespace only) is still recognized as the same claim", () => {
    const a = item({ type: "news", source: "provider-a", claim: "  Gold Gaining Momentum  " });
    const b = item({ type: "news", source: "provider-b", claim: "gold gaining momentum" });
    const result = fusion.fuse([group("market-data", [a]), group("news", [b])]);
    assert.equal(result.length, 1);
    assert.equal(result[0].source.length, 2);
  });

  await test("3c: the same source repeating an identical claim is not corroboration - source list stays length 1", () => {
    const a = item({ source: "alpha-vantage", asOf: T1 });
    const b = item({ source: "alpha-vantage", asOf: T2 });
    const result = fusion.fuse([group("market-data", [a, b])]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].source, ["alpha-vantage"]);
    assert.equal(result[0].confidence, 60, "repeating the same source must never inflate confidence");
    assert.equal(result[0].supportingData.length, 2, "both original items are still preserved, even though they share one source");
  });

  await test("3d: identical claim text under different categories is never merged - category is part of the identity", () => {
    const asPrice = item({ type: "price", source: "a", claim: "2685.40" });
    const asTechnical = item({ type: "technical", source: "b", claim: "2685.40" });
    const result = fusion.fuse([group("market-data", [asPrice, asTechnical])]);
    assert.equal(result.length, 2, "same text, different category - two distinct fused items");
  });

  await test("3e: three corroborating sources push confidence to the 100 cap, and a fourth never exceeds it", () => {
    const claim = "Momentum is building";
    const three = fusion.fuse([
      group("market-data", [item({ type: "news", source: "a", claim })]),
      group("news", [item({ type: "news", source: "b", claim })]),
      group("search", [item({ type: "news", source: "c", claim })]),
    ]);
    assert.equal(three[0].confidence, 100, "60 + 2*20 = 100");
    const four = fusion.fuse([
      group("market-data", [item({ type: "news", source: "a", claim })]),
      group("news", [item({ type: "news", source: "b", claim })]),
      group("search", [item({ type: "news", source: "c", claim })]),
      group("sentiment", [item({ type: "news", source: "d", claim })]),
    ]);
    assert.equal(four[0].confidence, 100, "capped at 100, never exceeds it");
  });

  // ---------------------------------------------------------------------
  // 4: source attribution preservation - nothing is lost during fusion
  // ---------------------------------------------------------------------
  await test("4: every original item's source, category, timestamp, and metadata survive fusion via supportingData", () => {
    const a = item({ source: "alpha-vantage", asOf: T1, retrievedAt: T1, magnitude: 2685.4, unit: "USD" });
    const b = item({ type: "news", source: "google-search", claim: "Fed signals rate pause", asOf: T2, retrievedAt: T2 });
    const result = fusion.fuse([group("market-data", [a]), group("search", [b])]);
    assert.equal(result.length, 2, "two distinct claims must both survive, independently");
    const fusedA = result.find((f) => f.source.includes("alpha-vantage"))!;
    assert.equal(fusedA.supportingData.length, 1);
    assert.deepEqual(fusedA.supportingData[0], a, "the exact original item, not a reconstructed copy");
  });

  // ---------------------------------------------------------------------
  // 5: deterministic output across repeated runs and regardless of input order
  // ---------------------------------------------------------------------
  await test("5: fuse() produces byte-identical output across two calls on the same input", () => {
    const groups = [
      group("market-data", [item({ source: "a", claim: "Gold gaining momentum", type: "technical" })]),
      group("search", [item({ source: "b", claim: "Gold gaining momentum", type: "technical" })]),
      group("news", [item({ source: "c", claim: "Fed signals rate pause", type: "news" })]),
    ];
    assert.deepEqual(fusion.fuse(groups), fusion.fuse(groups));
  });

  await test("5b: output order is stable regardless of the order groups/items are supplied in", () => {
    const alpha = item({ source: "a", claim: "Gold gaining momentum", type: "technical" });
    const google = item({ source: "b", claim: "Gold gaining momentum", type: "technical" });
    const news = item({ source: "c", claim: "Fed signals rate pause", type: "news" });
    const forward = fusion.fuse([group("market-data", [alpha]), group("search", [google]), group("news", [news])]);
    const reversed = fusion.fuse([group("news", [news]), group("search", [google]), group("market-data", [alpha])]);
    assert.deepEqual(forward, reversed, "input order must never affect output order or content");
  });

  // ---------------------------------------------------------------------
  // 6: empty-provider handling
  // ---------------------------------------------------------------------
  await test("6: no groups at all produces an empty result, never an error", () => {
    assert.deepEqual(fusion.fuse([]), []);
  });

  await test("6b: a group with zero items contributes nothing and does not crash", () => {
    const real = item({ source: "a" });
    const result = fusion.fuse([group("market-data", [real]), group("news", [])]);
    assert.equal(result.length, 1);
  });

  // ---------------------------------------------------------------------
  // 7: future-provider compatibility (mock interfaces, DI-only extension)
  // ---------------------------------------------------------------------
  await test("7: a mock NewsProvider/EconomicCalendarProvider/SentimentProvider fuses alongside market-data with zero changes to fusion logic", async () => {
    const mockNews: NewsProvider = {
      name: "mock-news",
      isConfigured: () => true,
      getNewsEvidence: async (request: EvidenceProviderRequest) => [
        item({ type: "news", symbol: request.symbol, source: "mock-news", claim: "Gold gaining momentum" }),
      ],
    };
    const mockCalendar: EconomicCalendarProvider = {
      name: "mock-calendar",
      isConfigured: () => true,
      getCalendarEvidence: async (request: EvidenceProviderRequest) => [
        item({ type: "macro", symbol: request.symbol, source: "mock-calendar", claim: "CPI release in 2 days" }),
      ],
    };
    const mockSentiment: SentimentProvider = {
      name: "mock-sentiment",
      isConfigured: () => true,
      getSentimentEvidence: async (request: EvidenceProviderRequest) => [
        item({ type: "sentiment", symbol: request.symbol, source: "mock-sentiment", claim: "Sentiment: bullish" }),
      ],
    };

    const request: EvidenceProviderRequest = { symbol: "XAUUSD" };
    const [newsItems, calendarItems, sentimentItems] = await Promise.all([
      mockNews.getNewsEvidence(request),
      mockCalendar.getCalendarEvidence(request),
      mockSentiment.getSentimentEvidence(request),
    ]);

    const marketDataItem = item({ type: "news", source: "alpha-vantage", claim: "Gold gaining momentum" });
    const result = fusion.fuse([
      group("market-data", [marketDataItem]),
      group("news", newsItems),
      group("economic-calendar", calendarItems),
      group("sentiment", sentimentItems),
    ]);

    assert.equal(result.length, 3, "the market-data/news 'gold gaining momentum' pair merges; calendar and sentiment stay distinct");
    const merged = result.find((f) => f.claim === "Gold gaining momentum")!;
    assert.deepEqual(merged.sourceType, ["market-data", "news"]);
    assert.ok(result.some((f) => f.category === "macro" && f.source.includes("mock-calendar")));
    assert.ok(result.some((f) => f.category === "sentiment" && f.source.includes("mock-sentiment")));
  });

  // ---------------------------------------------------------------------
  // toEvidenceItems(): the projection back to EvidenceRankingService's input shape
  // ---------------------------------------------------------------------
  await test("toEvidenceItems: projects FusedEvidence back into the exact shape EvidenceRankingService expects, joining multi-source attribution into one string", () => {
    const a = item({ type: "technical", source: "alpha-vantage", claim: "Gold gaining momentum", magnitude: undefined });
    const b = item({ type: "technical", source: "google-search", claim: "Gold gaining momentum" });
    const fused = fusion.fuse([group("market-data", [a]), group("search", [b])]);
    const items = fusion.toEvidenceItems("XAUUSD", fused, T1);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, "technical");
    assert.equal(items[0].symbol, "XAUUSD");
    assert.equal(items[0].claim, "Gold gaining momentum");
    assert.equal(items[0].source, "alpha-vantage, google-search");
    assert.equal(items[0].retrievedAt, T1);
  });

  await test("toEvidenceItems: preserves magnitude/unit from the representative source when present", () => {
    const priceItem = item({ source: "alpha-vantage", magnitude: 2685.4, unit: "USD" });
    const fused = fusion.fuse([group("market-data", [priceItem])]);
    const items = fusion.toEvidenceItems("XAUUSD", fused, T1);
    assert.equal(items[0].magnitude, 2685.4);
    assert.equal(items[0].unit, "USD");
  });

  // ---------------------------------------------------------------------
  // Real-pipeline compatibility: chains the unmodified 15D.4 collector
  // ---------------------------------------------------------------------
  await test("integrates with the real, unmodified EvidenceCollectorService output", () => {
    const collector = new EvidenceCollectorService();
    const collected = collector.collectFromMarketContextResult({
      symbol: "XAUUSD",
      provider: "alpha-vantage",
      retrievedAt: T1,
      evidence: [{ claim: "Spot price: 2685.4000 USD", source: "alpha-vantage", asOf: T1 }],
      headlines: ["Gold rallies on rate-cut bets"],
    });
    const result = fusion.fuse([group("market-data", collected)]);
    assert.equal(result.length, 2, "one price item + one news item, no duplicates");
    const items = fusion.toEvidenceItems("XAUUSD", result, T1);
    assert.ok(items.some((i) => i.type === "price"));
    assert.ok(items.some((i) => i.type === "news"));
  });

  // ---------------------------------------------------------------------
  // No reasoning: fusion never invents a category or alters claim content
  // ---------------------------------------------------------------------
  await test("no fabrication: fusion never invents a claim, category, or source not present in the input", () => {
    const a = item({ source: "alpha-vantage", claim: "Spot price: 2685.4000 USD" });
    const result = fusion.fuse([group("market-data", [a])]);
    assert.equal(result[0].claim, a.claim, "claim text is copied verbatim, never rewritten");
    assert.equal(result[0].category, a.type);
    assert.deepEqual(result[0].source, [a.source]);
  });

  // ---------------------------------------------------------------------
  // Structural: no AI/UI coupling, no coupling to sibling engine classes
  // ---------------------------------------------------------------------
  await test("structural: fusion's import statements never reach into lib/ai, the Gemini SDK, mock data, or sibling engine classes", () => {
    const files = ["types/evidence-fusion.ts", "services/ai/evidence-fusion.service.ts"];
    const forbidden = [
      "lib/ai",
      "@google/genai",
      "data/mock",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
      "market-intelligence.service",
      "reasoning-engine.service",
      "risk-engine.service",
      "confidence-engine.service",
      "evidence-ranking.service",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(!importLines.some((line) => line.includes(needle)), `${file} must not import from anything matching "${needle}"`);
      }
    }
  });

  await test("structural: the frozen Sprint 15C chat route has zero coupling to the evidence fusion engine", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(!source.includes("evidence-fusion"), "chat route must not import the fusion engine");
    assert.ok(!source.includes("EvidenceFusionService"), "chat route must not reference the fusion engine class");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
