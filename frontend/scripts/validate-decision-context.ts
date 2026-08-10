// scripts/validate-decision-context.ts
// Sprint D2.6.1 - Standalone validation for DecisionContextService. Pure/
// in-memory only - no database, no network, exercised end-to-end through
// the real, unmodified MarketStateService -> RegimeService ->
// HypothesisService -> IntelligenceEnvelopeService chain (same discipline
// as scripts/validate-intelligence-score.ts). Run via
// `npm run validate:decision-context`.
//
// trendingBullishCloses() is copied verbatim from
// scripts/validate-hypothesis-engine.ts (already verified there to
// produce a trending-bullish regime).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { EvidenceBundle } from "../types/evidence";
import type { RiskProfile } from "../types/risk-intelligence";
import type { HistoricalValidation } from "../types/intelligence-historical-validation";
import type { IntelligenceEnvelope } from "../types/intelligence-envelope";

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

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();
const hypothesisSvc = new HypothesisService();
const envelopeSvc = new IntelligenceEnvelopeService();
const decisionSvc = new DecisionContextService();

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

function fullEnvelope(overrides?: Partial<Parameters<IntelligenceEnvelopeService["build"]>[0]>): IntelligenceEnvelope {
  return envelopeSvc.build({
    marketState,
    regime,
    hypotheses,
    evidence: evidenceFixture(),
    risk: riskProfileFixture(),
    historicalValidation: historicalValidationFixture(),
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

// Sprint's literal prohibited examples, checked as real patterns rather
// than bare substrings - "probability of profit"/"expected return" also
// appear inside this engine's own honest NEGATION disclaimer text
// ("...is never a probability of profit...", reused verbatim from
// D2.5.5), so a naive substring search would false-positive against the
// very sentence that enforces the rule. These patterns only match an
// actual assertive claim, never the negation.
const PROHIBITED_PATTERNS: RegExp[] = [
  /buy now/i,
  /sell now/i,
  /\d+%\s*win rate/i,
  /target\s*=/i,
  /stop loss\s*=/i,
  /\d+%\s*chance/i,
  /\d+%\s*probability/i,
  /probability of profit\s*[:=]\s*\d/i,
];

async function main(): Promise<void> {
  // ---- Normal trending market ----
  await test("normal trending market: DecisionContext generated correctly with real, traceable values", () => {
    const dc = decisionSvc.build(fullEnvelope());
    assert.equal(dc.symbol, "EURUSD");
    assert.equal(dc.timeframe, "1h");
    assert.equal(dc.currentState.price, marketState.snapshot.price);
    assert.equal(dc.currentState.trendDirection, "up");
    assert.equal(dc.regimeContext.regimeType, "trending-bullish");
    assert.equal(dc.regimeContext.isReliable, true);
    assert.equal(dc.primaryHypotheses.length, 1);
    assert.equal(dc.state, "well-supported");
  });

  // ---- Conflicted evidence ----
  await test("conflicted evidence: conflict remains unresolved, state becomes conflicted, never auto-resolved", () => {
    const clean = evidenceFixture();
    const conflicting: EvidenceBundle = {
      ...clean,
      conflicts: [
        { type: "price", symbol: "EURUSD", itemA: clean.items[0], itemB: clean.items[1], resolution: "unresolved", reason: "sources disagree" },
        { type: "news", symbol: "EURUSD", itemA: clean.items[1], itemB: clean.items[2], resolution: "unresolved", reason: "sources disagree again" },
      ],
    };
    const dc = decisionSvc.build(fullEnvelope({ evidence: conflicting }));
    assert.equal(dc.unresolvedConflicts.length, 2);
    assert.ok(dc.unresolvedConflicts.every((c) => c.resolution === "unresolved"));
    assert.equal(dc.state, "conflicted");
    assert.ok(dc.summaryBasis.some((line) => line.toLowerCase().includes("evidence agreement")));
  });

  // ---- Insufficient data ----
  await test("insufficient data: decision state becomes insufficient-intelligence, regime honestly marked unreliable", () => {
    const tinyCandles = makeCandles([1.1, 1.1005, 1.1002]);
    const tinyState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(tinyCandles), candles: tinyCandles });
    const tinyRegime = regimeSvc.classify({ marketState: tinyState });
    assert.equal(tinyRegime.regimeType, "insufficient-data", "fixture sanity check");
    const envelope = envelopeSvc.build({ marketState: tinyState, regime: tinyRegime, hypotheses: [], evidence: evidenceFixture(), risk: riskProfileFixture(), generatedAt: GENERATED_AT });
    const dc = decisionSvc.build(envelope);
    assert.equal(dc.state, "insufficient-intelligence");
    assert.equal(dc.regimeContext.isReliable, false);
  });

  // ---- Hypothesis exists ----
  await test("hypothesis exists: hypothesis and invalidation condition preserved verbatim, never rewritten", () => {
    const dc = decisionSvc.build(fullEnvelope());
    assert.equal(dc.primaryHypotheses.length, 1);
    assert.equal(dc.primaryHypotheses[0].claim, hypotheses[0].statement.claim);
    assert.deepEqual(dc.primaryHypotheses[0].invalidationCondition, hypotheses[0].statement.invalidationCondition);
    assert.equal(dc.invalidationConditions.length, 1);
    assert.equal(dc.invalidationConditions[0].hypothesisId, hypotheses[0].id);
    assert.deepEqual(dc.invalidationConditions[0].referenceValue, hypotheses[0].statement.invalidationCondition.referenceValue);
  });

  // ---- No hypothesis ----
  await test("no hypothesis: never fabricates a scenario, empty arrays throughout", () => {
    const dc = decisionSvc.build(fullEnvelope({ hypotheses: [] }));
    assert.deepEqual(dc.primaryHypotheses, []);
    assert.deepEqual(dc.invalidationConditions, []);
    assert.deepEqual(dc.supportingEvidence, []);
    assert.deepEqual(dc.opposingEvidence, []);
  });

  // ---- Historical validation available ----
  await test("historical validation available: preserved verbatim from D2.5.4, never recomputed", () => {
    const hv = historicalValidationFixture({ sampleSize: 40, validatedCount: 30, invalidatedCount: 10, inconclusiveCount: 5, validatedRate: 0.75 });
    const dc = decisionSvc.build(fullEnvelope({ historicalValidation: hv }));
    assert.equal(dc.historicalContext.status, "available");
    assert.equal(dc.historicalContext.validatedRate, 0.75);
    assert.equal(dc.historicalContext.sampleSize, 40);
  });

  // ---- Historical validation unavailable ----
  await test("historical validation unavailable: explicitly represented, never fabricated", () => {
    const dcNoSegment = decisionSvc.build(fullEnvelope({ historicalValidation: undefined }));
    assert.equal(dcNoSegment.historicalContext.status, "unavailable");
    assert.equal(dcNoSegment.historicalContext.validatedRate, undefined);

    const belowMin = historicalValidationFixture({ sampleSize: 5, validatedCount: 5, invalidatedCount: 0, inconclusiveCount: 0, validatedRate: undefined });
    const dcBelowMin = decisionSvc.build(fullEnvelope({ historicalValidation: belowMin }));
    assert.equal(dcBelowMin.historicalContext.status, "insufficient-sample");
    assert.equal(dcBelowMin.historicalContext.validatedRate, undefined);
  });

  // ---- Missing risk information ----
  await test("missing risk information: preserved as unavailable, never fabricated", () => {
    const dc = decisionSvc.build(fullEnvelope({ risk: undefined }));
    assert.equal(dc.riskContext.dataAvailable, false);
    assert.deepEqual(dc.riskContext.categories, []);
    assert.ok(dc.missingInformation.some((m) => m.kind === "unavailable" && m.affectedArea === "riskContext"));
  });

  // ---- Monitoring items derived only from real conditions ----
  await test("monitoring items: derived only from real available conditions, never arbitrary", () => {
    const dc = decisionSvc.build(fullEnvelope());
    assert.ok(dc.monitoringItems.length > 0);
    for (const item of dc.monitoringItems) {
      assert.ok(item.basis.length > 0, `monitoring item "${item.category}" must have a real basis`);
    }
    assert.ok(dc.monitoringItems.some((m) => m.category === "trend"));
    assert.ok(dc.monitoringItems.some((m) => m.category === "hypothesis-invalidation"));

    // A tiny, hypothesis-less, structure-less fixture must not fabricate a trend/range/hypothesis monitoring item.
    const tinyCandles = makeCandles([1.1, 1.1005, 1.1002]);
    const tinyState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(tinyCandles), candles: tinyCandles });
    const tinyRegime = regimeSvc.classify({ marketState: tinyState });
    const tinyEnvelope = envelopeSvc.build({ marketState: tinyState, regime: tinyRegime, hypotheses: [], generatedAt: GENERATED_AT });
    const tinyDc = decisionSvc.build(tinyEnvelope);
    assert.ok(!tinyDc.monitoringItems.some((m) => m.category === "trend"), "no real trend structure exists - must not fabricate a trend monitoring item");
    assert.ok(!tinyDc.monitoringItems.some((m) => m.category === "hypothesis-invalidation"), "no hypothesis exists - must not fabricate an invalidation monitoring item");
  });

  // ---- Missing information correctly identifies unavailable data ----
  await test("missing information: distinguishes unsupported/unavailable/insufficient-data, never collapses them", () => {
    const dc = decisionSvc.build(fullEnvelope({ evidence: undefined, risk: undefined, historicalValidation: undefined }));
    const kinds = new Set(dc.missingInformation.map((m) => m.kind));
    assert.ok(kinds.has("unsupported"), "permanently-unimplemented platform fields must be reported");
    assert.ok(kinds.has("unavailable"), "unsupplied inputs must be reported");
    assert.ok(dc.missingInformation.some((m) => m.affectedArea === "riskContext" && m.kind === "unavailable"));
    assert.ok(dc.missingInformation.some((m) => m.affectedArea.includes("supportingEvidence") && m.kind === "unavailable"));
    assert.ok(dc.missingInformation.some((m) => m.affectedArea === "historicalContext" && m.kind === "unavailable"));
  });

  // ---- Intelligence score consumed unchanged ----
  await test("intelligence score: consumed unchanged from D2.5.5, never recalculated", () => {
    const envelope = fullEnvelope();
    const dc = decisionSvc.build(envelope);
    assert.equal(dc.intelligenceScore, envelope.intelligenceScore);
    assert.equal(dc.intelligenceScore.overallScore, 88);
  });

  // ---- No recalculation of MarketState/Regime ----
  await test("no recalculation: existing MarketState/Regime values are reused verbatim, never recomputed", () => {
    const envelope = fullEnvelope();
    const dc = decisionSvc.build(envelope);
    assert.equal(dc.currentState.price, envelope.marketState.snapshot.price);
    assert.equal(dc.currentState.rsi14, envelope.marketState.technical?.rsi14);
    assert.equal(dc.regimeContext.confidence, envelope.regime.confidence);
    assert.deepEqual(dc.regimeContext.basis, envelope.regime.basis);
  });

  // ---- Determinism ----
  await test("determinism: same envelope -> byte-identical DecisionContext", () => {
    const envelope = fullEnvelope();
    const a = decisionSvc.build(envelope);
    const b = decisionSvc.build(envelope);
    assert.deepEqual(a, b);
  });

  // ---- Provenance ----
  await test("provenance: every derived section carries a non-empty basis", () => {
    const dc = decisionSvc.build(fullEnvelope());
    assert.ok(dc.currentState.basis.length > 0);
    assert.ok(dc.regimeContext.basis.length > 0);
    assert.ok(dc.riskContext.basis.length > 0);
    assert.ok(dc.historicalContext.basis.length > 0);
    assert.ok(dc.summaryBasis.length > 0);
    for (const item of dc.invalidationConditions) assert.ok(item.basis.length > 0);
  });

  // ---- LLM isolation ----
  await test("structural: decision-context service never imports Gemini/Claude/OpenAI SDKs or lib/ai", () => {
    const file = "services/intelligence/decision/decision-context.service.ts";
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const needle of ["@google/genai", "lib/ai", "openai", "anthropic", "axios", "node-fetch"]) {
      assert.ok(!importLines.some((line) => line.toLowerCase().includes(needle.toLowerCase())), `${file} must not import from anything matching "${needle}"`);
    }
    for (const needle of ["fetch(", "XMLHttpRequest"]) {
      assert.ok(!source.includes(needle), `${file} must not perform a raw network call ("${needle}")`);
    }
  });

  // ---- Signal / prediction prohibition ----
  await test("signal and prediction prohibition: no BUY/SELL recommendation, win-rate claim, target/stop-loss, or probability language anywhere in the output", () => {
    const dc = decisionSvc.build(fullEnvelope());
    const text = JSON.stringify(dc);
    for (const pattern of PROHIBITED_PATTERNS) {
      assert.ok(!pattern.test(text), `DecisionContext output must not match prohibited pattern ${pattern}`);
    }
    // Also assert the type-level absence: no field on the object is literally named action/recommendation/signal/positionSize.
    const keys = JSON.stringify(Object.keys(dc));
    for (const forbiddenKey of ["action", "recommendation", "signal", "positionSize", "buySignal", "sellSignal"]) {
      assert.ok(!keys.toLowerCase().includes(forbiddenKey.toLowerCase()));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
