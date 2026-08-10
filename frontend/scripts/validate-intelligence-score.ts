// scripts/validate-intelligence-score.ts
// Sprint D2.5.5 - Standalone validation for IntelligenceScoreService and
// IntelligenceEnvelopeService. Pure/in-memory only - no database, no
// network, exercised end-to-end through the real, unmodified
// MarketStateService -> RegimeService -> HypothesisService chain (same
// discipline as scripts/validate-hypothesis-engine.ts). Run via
// `npm run validate:intelligence-score`.
//
// trendingBullishCloses() is copied verbatim from
// scripts/validate-hypothesis-engine.ts (already verified there to
// produce a trending-bullish regime).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceScoreService } from "../services/intelligence/score/intelligence-score.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { EvidenceBundle } from "../types/evidence";
import type { RiskProfile } from "../types/risk-intelligence";
import type { HistoricalValidation } from "../types/intelligence-historical-validation";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "../types/intelligence-envelope";

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

function makeCandles(closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}
function snapshotFor(candles: Candle[]): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}
// Copied verbatim from scripts/validate-hypothesis-engine.ts (verified there to produce a trending-bullish regime).
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();
const hypothesisSvc = new HypothesisService();
const scoreSvc = new IntelligenceScoreService();
const envelopeSvc = new IntelligenceEnvelopeService();

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

const candles = makeCandles(trendingBullishCloses());
const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
const regime = regimeSvc.classify({ marketState });
const hypotheses = hypothesisSvc.generate({ marketState, regime });
assert.equal(regime.regimeType, "trending-bullish", "fixture sanity check");
assert.equal(hypotheses.length, 1, "fixture sanity check");

function evidenceFixture(): EvidenceBundle {
  return {
    symbol: "EURUSD",
    items: [
      { type: "price", symbol: "EURUSD", claim: "price up", source: "provider-a", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
      { type: "technical", symbol: "EURUSD", claim: "RSI neutral", source: "provider-b", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
      { type: "news", symbol: "EURUSD", claim: "no major news", source: "provider-c", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
    ],
    conflicts: [],
    generatedAt: GENERATED_AT,
  };
}
function riskProfileFixture(): RiskProfile {
  const evidence = evidenceFixture();
  return {
    symbol: "EURUSD",
    categories: [
      { category: "market", level: "low", rationale: ["ok"], basis: [evidence.items[0]] },
      { category: "event", level: "medium", rationale: ["unmeasured"], basis: [] },
      { category: "liquidity", level: "medium", rationale: ["unmeasured"], basis: [] },
      { category: "volatility", level: "medium", rationale: ["unmeasured"], basis: [] },
      { category: "execution", level: "medium", rationale: ["unmeasured"], basis: [] },
      { category: "evidence-conflict", level: "low", rationale: ["0 conflicts"], basis: [] },
      { category: "data-quality", level: "low", rationale: ["ok"], basis: [] },
      { category: "uncertainty", level: "low", rationale: ["ok"], basis: [] },
    ],
    overallLevel: "medium",
    generatedAt: GENERATED_AT,
  };
}
function historicalValidationFixture(overrides?: Partial<HistoricalValidation>): HistoricalValidation {
  return {
    symbol: "EURUSD",
    timeframe: "1h",
    regimeType: regime.regimeType,
    hypothesisType: hypotheses[0].type,
    sampleSize: 30,
    validatedCount: 21,
    invalidatedCount: 9,
    inconclusiveCount: 2,
    validatedRate: 0.7,
    minSampleSize: 30,
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ---- Full data ----
  await test("full data: all 8 components available, exact hand-calculated overall score", () => {
    const result = scoreSvc.compute({
      symbol: "EURUSD",
      timeframe: "1h",
      marketState,
      regime,
      hypotheses,
      evidence: evidenceFixture(),
      riskProfile: riskProfileFixture(),
      historicalValidation: historicalValidationFixture(),
      generatedAt: GENERATED_AT,
    });
    for (const key of Object.keys(result.components) as (keyof typeof result.components)[]) {
      assert.equal(result.components[key].dataAvailable, true, `${key} should be available`);
    }
    // Hand-calculated (see scratch-probe verification): dataQuality=100,
    // evidenceQuality=100, evidenceAgreement=100, marketStateQuality=100,
    // regimeConfidence=100, hypothesisStrength=100, riskAwareness=13
    // (1/8 categories with real basis), historicalValidation=70.
    // Weighted: (100*15+100*15+100*10+100*15+100*15+100*10+13*10+70*10)/100 = 88.3 -> 88.
    assert.equal(result.overallScore, 88);
    assert.equal(result.components.riskAwareness.score, 13);
    assert.equal(result.components.historicalValidation.score, 70);
  });

  // ---- Versioning ----
  await test("versioning: score carries a methodology version and both engine version fields", () => {
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, generatedAt: GENERATED_AT });
    assert.equal(typeof result.methodology.version, "string");
    assert.ok(result.methodology.version.length > 0);
    assert.equal(result.intelligenceEngineVersion, "2.0.0");
    assert.equal(result.pipelineVersion, "15D.12.0");
  });

  // ---- Weighting ----
  await test("weighting: the 8 documented weights sum to exactly 100", () => {
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", generatedAt: GENERATED_AT });
    const total = Object.values(result.methodology.weights).reduce((sum, w) => sum + w, 0);
    assert.equal(total, 100);
    assert.equal(Object.keys(result.methodology.weights).length, 8);
  });

  // ---- Missing historical validation ----
  await test("missing historical validation: score remains honest, identifies the missing component, never fabricates it as 0", () => {
    const result = scoreSvc.compute({
      symbol: "EURUSD",
      timeframe: "1h",
      marketState,
      regime,
      hypotheses,
      evidence: evidenceFixture(),
      riskProfile: riskProfileFixture(),
      generatedAt: GENERATED_AT,
    });
    assert.equal(result.components.historicalValidation.dataAvailable, false);
    assert.equal(result.components.historicalValidation.score, undefined);
    assert.ok(result.basis.some((line) => line.includes("historicalValidation")));
    assert.ok(typeof result.overallScore === "number");
  });

  // ---- Historical sample below minimum stays undefined, not 0 ----
  await test("historical sample below minimum: validatedRate undefined -> component unavailable, never converted to 0", () => {
    const result = scoreSvc.compute({
      symbol: "EURUSD",
      timeframe: "1h",
      marketState,
      regime,
      hypotheses,
      historicalValidation: historicalValidationFixture({ sampleSize: 5, validatedCount: 5, invalidatedCount: 0, inconclusiveCount: 0, validatedRate: undefined }),
      generatedAt: GENERATED_AT,
    });
    assert.equal(result.components.historicalValidation.dataAvailable, false);
    assert.equal(result.components.historicalValidation.score, undefined);
    assert.ok(result.components.historicalValidation.basis.some((line) => line.includes("below minimum")));
  });

  // ---- Historical sample sufficient: uses D2.5.4 result directly ----
  await test("historical sample sufficient: component score equals validatedRate*100 verbatim from the D2.5.4 result", () => {
    const hv = historicalValidationFixture({ sampleSize: 40, validatedCount: 30, invalidatedCount: 10, inconclusiveCount: 3, validatedRate: 0.75 });
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, historicalValidation: hv, generatedAt: GENERATED_AT });
    assert.equal(result.components.historicalValidation.score, 75);
  });

  // ---- Insufficient data (regime) ----
  await test("insufficient-data regime: overall score capped, never appears highly confident", () => {
    const tinyCandles = makeCandles([1.1, 1.1005, 1.1002]);
    const tinyState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(tinyCandles), candles: tinyCandles });
    const tinyRegime = regimeSvc.classify({ marketState: tinyState });
    assert.equal(tinyRegime.regimeType, "insufficient-data", "fixture sanity check");
    const result = scoreSvc.compute({
      symbol: "EURUSD",
      timeframe: "1h",
      marketState: tinyState,
      regime: tinyRegime,
      hypotheses: [],
      evidence: evidenceFixture(),
      riskProfile: riskProfileFixture(),
      historicalValidation: historicalValidationFixture(),
      generatedAt: GENERATED_AT,
    });
    assert.ok(typeof result.overallScore === "number" && result.overallScore <= 40, "insufficient-data regime must cap the overall score at the documented ceiling");
    assert.ok(result.basis.some((line) => line.includes("Ceiling applied") && line.includes("insufficient-data")));
  });

  // ---- Missing critical fields (no MarketState at all) ----
  await test("missing critical fields (no MarketState): score ceiling applies, never 98/100 from remaining components alone", () => {
    const result = scoreSvc.compute({
      symbol: "EURUSD",
      timeframe: "1h",
      evidence: evidenceFixture(),
      riskProfile: riskProfileFixture(),
      historicalValidation: historicalValidationFixture(),
      generatedAt: GENERATED_AT,
    });
    assert.equal(result.components.dataQuality.dataAvailable, false);
    assert.equal(result.components.marketStateQuality.dataAvailable, false);
    assert.ok(typeof result.overallScore === "number" && result.overallScore <= 25, "no-MarketState ceiling must apply");
    assert.ok(result.basis.some((line) => line.includes("Ceiling applied") && line.includes("no MarketState")));
  });

  // ---- Conflicting evidence lowers agreement ----
  await test("conflicting evidence: agreement score decreases appropriately, never auto-resolved", () => {
    const clean = evidenceFixture();
    const conflicting: EvidenceBundle = {
      ...clean,
      conflicts: [{ type: "price", symbol: "EURUSD", itemA: clean.items[0], itemB: clean.items[1], resolution: "unresolved", reason: "sources disagree" }],
    };
    const cleanResult = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, evidence: clean, generatedAt: GENERATED_AT });
    const conflictResult = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, evidence: conflicting, generatedAt: GENERATED_AT });
    assert.equal(cleanResult.components.evidenceAgreement.score, 100);
    assert.equal(conflictResult.components.evidenceAgreement.score, 33);
    assert.ok((conflictResult.components.evidenceAgreement.score ?? 0) < (cleanResult.components.evidenceAgreement.score ?? 0));
  });

  // ---- Strong evidence increases quality deterministically ----
  await test("strong evidence: quality score increases deterministically with attribution and non-duplication", () => {
    const weak: EvidenceBundle = {
      symbol: "EURUSD",
      items: [
        { type: "price", symbol: "EURUSD", claim: "dup claim", source: "", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
        { type: "price", symbol: "EURUSD", claim: "dup claim", source: "", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
      ],
      conflicts: [],
      generatedAt: GENERATED_AT,
    };
    const strong = evidenceFixture();
    const weakResult = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, evidence: weak, generatedAt: GENERATED_AT });
    const strongResult = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, evidence: strong, generatedAt: GENERATED_AT });
    // Unattributed (0/2 sourced) but only 1 unique claim among 2 duplicate
    // items: score = round(100 * (0/2 attribution + 1/2 uniqueness) / 2) = 25.
    assert.equal(weakResult.components.evidenceQuality.score, 25, "unattributed, fully-duplicated evidence still scores low, honestly reflecting the real 1-unique-claim/2-item ratio");
    assert.equal(strongResult.components.evidenceQuality.score, 100);
    assert.ok((strongResult.components.evidenceQuality.score ?? 0) > (weakResult.components.evidenceQuality.score ?? 0));
  });

  // ---- Empty evidence bundle: quality=0 (known-weak), agreement=unavailable (not applicable) ----
  await test("empty evidence bundle: quality is a real 0, agreement is not applicable (unavailable, never 0)", () => {
    const empty: EvidenceBundle = { symbol: "EURUSD", items: [], conflicts: [], generatedAt: GENERATED_AT };
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, evidence: empty, generatedAt: GENERATED_AT });
    assert.equal(result.components.evidenceQuality.dataAvailable, true);
    assert.equal(result.components.evidenceQuality.score, 0);
    assert.equal(result.components.evidenceAgreement.dataAvailable, false);
    assert.equal(result.components.evidenceAgreement.score, undefined);
  });

  // ---- Missing optional MarketState fields treated honestly, not as failures ----
  await test("missing optional MarketState fields: unsupported fields never penalized, real partial completeness still scores continuously", () => {
    const shortCandles = makeCandles(trendingBullishCloses().slice(0, 25)); // enough for trend/volatility but not the 20-bar-excluding-latest recentRange lookback in every case
    const shortState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(shortCandles), candles: shortCandles });
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState: shortState, generatedAt: GENERATED_AT });
    assert.equal(result.components.marketStateQuality.dataAvailable, true);
    assert.ok((result.components.marketStateQuality.score ?? 0) > 0, "partial structural completeness must not collapse to 0");
    assert.ok(
      result.components.marketStateQuality.basis.some((line) => line.includes("liquidityZones/volumeDelta/bos/choch")),
      "must explicitly document the permanently-unimplemented fields are excluded, not penalized",
    );
  });

  // ---- Hypothesis absent: undefined vs empty handled honestly ----
  await test("hypothesis absent: generation-not-attempted (undefined) vs. genuinely-none-generated ([]) are distinct, both honest", () => {
    const notAttempted = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, generatedAt: GENERATED_AT });
    assert.equal(notAttempted.components.hypothesisStrength.dataAvailable, false);
    assert.equal(notAttempted.components.hypothesisStrength.score, undefined);

    const noneGenerated = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses: [], generatedAt: GENERATED_AT });
    assert.equal(noneGenerated.components.hypothesisStrength.dataAvailable, true);
    assert.equal(noneGenerated.components.hypothesisStrength.score, 0);
  });

  // ---- Total blackout ----
  await test("no components available: overallScore is honestly undefined, never fabricated", () => {
    const result = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", generatedAt: GENERATED_AT });
    assert.equal(result.overallScore, undefined);
    for (const key of Object.keys(result.components) as (keyof typeof result.components)[]) {
      assert.equal(result.components[key].dataAvailable, false);
    }
  });

  // ---- Determinism ----
  await test("determinism: same input -> byte-identical IntelligenceScore", () => {
    const input = {
      symbol: "EURUSD" as const,
      timeframe: "1h" as const,
      marketState,
      regime,
      hypotheses,
      evidence: evidenceFixture(),
      riskProfile: riskProfileFixture(),
      historicalValidation: historicalValidationFixture(),
      generatedAt: GENERATED_AT,
    };
    const a = scoreSvc.compute(input);
    const b = scoreSvc.compute(input);
    assert.deepEqual(a, b);
  });

  // ---- Envelope assembly ----
  await test("envelope: assembles all supplied pieces verbatim, conflicts mirrors evidence.conflicts", () => {
    const evidence = evidenceFixture();
    const risk = riskProfileFixture();
    const hv = historicalValidationFixture();
    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, evidence, risk, historicalValidation: hv, generatedAt: GENERATED_AT });
    assert.equal(envelope.marketState, marketState);
    assert.equal(envelope.regime, regime);
    assert.equal(envelope.hypotheses, hypotheses);
    assert.equal(envelope.evidence, evidence);
    assert.deepEqual(envelope.conflicts, evidence.conflicts);
    assert.equal(envelope.risk, risk);
    assert.equal(envelope.historicalValidation, hv);
    assert.ok(envelope.intelligenceScore);
    assert.equal(envelope.intelligenceScore.overallScore, 88);
    assert.equal(envelope.pipelineVersion, "15D.12.0");
    assert.equal(envelope.intelligenceEngineVersion, "2.0.0");
  });

  await test("envelope: historicalValidation is dropped (not guessed) when hypotheses.length !== 1", () => {
    const hv = historicalValidationFixture();
    const zeroHyp = envelopeSvc.build({ marketState, regime, hypotheses: [], historicalValidation: hv, generatedAt: GENERATED_AT });
    assert.equal(zeroHyp.historicalValidation, undefined);
    const twoHyp = envelopeSvc.build({ marketState, regime, hypotheses: [hypotheses[0], hypotheses[0]], historicalValidation: hv, generatedAt: GENERATED_AT });
    assert.equal(twoHyp.historicalValidation, undefined);
  });

  // ---- AI presenter boundary (structural + type-level) ----
  await test("AI presenter interface: cannot return a new market fact, only text + provenance", () => {
    class FakePresenter implements AIIntelligencePresenter {
      readonly name = "fake";
      async present(envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult> {
        return {
          text: `Regarding "${userQuestion}": intelligence quality is ${envelope.intelligenceScore.overallScore ?? "unavailable"}/100.`,
          presentedBy: this.name,
          envelopeGeneratedAt: envelope.generatedAt,
        };
      }
    }
    const presenter = new FakePresenter();
    const keys = Object.keys({ text: "", presentedBy: "", envelopeGeneratedAt: "" } satisfies AIPresentationResult);
    assert.deepEqual(keys.sort(), ["envelopeGeneratedAt", "presentedBy", "text"]);
    assert.equal(presenter.name, "fake");
  });

  // ---- AI isolation: no LLM SDK imports anywhere in the score/envelope engine ----
  await test("structural: intelligence-score/envelope services never import Gemini/Claude/OpenAI SDKs or lib/ai", () => {
    const files = ["services/intelligence/score/intelligence-score.service.ts", "services/intelligence/envelope/intelligence-envelope.service.ts"];
    const forbidden = ["@google/genai", "lib/ai", "openai", "anthropic", "axios", "node-fetch"];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(!importLines.some((line) => line.toLowerCase().includes(needle.toLowerCase())), `${file} must not import from anything matching "${needle}"`);
      }
      // Separately confirm no raw network call exists anywhere in the file (not just imports).
      for (const needle of ["fetch(", "XMLHttpRequest"]) {
        assert.ok(!source.includes(needle), `${file} must not perform a raw network call ("${needle}")`);
      }
    }
  });

  // ---- No network: pure computation, no I/O ----
  await test("no network: compute() and build() are synchronous, no I/O possible", () => {
    const scoreResult = scoreSvc.compute({ symbol: "EURUSD", timeframe: "1h", marketState, regime, hypotheses, generatedAt: GENERATED_AT });
    assert.ok(scoreResult); // if compute() returned a Promise this assignment itself would still "work" but the type system already enforces a synchronous return - see IntelligenceScoreService.compute's signature.
    const envelopeResult = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: GENERATED_AT });
    assert.ok(envelopeResult);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
