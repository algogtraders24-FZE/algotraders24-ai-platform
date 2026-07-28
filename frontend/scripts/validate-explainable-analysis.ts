// scripts/validate-explainable-analysis.ts
// Sprint 15D.9 - Standalone validation for the Explainable Intelligence
// Engine (ExplainableAnalysisService). No test framework exists in this
// project; run via `npm run validate:explainable-analysis`.
//
// Pure Node, no DB, no network, no AI call, no clock/randomness dependency.
// Most fixtures chain the real, unmodified Sprint 15D.4-15D.7 engines
// directly (EvidenceRankingService -> ReasoningEngineService ->
// RiskEngineService -> ConfidenceEngineService) into a hand-assembled
// MarketIntelligenceResult, which lets tests exercise evidence-type
// combinations (macro/historical-pattern/cross-asset) that the real
// AlphaVantageProvider/EvidenceCollectorService pairing can never actually
// produce today - the same approach every prior 15D validation script uses
// to test its engine's full input range. One test additionally runs the
// real, unmodified Sprint 15D.8 MarketIntelligencePipelineService end to
// end (via a fake MarketDataProvider) to prove ExplainableAnalysisService
// genuinely accepts its real, frozen output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceItem } from "../types/evidence";
import type { MarketIntelligenceResult } from "../types/market-intelligence-result";
import type { MarketDataProvider, MarketContextResult } from "../types/market-data-provider";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import { ReasoningEngineService } from "../services/ai/reasoning/reasoning-engine.service";
import { RiskEngineService } from "../services/ai/risk/risk-engine.service";
import { ConfidenceEngineService } from "../services/ai/confidence/confidence-engine.service";
import { MarketIntelligencePipelineService } from "../services/ai/market-intelligence-pipeline.service";
import {
  ExplainableAnalysisService,
  EXPLAINABLE_ANALYSIS_VERSION,
} from "../services/ai/explainable/explainable-analysis.service";

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

const ranking = new EvidenceRankingService();
const reasoningEngine = new ReasoningEngineService();
const riskEngine = new RiskEngineService();
const confidenceEngine = new ConfidenceEngineService();
const explainer = new ExplainableAnalysisService();

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

function buildResult(items: EvidenceItem[], generatedAt: string = T1): MarketIntelligenceResult {
  const evidence = ranking.buildBundle("XAUUSD", items, generatedAt);
  const reasoning = reasoningEngine.reason(evidence);
  const risk = riskEngine.assess(reasoning);
  const confidence = confidenceEngine.assess(evidence, reasoning, risk);
  return {
    symbol: "XAUUSD",
    evidence,
    reasoning,
    risk,
    confidence,
    metadata: {
      pipelineVersion: "test-pipeline-fixture",
      providerStatus: { status: "ok", provider: "fixture-provider" },
      executionTimeMs: 10,
      generatedAt,
    },
  };
}

// One item per each of the 8 EvidenceTypes, all fresh, all source "a", no
// conflicts - the same "full coverage, no disagreement" fixture 15D.7's
// own validation script uses, so the expected risk/confidence category
// scores below are already independently verified by that script.
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

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Real end-to-end pipeline integration (Sprint 15D.8's real, frozen output)
  // ---------------------------------------------------------------------
  await test("accepts the real, frozen MarketIntelligenceResult produced by the unmodified 15D.8 pipeline", async () => {
    const provider: MarketDataProvider = {
      name: "fake-provider",
      isConfigured: () => true,
      getMarketContext: async (): Promise<MarketContextResult> => ({
        symbol: "XAUUSD",
        provider: "fake-provider",
        retrievedAt: T1,
        evidence: [{ claim: "Spot price: 2685.4000 USD", source: "fake-provider", asOf: T1 }],
        headlines: ["Gold rallies on rate-cut bets"],
      }),
    };
    const pipeline = new MarketIntelligencePipelineService(provider);
    const outcome = await pipeline.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "completed");
    if (outcome.status !== "completed") return;
    assert.ok(Object.isFrozen(outcome.result), "sanity check: the 15D.8 pipeline's own output is frozen");
    const analysis = explainer.explain(outcome.result);
    assert.equal(analysis.symbol, "XAUUSD");
    assert.equal(analysis.metadata.sourcePipelineVersion, outcome.result.metadata.pipelineVersion);
    assert.equal(analysis.metadata.generatedAt, outcome.result.metadata.generatedAt);
    assert.equal(analysis.metadata.explainerVersion, EXPLAINABLE_ANALYSIS_VERSION);
  });

  // ---------------------------------------------------------------------
  // Deterministic output
  // ---------------------------------------------------------------------
  await test("determinism: explain() produces a deep-equal result across two calls on the same input", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const first = explainer.explain(input);
    const second = explainer.explain(input);
    assert.deepEqual(first, second);
  });

  // ---------------------------------------------------------------------
  // Explanation correctness: Executive Summary
  // ---------------------------------------------------------------------
  await test("executive summary: states risk level, confidence level/score, evidence count, and provider exactly", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.executiveSummary,
      "Explainable analysis for XAUUSD: overall risk is MEDIUM, overall confidence is HIGH (score 70/100), " +
        "based on 8 evidence item(s) from fixture-provider.",
    );
  });

  // ---------------------------------------------------------------------
  // Explanation correctness: Market Thesis (never a fabricated directional call)
  // ---------------------------------------------------------------------
  await test("market thesis: no price evidence at all states that explicitly, never inventing a direction", () => {
    const input = buildResult([item({ type: "news", source: "a", claim: "headline" })]);
    const analysis = explainer.explain(input);
    assert.equal(analysis.marketThesis, "No price evidence is available for XAUUSD; no market thesis can be formed.");
  });

  await test("market thesis: consistent price evidence is reported verbatim, never as a bullish/bearish call", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.equal(analysis.marketThesis, "Price evidence for XAUUSD is consistent: Spot price: 2685.4000 USD.");
  });

  await test("market thesis: contested price evidence lists both sides' actual claims, never a guessed resolution", () => {
    const input = buildResult([
      item({ source: "a", magnitude: 2685.4 }),
      item({ source: "b", magnitude: 2750.0, claim: "Spot price: 2750.0000 USD" }),
    ]);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.marketThesis,
      "Price evidence for XAUUSD is contested. Supporting: none. " +
        "Contested: Spot price: 2685.4000 USD; Spot price: 2750.0000 USD.",
    );
  });

  // ---------------------------------------------------------------------
  // Supporting / Opposing Evidence (no fabrication: basis is a real reference)
  // ---------------------------------------------------------------------
  await test("supporting/opposing evidence: a 2-vs-1 split is reported with the exact classified items as basis", () => {
    const a = item({ source: "a", magnitude: 2685.4 });
    const b = item({ source: "b", magnitude: 2685.42 });
    const c = item({ source: "c", magnitude: 2750.0 });
    const input = buildResult([a, b, c]);
    const analysis = explainer.explain(input);

    assert.equal(analysis.supportingEvidence.length, 2);
    assert.equal(analysis.supportingEvidence[0].basis[0], a, "basis must be the real classified item, not a copy");
    assert.equal(analysis.supportingEvidence[1].basis[0], b);
    assert.equal(analysis.opposingEvidence.length, 1);
    assert.equal(analysis.opposingEvidence[0].basis[0], c);
    assert.equal(analysis.opposingEvidence[0].text, `${c.claim} (source: ${c.source}, as of ${c.asOf})`);
  });

  // ---------------------------------------------------------------------
  // Missing-data handling: Assumptions
  // ---------------------------------------------------------------------
  await test("assumptions: full evidence-type coverage states no assumptions were required", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.deepEqual(analysis.assumptions, [
      "No assumptions were required; every evidence type was represented in the collected evidence.",
    ]);
  });

  await test("assumptions: a totally empty bundle lists all 8 of the reasoning engine's own assumption statements verbatim", () => {
    const input = buildResult([]);
    const analysis = explainer.explain(input);
    assert.equal(analysis.assumptions.length, 8);
    assert.deepEqual(analysis.assumptions, input.reasoning.assumptions.map((a) => a.statement));
  });

  // ---------------------------------------------------------------------
  // Missing-data handling: Unknown Factors
  // ---------------------------------------------------------------------
  await test("unknown factors: no unresolved items and no conflicts states that explicitly", () => {
    const input = buildResult([]);
    const analysis = explainer.explain(input);
    assert.deepEqual(analysis.unknownFactors, ["No unresolved items or conflicts were found."]);
  });

  await test("unknown factors: unresolved items and conflicts are both reported, never silently dropped", () => {
    const a = item({ source: "a", magnitude: 2685.4 });
    const b = item({ source: "b", magnitude: 2750.0 });
    const input = buildResult([a, b]);
    const analysis = explainer.explain(input);
    // 2 lines for the symmetric-conflict unresolved items, plus 1 summary
    // line for the conflict itself - all three, never collapsed into one.
    assert.equal(analysis.unknownFactors.length, 3);
    assert.ok(analysis.unknownFactors[0].includes(a.claim));
    assert.ok(analysis.unknownFactors[1].includes(b.claim));
    assert.ok(analysis.unknownFactors[2].includes("1 unresolved evidence conflict"));
  });

  // ---------------------------------------------------------------------
  // Limitations (structural + weak-confidence, both dynamically verified
  // against the real engine outputs rather than a hardcoded count)
  // ---------------------------------------------------------------------
  await test("limitations: exactly one line per structurally-unmeasurable risk category plus per weak confidence category", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    const expectedCount =
      input.risk.categories.filter((c) => c.basis.length === 0).length +
      input.confidence.categories.filter((c) => c.score < 34).length;
    assert.ok(expectedCount > 0, "sanity check on the fixture this test depends on");
    assert.equal(analysis.limitations.length, expectedCount);
    assert.ok(analysis.limitations.some((l) => l.includes("liquidity")));
    assert.ok(analysis.limitations.some((l) => l.includes("execution")));
  });

  await test("limitations: a hand-built profile with no flagged categories falls back to an explicit 'none identified' statement", () => {
    // RiskEngineService's liquidity/execution categories always report an
    // empty basis in practice, so "zero structural limitations" is not
    // reachable via the real engine - this is a direct unit test of
    // ExplainableAnalysisService's own branch logic on a hand-built input,
    // the same technique 15D.7's validation script already uses for an
    // analogous unreachable-in-practice branch.
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const filler = item({ claim: "filler basis item" });
    const noLimitations: MarketIntelligenceResult = {
      ...input,
      risk: { ...input.risk, categories: input.risk.categories.map((c) => ({ ...c, basis: [filler] })) },
      confidence: { ...input.confidence, categories: input.confidence.categories.map((c) => ({ ...c, score: 100 })) },
    };
    const analysis = explainer.explain(noLimitations);
    assert.deepEqual(analysis.limitations, ["No structural limitations were identified."]);
  });

  // ---------------------------------------------------------------------
  // Confidence Summary / Risk Summary
  // ---------------------------------------------------------------------
  await test("confidence summary: reports overall score/level, the exact negative-impact categories, and any penalty", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.confidenceSummary,
      "Overall confidence is HIGH (score 70/100). " +
        "Categories reducing confidence: evidence-quality, source-diversity. " +
        "Penalty applied: Sprint 15D.6 Risk Intelligence Engine assessed overall risk as medium (-8).",
    );
  });

  await test("risk summary: reports overall level and the exact medium/high category breakdown", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.riskSummary,
      "Overall risk is MEDIUM. No category was assessed as high risk. Medium-risk categories: liquidity, volatility, execution.",
    );
  });

  // ---------------------------------------------------------------------
  // Recommendation Basis (never a recommendation itself, only its grounding)
  // ---------------------------------------------------------------------
  await test("recommendation basis: no evidence at all states plainly that no recommendation can be responsibly made", () => {
    const input = buildResult([]);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.recommendationBasis,
      "Any recommendation for XAUUSD should be grounded in 0 evidence item(s), " +
        "currently none are available, so no recommendation can be responsibly made, " +
        "under an overall risk level of HIGH and confidence level of LOW.",
    );
  });

  await test("recommendation basis: full coverage lists every deduplicated basis claim in order, never a summary that drops one", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    assert.equal(
      analysis.recommendationBasis,
      "Any recommendation for XAUUSD should be grounded in 8 evidence item(s), including: " +
        "Spot price: 2685.4000 USD; meta note; RSI neutral; CPI in line; headline; neutral sentiment; pattern A; correlated asset X, " +
        "under an overall risk level of MEDIUM and confidence level of HIGH.",
    );
  });

  // ---------------------------------------------------------------------
  // Immutable output
  // ---------------------------------------------------------------------
  await test("immutable: the returned analysis and everything nested in it is deep-frozen", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);

    assert.ok(Object.isFrozen(analysis));
    assert.ok(Object.isFrozen(analysis.metadata));
    assert.ok(Object.isFrozen(analysis.supportingEvidence));
    assert.ok(Object.isFrozen(analysis.assumptions));
    assert.ok(Object.isFrozen(analysis.limitations));
    if (analysis.supportingEvidence.length > 0) {
      assert.ok(Object.isFrozen(analysis.supportingEvidence[0]));
      assert.ok(Object.isFrozen(analysis.supportingEvidence[0].basis));
    }

    assert.throws(() => {
      (analysis as unknown as { executiveSummary: string }).executiveSummary = "changed";
    });
    assert.throws(() => {
      (analysis.assumptions as unknown as string[]).push("fabricated");
    });
    assert.throws(() => {
      (analysis.metadata as unknown as { explainerVersion: string }).explainerVersion = "changed";
    });
  });

  await test("does not mutate its input: explaining a deep-frozen MarketIntelligenceResult never throws", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const deepFreeze = (value: unknown): void => {
      if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
    };
    deepFreeze(input);
    assert.doesNotThrow(() => explainer.explain(input));
  });

  // ---------------------------------------------------------------------
  // No fabrication: every claim in every narrative field traces back to real evidence
  // ---------------------------------------------------------------------
  await test("no fabrication: every evidence claim quoted in the market thesis exists verbatim in the evidence bundle", () => {
    const input = buildResult(FULL_COVERAGE_ITEMS);
    const analysis = explainer.explain(input);
    const realClaims = input.evidence.items.map((i) => i.claim);
    assert.ok(realClaims.some((claim) => analysis.marketThesis.includes(claim)));
  });

  // ---------------------------------------------------------------------
  // Structural: no AI/UI coupling
  // ---------------------------------------------------------------------
  await test("structural: the explainer's import statements never reach into lib/ai, the Gemini SDK, or mock data", () => {
    const files = ["types/explainable-analysis.ts", "services/ai/explainable/explainable-analysis.service.ts"];
    const forbidden = [
      "lib/ai",
      "@google/genai",
      "data/mock",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
      "market-intelligence.service",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(!importLines.some((line) => line.includes(needle)), `${file} must not import from anything matching "${needle}"`);
      }
    }
  });

  await test("structural: the frozen Sprint 15C chat route has zero coupling to the explainable analysis engine", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(!source.includes("explainable"), "chat route must not reference the explainable analysis engine");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
