// scripts/validate-risk-engine.ts
// Sprint 15D.6 - Standalone validation for the Risk Intelligence Engine
// (RiskEngineService). No test framework exists in this project; run via
// `npm run validate:risk-engine`.
//
// Pure Node, no DB, no network, no AI call, no clock/randomness
// dependency. ReasoningResult fixtures are built by chaining the real,
// unmodified Sprint 15D.4 EvidenceRankingService and Sprint 15D.5
// ReasoningEngineService, so this exercises the actual 15D.4 -> 15D.5 ->
// 15D.6 pipeline end to end, not a hand-rolled stand-in for any of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceItem } from "../types/evidence";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import { ReasoningEngineService } from "../services/ai/reasoning/reasoning-engine.service";
import { RiskEngineService } from "../services/ai/risk/risk-engine.service";
import type { RiskCategory, RiskCategoryScore } from "../types/risk-intelligence";
import type { RiskLevel } from "../types/risk";

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
const STALE_HEAVY = "2025-12-31T22:00:00.000Z"; // 120 min before T1

const ranking = new EvidenceRankingService();
const reasoningEngine = new ReasoningEngineService();
const riskEngine = new RiskEngineService();

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

function reasoningFrom(items: EvidenceItem[], generatedAt: string = T1) {
  const bundle = ranking.buildBundle("XAUUSD", items, generatedAt);
  return reasoningEngine.reason(bundle);
}

function categoryOf(categories: RiskCategoryScore[], category: RiskCategory) {
  const found = categories.find((c) => c.category === category);
  assert.ok(found, `expected a "${category}" category to be present`);
  return found!;
}

function main(): void {
  // ---------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------
  test("consumes a real ReasoningResult produced by the unmodified 15D.4/15D.5 pipeline", () => {
    const reasoning = reasoningFrom([item({ source: "a" })]);
    const profile = riskEngine.assess(reasoning);
    assert.equal(profile.symbol, "XAUUSD");
    assert.equal(profile.categories.length, 8, "exactly one score per RiskCategory");
    assert.equal(profile.generatedAt, T1);
  });

  // ---------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------
  test("determinism: assess() produces byte-identical output across two calls on the same reasoning result", () => {
    const reasoning = reasoningFrom([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2700.0 })]);
    const first = riskEngine.assess(reasoning);
    const second = riskEngine.assess(reasoning);
    assert.deepEqual(first, second);
  });

  // ---------------------------------------------------------------------
  // Risk classification: market
  // ---------------------------------------------------------------------
  test("market risk: conflicting price evidence -> high", () => {
    const reasoning = reasoningFrom([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2900.0 })]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "market").level, "high");
  });

  test("market risk: agreeing price evidence -> low", () => {
    const reasoning = reasoningFrom([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2685.41 })]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "market").level, "low");
  });

  test("market risk: no price evidence at all -> medium (unknown, never fabricated low)", () => {
    const reasoning = reasoningFrom([item({ type: "news", claim: "headline" })]);
    const score = categoryOf(riskEngine.assess(reasoning).categories, "market");
    assert.equal(score.level, "medium");
    assert.ok(score.rationale[0].includes("cannot be confirmed or ruled out"));
  });

  // ---------------------------------------------------------------------
  // Risk classification: event
  // ---------------------------------------------------------------------
  test("event risk: conflicting macro/news evidence -> high", () => {
    const reasoning = reasoningFrom([
      item({ type: "news", source: "a", claim: "Rate cut expected", magnitude: undefined }),
      item({ type: "news", source: "b", claim: "Rate hike expected", magnitude: undefined }),
    ]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "event").level, "high");
  });

  test("event risk: agreeing macro/news evidence -> low", () => {
    const reasoning = reasoningFrom([item({ type: "macro", source: "a", claim: "CPI in line", magnitude: undefined })]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "event").level, "low");
  });

  test("event risk: no macro/news evidence -> medium", () => {
    const reasoning = reasoningFrom([item({ type: "price" })]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "event").level, "medium");
  });

  // ---------------------------------------------------------------------
  // No fabrication: liquidity and execution are always honest placeholders
  // ---------------------------------------------------------------------
  test("liquidity risk: always medium regardless of evidence volume, never fabricated as low", () => {
    const empty = riskEngine.assess(reasoningFrom([]));
    const rich = riskEngine.assess(
      reasoningFrom([item({ type: "price" }), item({ type: "technical", claim: "x" }), item({ type: "news", claim: "y" })]),
    );
    assert.equal(categoryOf(empty.categories, "liquidity").level, "medium");
    assert.equal(categoryOf(rich.categories, "liquidity").level, "medium");
    assert.ok(categoryOf(rich.categories, "liquidity").rationale[0].includes("No evidence source"));
    assert.deepEqual(categoryOf(rich.categories, "liquidity").basis, [], "liquidity has no evidence source in this system");
  });

  test("execution risk: always medium regardless of evidence volume, never fabricated as low", () => {
    const empty = riskEngine.assess(reasoningFrom([]));
    const rich = riskEngine.assess(reasoningFrom([item({ type: "price" }), item({ type: "macro", claim: "x" })]));
    assert.equal(categoryOf(empty.categories, "execution").level, "medium");
    assert.equal(categoryOf(rich.categories, "execution").level, "medium");
    assert.ok(categoryOf(rich.categories, "execution").rationale[0].includes("does not integrate broker/execution data"));
  });

  // ---------------------------------------------------------------------
  // Volatility risk
  // ---------------------------------------------------------------------
  test("volatility risk: conflicting technical evidence -> high", () => {
    const reasoning = reasoningFrom([
      item({ type: "technical", source: "a", claim: "Trend: bullish", magnitude: undefined }),
      item({ type: "technical", source: "b", claim: "Trend: bearish", magnitude: undefined }),
    ]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "volatility").level, "high");
  });

  test("volatility risk: no technical conflict -> medium (unmeasured), even with agreeing technical evidence", () => {
    const reasoning = reasoningFrom([item({ type: "technical", claim: "Trend: bullish", magnitude: undefined })]);
    assert.equal(categoryOf(riskEngine.assess(reasoning).categories, "volatility").level, "medium");
  });

  // ---------------------------------------------------------------------
  // Evidence conflict risk
  // ---------------------------------------------------------------------
  test("evidence-conflict risk: 0 conflicts -> low, 1 -> medium, 2+ -> high", () => {
    const zero = riskEngine.assess(reasoningFrom([item({ source: "a" })]));
    const one = riskEngine.assess(reasoningFrom([item({ source: "a", magnitude: 1 }), item({ source: "b", magnitude: 2 })]));
    const many = riskEngine.assess(
      reasoningFrom([
        item({ type: "price", source: "a", magnitude: 1 }),
        item({ type: "price", source: "b", magnitude: 2 }),
        item({ type: "technical", source: "c", claim: "bullish", magnitude: undefined }),
        item({ type: "technical", source: "d", claim: "bearish", magnitude: undefined }),
      ]),
    );
    assert.equal(categoryOf(zero.categories, "evidence-conflict").level, "low");
    assert.equal(categoryOf(one.categories, "evidence-conflict").level, "medium");
    assert.equal(categoryOf(many.categories, "evidence-conflict").level, "high");
  });

  // ---------------------------------------------------------------------
  // Data quality risk
  // ---------------------------------------------------------------------
  test("data-quality risk: sparse, stale evidence scores worse than broad, fresh evidence", () => {
    const broad = riskEngine.assess(
      reasoningFrom([
        item({ type: "price", asOf: T1 }),
        item({ type: "technical", claim: "x", asOf: T1 }),
        item({ type: "news", claim: "y", asOf: T1 }),
        item({ type: "macro", claim: "z", asOf: T1 }),
      ]),
    );
    const sparseStale = riskEngine.assess(reasoningFrom([item({ type: "price", asOf: STALE_HEAVY })]));
    const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
    assert.ok(
      rank[categoryOf(sparseStale.categories, "data-quality").level] >= rank[categoryOf(broad.categories, "data-quality").level],
    );
  });

  // ---------------------------------------------------------------------
  // Uncertainty risk
  // ---------------------------------------------------------------------
  test("uncertainty risk: buckets the reasoning result's own uncertainty score", () => {
    const lowUncertainty = riskEngine.assess(
      reasoningFrom([
        item({ type: "price" }),
        item({ type: "technical", claim: "a" }),
        item({ type: "news", claim: "b" }),
        item({ type: "macro", claim: "c" }),
        item({ type: "sentiment", claim: "d" }),
      ]),
    );
    const highUncertainty = riskEngine.assess(reasoningFrom([]));
    assert.equal(categoryOf(lowUncertainty.categories, "uncertainty").level, "low");
    assert.equal(categoryOf(highUncertainty.categories, "uncertainty").level, "medium");
  });

  // ---------------------------------------------------------------------
  // Overall level
  // ---------------------------------------------------------------------
  test("overall level is the worst (highest) among all 8 categories, never hidden behind an average", () => {
    const reasoning = reasoningFrom([item({ source: "a", magnitude: 1 }), item({ source: "b", magnitude: 2 })]); // market risk -> high
    const profile = riskEngine.assess(reasoning);
    assert.equal(profile.overallLevel, "high");
  });

  // ---------------------------------------------------------------------
  // No fabrication (rationale/basis integrity)
  // ---------------------------------------------------------------------
  test("no fabrication: every category has a non-empty rationale, and basis is empty only for evidence-less categories", () => {
    const profile = riskEngine.assess(reasoningFrom([item({ source: "a" })]));
    for (const category of profile.categories) {
      assert.ok(category.rationale.length > 0, `${category.category} must always explain itself`);
    }
    assert.deepEqual(categoryOf(profile.categories, "liquidity").basis, []);
    assert.deepEqual(categoryOf(profile.categories, "execution").basis, []);
    assert.ok(categoryOf(profile.categories, "market").basis.length > 0, "market risk here is grounded in real price evidence");
  });

  // ---------------------------------------------------------------------
  // Structural: no AI/provider coupling, standalone
  // ---------------------------------------------------------------------
  test("structural: the risk engine's imports never reach into lib/ai or market-data providers", () => {
    const files = ["types/risk-intelligence.ts", "services/ai/risk/risk-engine.service.ts"];
    const forbidden = [
      "lib/ai",
      "@google/genai",
      "market-data-provider",
      "alpha-vantage.provider",
      "data/mock",
      "market-intelligence.service",
      "services/ai/providers/",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(
          !importLines.some((line) => line.includes(needle)),
          `${file} must not import from anything matching "${needle}"`,
        );
      }
    }
  });

  test("structural: the frozen Sprint 15C chat route has zero coupling to the risk engine", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(!source.includes("risk-engine") && !source.includes("risk-intelligence"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
