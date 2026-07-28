// scripts/validate-confidence-engine.ts
// Sprint 15D.7 - Standalone validation for the Confidence Intelligence
// Engine (ConfidenceEngineService). No test framework exists in this
// project; run via `npm run validate:confidence-engine`.
//
// Pure Node, no DB, no network, no AI call, no clock/randomness
// dependency - every timestamp is a literal fixture. Bundles/reasoning
// results/risk profiles are built with the real, unmodified Sprint
// 15D.4/15D.5/15D.6 services, so this exercises the actual end-to-end
// pipeline contract, not hand-rolled stand-ins for it - except for one
// explicit unit test of the "low risk -> no penalty" branch, which is
// unreachable via the real pipeline (RiskEngineService's liquidity/
// execution categories are always "medium", so overallLevel can never
// actually be "low") and is therefore tested with a minimal hand-built
// RiskProfile fixture instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceItem } from "../types/evidence";
import type { RiskProfile } from "../types/risk-intelligence";
import type { ConfidenceCategory, ConfidenceProfile } from "../types/confidence-intelligence";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import { ReasoningEngineService } from "../services/ai/reasoning/reasoning-engine.service";
import { RiskEngineService } from "../services/ai/risk/risk-engine.service";
import { ConfidenceEngineService } from "../services/ai/confidence/confidence-engine.service";

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

const T1 = "2026-01-01T00:00:00.000Z"; // generatedAt reference point
const FRESH = "2026-01-01T00:00:00.000Z"; // 0 min old
const STALE_30 = "2025-12-31T23:30:00.000Z"; // 30 min old
const STALE_HEAVY = "2025-12-31T22:00:00.000Z"; // 120 min old

const ranking = new EvidenceRankingService();
const reasoningEngine = new ReasoningEngineService();
const riskEngine = new RiskEngineService();
const confidenceEngine = new ConfidenceEngineService();

function item(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    type: "price",
    symbol: "XAUUSD",
    claim: "Spot price: 2685.4000 USD",
    source: "provider-a",
    asOf: FRESH,
    retrievedAt: FRESH,
    ...overrides,
  };
}

function pipeline(items: EvidenceItem[], generatedAt: string = T1) {
  const bundle = ranking.buildBundle("XAUUSD", items, generatedAt);
  const reasoning = reasoningEngine.reason(bundle);
  const risk = riskEngine.assess(reasoning);
  const confidence = confidenceEngine.assess(bundle, reasoning, risk);
  return { bundle, reasoning, risk, confidence };
}

function categoryOf(confidence: ConfidenceProfile, category: ConfidenceCategory) {
  const found = confidence.categories.find((c) => c.category === category);
  assert.ok(found, `expected a "${category}" category to be present`);
  return found!;
}

// One item per each of the 8 EvidenceTypes, all fresh, all source "a", no
// conflicts - the shared "full coverage, no disagreement" fixture reused
// across several tests below.
const FULL_COVERAGE_ITEMS: EvidenceItem[] = [
  item({ type: "price", source: "a", magnitude: 2685.4 }),
  item({ type: "technical", source: "a", claim: "RSI neutral" }),
  item({ type: "news", source: "a", claim: "headline" }),
  item({ type: "macro", source: "a", claim: "CPI in line" }),
  item({ type: "sentiment", source: "a", claim: "neutral sentiment" }),
  item({ type: "historical-pattern", source: "a", claim: "pattern A" }),
  item({ type: "cross-asset", source: "a", claim: "correlated asset X" }),
  item({ type: "provider-meta", source: "a", claim: "meta note" }),
];

function main(): void {
  // ---------------------------------------------------------------------
  // Real end-to-end pipeline integration
  // ---------------------------------------------------------------------
  test("consumes a real EvidenceBundle/ReasoningResult/RiskProfile chain produced by the unmodified 15D.4/15D.5/15D.6 services", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 2685.4 })]);
    assert.equal(confidence.symbol, "XAUUSD");
    assert.equal(confidence.generatedAt, T1);
    assert.equal(confidence.categories.length, 7, "exactly 7 confidence categories");
  });

  // ---------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------
  test("determinism: assess() produces byte-identical output across two calls on the same inputs", () => {
    const { bundle, reasoning, risk } = pipeline([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2700.0 })]);
    const first = confidenceEngine.assess(bundle, reasoning, risk);
    const second = confidenceEngine.assess(bundle, reasoning, risk);
    assert.deepEqual(first, second);
  });

  // ---------------------------------------------------------------------
  // Evidence Quality
  // ---------------------------------------------------------------------
  test("evidence-quality: no evidence -> score 0, empty basis, never a fabricated default", () => {
    const { confidence } = pipeline([]);
    const c = categoryOf(confidence, "evidence-quality");
    assert.equal(c.score, 0);
    assert.deepEqual(c.basis, []);
  });

  test("evidence-quality: all items quantitatively backed -> score 100", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 1 }), item({ type: "technical", source: "a", magnitude: 55, claim: "RSI 55" })]);
    assert.equal(categoryOf(confidence, "evidence-quality").score, 100);
  });

  test("evidence-quality: no items quantitatively backed -> score 0", () => {
    const { confidence } = pipeline([item({ source: "a" }), item({ type: "news", source: "a", claim: "headline" })]);
    assert.equal(categoryOf(confidence, "evidence-quality").score, 0);
  });

  // ---------------------------------------------------------------------
  // Evidence Quantity
  // ---------------------------------------------------------------------
  test("evidence-quantity: empty bundle -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "evidence-quantity").score, 0);
  });

  test("evidence-quantity: 8 items (one per type) saturates at score 100", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(categoryOf(confidence, "evidence-quantity").score, 100);
  });

  // ---------------------------------------------------------------------
  // Evidence Agreement
  // ---------------------------------------------------------------------
  test("evidence-agreement: no evidence -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "evidence-agreement").score, 0);
  });

  test("evidence-agreement: fully agreeing evidence -> score 100", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2685.41 })]);
    assert.equal(categoryOf(confidence, "evidence-agreement").score, 100);
  });

  test("evidence-agreement: a symmetric unresolved conflict -> score 0 (nothing fully supporting)", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2750.0 })]);
    assert.equal(categoryOf(confidence, "evidence-agreement").score, 0);
  });

  // ---------------------------------------------------------------------
  // Source Diversity
  // ---------------------------------------------------------------------
  test("source-diversity: no evidence -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "source-diversity").score, 0);
  });

  test("source-diversity: single repeated source -> low score", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 2685.4 }), item({ source: "a", magnitude: 2685.4 }), item({ source: "a", magnitude: 2685.4 })]);
    assert.equal(categoryOf(confidence, "source-diversity").score, 33);
  });

  test("source-diversity: 3 distinct sources saturates at score 100", () => {
    const { confidence } = pipeline([item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2685.4 }), item({ source: "c", magnitude: 2685.4 })]);
    assert.equal(categoryOf(confidence, "source-diversity").score, 100);
  });

  // ---------------------------------------------------------------------
  // Data Freshness
  // ---------------------------------------------------------------------
  test("data-freshness: no evidence -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "data-freshness").score, 0);
  });

  test("data-freshness: fresh evidence -> score 100", () => {
    const { confidence } = pipeline([item({ source: "a", asOf: FRESH })]);
    assert.equal(categoryOf(confidence, "data-freshness").score, 100);
  });

  test("data-freshness: moderately stale (30 min) evidence -> score 60", () => {
    const { confidence } = pipeline([item({ source: "a", asOf: STALE_30 })]);
    assert.equal(categoryOf(confidence, "data-freshness").score, 60);
  });

  test("data-freshness: heavily stale (120 min) evidence -> score 20", () => {
    const { confidence } = pipeline([item({ source: "a", asOf: STALE_HEAVY })]);
    assert.equal(categoryOf(confidence, "data-freshness").score, 20);
  });

  // ---------------------------------------------------------------------
  // Coverage Completeness
  // ---------------------------------------------------------------------
  test("coverage-completeness: no evidence -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "coverage-completeness").score, 0);
  });

  test("coverage-completeness: 8 of 8 evidence types present -> score 100", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(categoryOf(confidence, "coverage-completeness").score, 100);
  });

  test("coverage-completeness: 2 of 8 evidence types present -> score 25", () => {
    const { confidence } = pipeline([item({ type: "price", source: "a" }), item({ type: "technical", source: "a", claim: "RSI neutral" })]);
    assert.equal(categoryOf(confidence, "coverage-completeness").score, 25);
  });

  // ---------------------------------------------------------------------
  // Unknown Factors
  // ---------------------------------------------------------------------
  test("unknown-factors: totally empty bundle (8 of 8 types unaddressed) -> score 0", () => {
    const { confidence } = pipeline([]);
    assert.equal(categoryOf(confidence, "unknown-factors").score, 0);
  });

  test("unknown-factors: full coverage with nothing left unresolved -> score 100", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(categoryOf(confidence, "unknown-factors").score, 100);
  });

  test("unknown-factors: full coverage plus one unresolved conflicting pair -> score reduced but not zeroed", () => {
    const { confidence } = pipeline([...FULL_COVERAGE_ITEMS, item({ type: "price", source: "b", magnitude: 2750.0 })]);
    assert.equal(categoryOf(confidence, "unknown-factors").score, 93);
  });

  // ---------------------------------------------------------------------
  // Confidence Drivers
  // ---------------------------------------------------------------------
  test("drivers: exactly one driver per category, impact reflects the >=50 score threshold", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(confidence.drivers.length, 7);
    const impactByCategory = new Map(confidence.drivers.map((d) => [d.category, d.impact]));
    assert.equal(impactByCategory.get("evidence-quality"), "negative", "only 1 of 8 items has quantitative backing");
    assert.equal(impactByCategory.get("source-diversity"), "negative", "all 8 items share a single source");
    assert.equal(impactByCategory.get("evidence-quantity"), "positive");
    assert.equal(impactByCategory.get("evidence-agreement"), "positive");
    assert.equal(impactByCategory.get("data-freshness"), "positive");
    assert.equal(impactByCategory.get("coverage-completeness"), "positive");
    assert.equal(impactByCategory.get("unknown-factors"), "positive");
  });

  // ---------------------------------------------------------------------
  // Confidence Penalties (genuine RiskProfile consumption)
  // ---------------------------------------------------------------------
  test("penalties: a real pipeline with zero evidence yields a high-risk overall verdict and a 20-point penalty", () => {
    const { risk, confidence } = pipeline([]);
    assert.equal(risk.overallLevel, "high", "sanity check on the real 15D.6 pipeline output this test depends on");
    assert.equal(confidence.penalties.length, 1);
    assert.equal(confidence.penalties[0].points, 20);
    assert.ok(confidence.penalties[0].reason.includes("high"));
  });

  test("penalties: a real pipeline with full, agreeing coverage yields a medium-risk overall verdict and an 8-point penalty", () => {
    const { risk, confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(risk.overallLevel, "medium", "sanity check: liquidity/execution risk categories are always medium, so this is the real floor");
    assert.equal(confidence.penalties.length, 1);
    assert.equal(confidence.penalties[0].points, 8);
  });

  test("penalties: a low overall RiskProfile earns no penalty entry at all (never a fabricated zero-point one)", () => {
    // RiskEngineService can never actually produce overallLevel "low" in
    // practice (liquidity/execution are permanently "medium"), so this
    // branch is exercised with a minimal hand-built RiskProfile - a
    // legitimate unit test of ConfidenceEngineService's own logic, not a
    // claim that this input occurs via the real pipeline.
    const { bundle, reasoning } = pipeline(FULL_COVERAGE_ITEMS);
    const lowRisk: RiskProfile = { symbol: "XAUUSD", categories: [], overallLevel: "low", generatedAt: T1 };
    const confidence = confidenceEngine.assess(bundle, reasoning, lowRisk);
    assert.deepEqual(confidence.penalties, []);
  });

  // ---------------------------------------------------------------------
  // Overall Confidence
  // ---------------------------------------------------------------------
  test("overall: totally empty bundle -> overallScore clamped to 0, overallLevel 'low'", () => {
    const { confidence } = pipeline([]);
    assert.equal(confidence.overallScore, 0);
    assert.equal(confidence.overallLevel, "low");
  });

  test("overall: full coverage fixture computes the exact expected average-minus-penalty score", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    // category scores: quality 13, quantity 100, agreement 100, diversity
    // 33, freshness 100, coverage 100, unknown-factors 100 -> average 78;
    // minus the 8-point medium-risk penalty -> 70.
    assert.equal(confidence.overallScore, 70);
    assert.equal(confidence.overallLevel, "high");
  });

  // ---------------------------------------------------------------------
  // Confidence Basis (de-duplicated union)
  // ---------------------------------------------------------------------
  test("basis: unions every category's basis with no duplicate evidence-item references", () => {
    const { confidence } = pipeline(FULL_COVERAGE_ITEMS);
    assert.equal(confidence.basis.length, 8, "8 distinct evidence items back this profile, even though several categories reference overlapping items");
    assert.equal(new Set(confidence.basis).size, 8, "no duplicate references");
  });

  // ---------------------------------------------------------------------
  // No fabrication
  // ---------------------------------------------------------------------
  test("no fabrication: every category rationale is non-empty, even when the score is 0", () => {
    const { confidence } = pipeline([]);
    for (const category of confidence.categories) {
      assert.ok(category.rationale.length > 0, `${category.category} must always explain its score`);
    }
  });

  test("no fabrication: a category's basis is never populated with evidence that didn't actually back its score", () => {
    const { confidence } = pipeline([item({ type: "news", source: "a", claim: "headline" })]);
    // evidence-quality: the only item has no magnitude, so basis must be empty even though evidence exists.
    assert.deepEqual(categoryOf(confidence, "evidence-quality").basis, []);
  });

  // ---------------------------------------------------------------------
  // Structural: AI-provider independent, DI-only consumption of prior engines
  // ---------------------------------------------------------------------
  test("structural: the confidence engine's import statements never reach into lib/ai, providers, or prior 15D engine classes", () => {
    const files = ["types/confidence-intelligence.ts", "services/ai/confidence/confidence-engine.service.ts"];
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
      "reasoning-engine.service",
      "risk-engine.service",
      "evidence-ranking.service",
      "evidence-collector.service",
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

  test("structural: the frozen Sprint 15C chat route has zero coupling to the confidence engine", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(!source.includes("confidence"), "chat route must not import anything from the confidence engine");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
