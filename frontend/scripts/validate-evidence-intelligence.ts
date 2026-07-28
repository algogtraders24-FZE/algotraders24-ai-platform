// scripts/validate-evidence-intelligence.ts
// Sprint 15D.4 - Standalone validation for the Evidence Intelligence Engine
// (EvidenceCollectorService, EvidenceRankingService, EvidenceBundle). No
// test framework exists in this project; run via
// `npm run validate:evidence-intelligence`.
//
// Pure Node, no DB, no network, no clock/randomness dependency: every
// timestamp is a literal fixture, matching the services' own design (they
// never read Date.now() internally). "Self-cleaning" is automatic - there
// is no shared or external state to clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MarketContextResult } from "../types/market-data-provider";
import type { EvidenceItem } from "../types/evidence";
import { EvidenceCollectorService } from "../services/ai/evidence/evidence-collector.service";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T00:05:00.000Z";

const collector = new EvidenceCollectorService();
const ranking = new EvidenceRankingService();

function makeResult(overrides: Partial<MarketContextResult> = {}): MarketContextResult {
  return {
    symbol: "XAUUSD",
    provider: "fake-provider",
    retrievedAt: T1,
    evidence: [{ claim: "Spot price: 2685.4000 USD", source: "fake-provider", asOf: T1 }],
    ...overrides,
  };
}

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

function main(): void {
  // ---------------------------------------------------------------------
  // Collection
  // ---------------------------------------------------------------------
  test("collection: a fully populated result produces one typed item per supplied field", () => {
    const result = makeResult({
      technicalSummary: "Price above 20-day average",
      trend: "bullish",
      headlines: ["Gold rallies on rate-cut bets"],
      sentiment: "bullish",
      riskNotes: "Elevated ahead of Fed decision",
    });
    const items = collector.collectFromMarketContextResult(result);
    const types = items.map((i) => i.type).sort();
    assert.deepEqual(types, ["news", "price", "provider-meta", "sentiment", "technical", "technical"].sort());
  });

  test("collection: a minimal result (price evidence only) produces exactly one item - no fabrication", () => {
    const result = makeResult(); // no trend/volatility/technicalSummary/headlines/sentiment/riskNotes
    const items = collector.collectFromMarketContextResult(result);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, "price");
    assert.equal(items[0].claim, "Spot price: 2685.4000 USD");
  });

  test("collection: zero provider evidence and zero optional fields produces zero items", () => {
    const result = makeResult({ evidence: [] });
    const items = collector.collectFromMarketContextResult(result);
    assert.deepEqual(items, []);
  });

  test("collection: merge concatenates groups preserving order", () => {
    const a = [item({ source: "a" })];
    const b = [item({ source: "b" }), item({ source: "c" })];
    assert.deepEqual(
      collector.merge(a, b).map((i) => i.source),
      ["a", "b", "c"],
    );
  });

  // ---------------------------------------------------------------------
  // Ranking
  // ---------------------------------------------------------------------
  test("ranking: items are ordered by fixed type priority (price first, cross-asset last)", () => {
    const items = [
      item({ type: "sentiment", source: "s" }),
      item({ type: "price", source: "p" }),
      item({ type: "cross-asset", source: "c" }),
      item({ type: "technical", source: "t" }),
    ];
    const ranked = ranking.rank(items);
    assert.deepEqual(
      ranked.map((i) => i.type),
      ["price", "technical", "sentiment", "cross-asset"],
    );
  });

  test("ranking: within the same type, older asOf comes first", () => {
    const items = [
      item({ type: "price", source: "a", asOf: T2 }),
      item({ type: "price", source: "b", asOf: T1 }),
    ];
    const ranked = ranking.rank(items);
    assert.deepEqual(ranked.map((i) => i.source), ["b", "a"]);
  });

  test("ranking: same type and same asOf tie-breaks alphabetically by source", () => {
    const items = [
      item({ type: "price", source: "zeta", asOf: T1 }),
      item({ type: "price", source: "alpha", asOf: T1 }),
    ];
    const ranked = ranking.rank(items);
    assert.deepEqual(ranked.map((i) => i.source), ["alpha", "zeta"]);
  });

  test("determinism: rank() is repeatable and never mutates its input", () => {
    const original = [item({ type: "sentiment", source: "s" }), item({ type: "price", source: "p" })];
    const originalOrderBefore = original.map((i) => i.source);
    const first = ranking.rank(original);
    const second = ranking.rank(original);
    assert.deepEqual(first, second);
    assert.deepEqual(
      original.map((i) => i.source),
      originalOrderBefore,
      "the input array must not be reordered in place",
    );
  });

  // ---------------------------------------------------------------------
  // Conflict detection
  // ---------------------------------------------------------------------
  test("conflict: numeric magnitudes disagreeing beyond tolerance from different sources conflict, unresolved", () => {
    const items = [
      item({ source: "provider-a", magnitude: 2685.4 }),
      item({ source: "provider-b", magnitude: 2700.0 }),
    ];
    const conflicts = ranking.detectConflicts(items);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].resolution, "unresolved");
  });

  test("conflict: numeric magnitudes within tolerance do not conflict", () => {
    const items = [
      item({ source: "provider-a", magnitude: 2685.4 }),
      item({ source: "provider-b", magnitude: 2685.5 }),
    ];
    assert.deepEqual(ranking.detectConflicts(items), []);
  });

  test("conflict: the same source repeating a different value is not a conflict", () => {
    const items = [
      item({ source: "provider-a", magnitude: 2685.4 }),
      item({ source: "provider-a", magnitude: 2700.0 }),
    ];
    assert.deepEqual(ranking.detectConflicts(items), []);
  });

  test("conflict: differing textual claims (no magnitude) from different sources conflict", () => {
    const items = [
      item({ source: "provider-a", claim: "Trend: bullish", magnitude: undefined }),
      item({ source: "provider-b", claim: "Trend: bearish", magnitude: undefined }),
    ];
    const conflicts = ranking.detectConflicts(items);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].resolution, "unresolved");
  });

  test("conflict: identical textual claims from different sources do not conflict", () => {
    const items = [
      item({ source: "provider-a", claim: "Trend: bullish", magnitude: undefined }),
      item({ source: "provider-b", claim: "Trend: bullish", magnitude: undefined }),
    ];
    assert.deepEqual(ranking.detectConflicts(items), []);
  });

  test("conflict: one item with a magnitude and one without are not compared (not treated as a conflict)", () => {
    const items = [
      item({ source: "provider-a", magnitude: 2685.4 }),
      item({ source: "provider-b", magnitude: undefined, claim: "Roughly 2685" }),
    ];
    assert.deepEqual(ranking.detectConflicts(items), []);
  });

  test("conflict: different evidence types for the same symbol never conflict with each other", () => {
    const items = [item({ type: "price", source: "a", magnitude: 2685.4 }), item({ type: "technical", source: "b", magnitude: 9999 })];
    assert.deepEqual(ranking.detectConflicts(items), []);
  });

  // ---------------------------------------------------------------------
  // EvidenceBundle
  // ---------------------------------------------------------------------
  test("bundle: scopes to the requested symbol only", () => {
    const items = [item({ symbol: "XAUUSD", source: "a" }), item({ symbol: "XAGUSD", source: "b" })];
    const bundle = ranking.buildBundle("XAUUSD", items, T1);
    assert.equal(bundle.items.length, 1);
    assert.equal(bundle.items[0].symbol, "XAUUSD");
  });

  test("bundle: no-fabrication - item count exactly matches the scoped input, nothing synthesized", () => {
    const items = [item({ source: "a" }), item({ source: "b" }), item({ symbol: "XAGUSD", source: "c" })];
    const bundle = ranking.buildBundle("XAUUSD", items, T1);
    assert.equal(bundle.items.length, 2);
    assert.equal(bundle.generatedAt, T1, "generatedAt must be exactly what the caller supplied, never Date.now()");
  });

  test("bundle: conflicts default to an explicit empty array, never omitted, when there is no disagreement", () => {
    const items = [item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2685.41 })];
    const bundle = ranking.buildBundle("XAUUSD", items, T1);
    assert.deepEqual(bundle.conflicts, []);
  });

  // ---------------------------------------------------------------------
  // Structural: standalone, no coupling to frozen files or mock data
  // ---------------------------------------------------------------------
  test("structural: the evidence engine never imports mock data or frozen Sprint 15C files", () => {
    const files = [
      "types/evidence.ts",
      "services/ai/evidence/evidence-collector.service.ts",
      "services/ai/evidence/evidence-ranking.service.ts",
    ];
    const forbidden = [
      "data/mock",
      "data/market-intelligence",
      "data/signals",
      "market-intelligence.service",
      "services/ai/trading/",
      "services/ai/providers/",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const needle of forbidden) {
        assert.ok(!source.includes(needle), `${file} must not reference ${needle}`);
      }
    }
  });

  test("structural: the frozen Sprint 15C chat route has zero coupling to the evidence engine", () => {
    const source = readFileSync(
      new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!source.includes("evidence"), "chat route must not import anything from the evidence engine");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
