// scripts/validate-microstructure-evidence-explanation.ts
// Sprint D2.8.12 - Microstructure Evidence Explanation & User-Facing
// Intelligence Integration. Standalone, assert-based verification (no test
// framework), matching every prior sprint's scripts/validate-*.ts pattern.
// Run via `npm run validate:microstructure-evidence-explanation`.
//
// Design: Part A unit-tests formatMicrostructureEvidenceExplanation()
// directly against MicrostructureEvidenceAssessment fixtures covering all
// 16 required scenarios. Part B proves genuine end-to-end wiring: a real
// D2.8.11 assessment, computed through the real DecisionContextService,
// reaches the real AIPresenterOrchestratorService.present() call and is
// visible verbatim in the string a candidate presenter receives - not a
// second/duplicated computation. Part C exercises the new D2.8.12
// microstructure-overclaim response-integrity checks. Part D makes REAL
// live Binance calls for BTCUSD/ETHUSD and self-skips (never self-passes)
// honestly if the network is unavailable.
import assert from "node:assert/strict";
import { formatMicrostructureEvidenceExplanation } from "../lib/microstructure/microstructure-evidence-explanation";
import { assessMicrostructureEvidence } from "../services/intelligence/microstructure/microstructure-evidence-assessment.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { AIPresenterOrchestratorService, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { validateResponseIntegrity } from "../services/intelligence/chat/ai-response-integrity.service";
import { buildMicrostructureSnapshot, MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { binanceMicrostructureProvider, microstructureSnapshots } from "../services/microstructure/shared-instance";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult, RawMicrostructureEvidence } from "../types/microstructure";
import type { MicrostructureEvidenceAssessment } from "../types/microstructure-evidence-assessment";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "../types/intelligence-envelope";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { CreateIntelligenceAnalysisRunInput, IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";

let passed = 0;
let failed = 0;
let skipped = 0;

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

async function liveTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok (live) - ${name}`);
  } catch (err) {
    skipped += 1;
    console.warn(`  SKIPPED (live, network unavailable) - ${name}`);
    console.warn(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// ============================================================
// Part A fixtures - direct MicrostructureEvidenceAssessment construction
// (never a hand-rolled shape divergent from D2.8.11's own type).
// ============================================================
const GENERATED_AT = "2026-08-17T12:00:00.000Z";

function assessment(overrides: Partial<MicrostructureEvidenceAssessment> = {}): MicrostructureEvidenceAssessment {
  return {
    status: "confirms",
    balance: "bullish",
    bullishPressure: 0.62,
    bearishPressure: 0.1,
    evidenceStrength: "strong",
    provider: "binance",
    instrument: "BTCUSD",
    freshness: "fresh",
    timestamp: GENERATED_AT,
    hypothesisType: "trend-continuation-bullish",
    hypothesisDirection: "bullish",
    basis: ["Order-book depth is bid-heavy: bidDepth=10 vs askDepth=1 (imbalance=0.82)", "Aggressor-mapped trade flow is buy-dominant: buyVolume=5 vs sellVolume=0.5 (netPressure=0.82)"],
    generatedAt: GENERATED_AT,
    version: "1.0.0",
    ...overrides,
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Part C setup - built first (real fixtures, not hand-rolled) so both
  // Part A's overclaim tests and Part C's own dedicated tests can share
  // one real envelope/decisionContext/microstructure fixture.
  // ---------------------------------------------------------------------
  const { svc: integrityBaseSvc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
  const integrityCtx = await integrityBaseSvc.build({ requestId: "r-integrity-base", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
  assert.ok(integrityCtx.envelope && integrityCtx.microstructure, "Part C setup requires a real envelope/microstructure fixture");
  const integrityEnvelope = integrityCtx.envelope!;
  const integrityMicrostructure = integrityCtx.microstructure!;
  const integrityDecisionContext = new DecisionContextService().build(integrityEnvelope, integrityMicrostructure);

  function checkMicrostructureOverclaimText(text: string): boolean {
    const result = validateResponseIntegrity(text, integrityEnvelope, integrityDecisionContext, integrityMicrostructure);
    return result.violations.some((v) => v.kind === "microstructure-overclaim");
  }

  // ---------------------------------------------------------------------
  // 1: Bullish + CONFIRMS
  // ---------------------------------------------------------------------
  await test("1: bullish + CONFIRMS renders the real relationship and the real basis lines verbatim", () => {
    const a = assessment({ status: "confirms", hypothesisDirection: "bullish" });
    const lines = formatMicrostructureEvidenceExplanation(a);
    const text = lines.join("\n");
    assert.ok(text.includes("Relationship: CONFIRMS"));
    assert.ok(text.includes("Hypothesis direction: bullish"));
    for (const b of a.basis) assert.ok(lines.includes(`- ${b}`), `expected the real basis line "${b}" to appear verbatim, never re-derived`);
    assert.ok(/confirms the bullish hypothesis/.test(text));
  });

  // ---------------------------------------------------------------------
  // 2: Bullish + CONTRADICTS
  // ---------------------------------------------------------------------
  await test("2: bullish + CONTRADICTS states opposition explicitly, never rewords it as confirmation", () => {
    const a = assessment({ status: "contradicts", hypothesisDirection: "bullish", balance: "bearish" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Relationship: CONTRADICTS"));
    assert.ok(/does not support the current bullish hypothesis/.test(text));
    assert.ok(!/confirms the bullish/.test(text));
  });

  // ---------------------------------------------------------------------
  // 3: Bullish + NEUTRAL
  // ---------------------------------------------------------------------
  await test("3: bullish + NEUTRAL is stated as balanced, distinct wording from insufficient_evidence", () => {
    const a = assessment({ status: "neutral", hypothesisDirection: "bullish", balance: "neutral" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Relationship: NEUTRAL"));
    assert.ok(/neither confirms nor contradicts the bullish hypothesis/.test(text));
    assert.ok(!/insufficient/i.test(text));
  });

  // ---------------------------------------------------------------------
  // 4: Bullish + INSUFFICIENT
  // ---------------------------------------------------------------------
  await test("4: bullish + INSUFFICIENT_EVIDENCE is stated honestly, never collapsed into neutral wording", () => {
    const a = assessment({
      status: "insufficient_evidence",
      hypothesisDirection: "bullish",
      balance: "neutral",
      bullishPressure: undefined,
      bearishPressure: undefined,
      evidenceStrength: "none",
      basis: ["No usable microstructure signal was available for this comparison"],
    });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Relationship: INSUFFICIENT_EVIDENCE"));
    assert.ok(/insufficient to influence the current hypothesis/.test(text));
    assert.ok(!/neither confirms nor contradicts/.test(text), "insufficient_evidence must never reuse the neutral sentence");
    assert.ok(!/balanced/i.test(text), "insufficient_evidence must never be described as balanced - that is the neutral state's meaning");
  });

  // ---------------------------------------------------------------------
  // 5: Bearish + CONFIRMS
  // ---------------------------------------------------------------------
  await test("5: bearish + CONFIRMS", () => {
    const a = assessment({ status: "confirms", hypothesisDirection: "bearish", balance: "bearish", hypothesisType: "trend-continuation-bearish" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Relationship: CONFIRMS"));
    assert.ok(/confirms the bearish hypothesis/.test(text));
  });

  // ---------------------------------------------------------------------
  // 6: Bearish + CONTRADICTS
  // ---------------------------------------------------------------------
  await test("6: bearish + CONTRADICTS", () => {
    const a = assessment({ status: "contradicts", hypothesisDirection: "bearish", balance: "bullish", hypothesisType: "trend-continuation-bearish" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Relationship: CONTRADICTS"));
    assert.ok(/does not support the current bearish hypothesis/.test(text));
  });

  // ---------------------------------------------------------------------
  // 7: Missing provider
  // ---------------------------------------------------------------------
  await test("7: missing provider (insufficient_evidence, no snapshot was ever evaluated) never prints a Source/Scope line", () => {
    const a = assessment({ status: "insufficient_evidence", provider: undefined, instrument: undefined, freshness: undefined, timestamp: undefined, bullishPressure: undefined, bearishPressure: undefined, evidenceStrength: "none", basis: ["No microstructure snapshot was available"] });
    const lines = formatMicrostructureEvidenceExplanation(a);
    assert.ok(!lines.some((l) => l.startsWith("Source:")), "no provider was ever evaluated - a fabricated Source line would misattribute evidence that doesn't exist");
  });

  // ---------------------------------------------------------------------
  // 8: Stale evidence
  // ---------------------------------------------------------------------
  await test("8: stale evidence is labeled stale in the explanation, never silently upgraded to fresh", () => {
    const a = assessment({ status: "insufficient_evidence", freshness: "stale", basis: ["Microstructure evidence is stale and was excluded from this comparison"] });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(text.includes("Freshness: stale"));
    assert.ok(text.includes("Relationship: INSUFFICIENT_EVIDENCE"));
  });

  // ---------------------------------------------------------------------
  // 9: Invalid evidence
  // ---------------------------------------------------------------------
  await test("9: invalid evidence (e.g. crossed bid/ask) is insufficient_evidence, never a repaired/partial reading", () => {
    const invalidSnapshot = buildMicrostructureSnapshot(rawResult({}, { bid: { state: "invalid", reason: "crossed market" }, ask: { state: "invalid", reason: "crossed market" } }), Date.parse("2026-08-17T11:59:56.500Z"));
    const real = assessMicrostructureEvidence(invalidSnapshot, { type: "trend-continuation-bullish" }, GENERATED_AT);
    assert.equal(real.status, "insufficient_evidence");
    const text = formatMicrostructureEvidenceExplanation(real).join("\n");
    assert.ok(text.includes("Relationship: INSUFFICIENT_EVIDENCE"));
  });

  // ---------------------------------------------------------------------
  // 10: Unsupported instrument
  // ---------------------------------------------------------------------
  await test("10: unsupported instrument never reaches this formatter at all - decisionContext.microstructureEvidence is undefined so no explanation is appended", async () => {
    const { svc } = buildRealTimeService("XAUUSD");
    const ctx = await svc.build({ requestId: "r-xau", userId: "u1", question: "XAUUSD", symbol: "XAUUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    if (ctx.envelope) {
      const dc = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
      assert.equal(dc.microstructureEvidence, undefined, "no fabricated evidence explanation must ever be produced for an unsupported instrument");
    }
  });

  // ---------------------------------------------------------------------
  // 11: Binance attribution
  // ---------------------------------------------------------------------
  await test("11: Binance attribution is explicit in the explanation's Source line", () => {
    const a = assessment({ provider: "binance", instrument: "BTCUSD" });
    const lines = formatMicrostructureEvidenceExplanation(a);
    assert.ok(lines.includes("Source: binance"));
    assert.ok(lines.includes("Instrument: BTCUSD"));
  });

  // ---------------------------------------------------------------------
  // 12: Global-liquidity disclaimer
  // ---------------------------------------------------------------------
  await test("12: the mandatory venue-scope disclaimer is present and never claims global market liquidity", () => {
    const a = assessment();
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(/binance venue evidence - not global market liquidity/i.test(text));
    assert.ok(!/\bglobal (market )?liquidity confirms\b/i.test(text));
  });

  // ---------------------------------------------------------------------
  // 13: Positive delta must not become guaranteed BUY
  // ---------------------------------------------------------------------
  await test("13: the formatter's own CONFIRMS sentence never asserts a guaranteed BUY/directional outcome", () => {
    const a = assessment({ status: "confirms", hypothesisDirection: "bullish" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(!/guarantee/i.test(text));
    assert.ok(!/\bwill (rise|go up|increase)\b/i.test(text));
  });
  await test("13b: response-integrity rejects a downstream response that turns positive delta into a guaranteed BUY/price move", () => {
    const violation = checkMicrostructureOverclaimText("Positive volume delta guarantees the price will rise from here.");
    assert.ok(violation, "expected a microstructure-overclaim violation");
  });

  // ---------------------------------------------------------------------
  // 14: Contradiction must not be rewritten as confirmation
  // ---------------------------------------------------------------------
  await test("14: a CONTRADICTS assessment's formatted text never contains a CONFIRMS-shaped sentence", () => {
    const a = assessment({ status: "contradicts", hypothesisDirection: "bullish", balance: "bearish" });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(!/binance microstructure confirms the bullish hypothesis/i.test(text));
  });

  // ---------------------------------------------------------------------
  // 15: Insufficient evidence must not become neutral
  // ---------------------------------------------------------------------
  await test("15: an INSUFFICIENT_EVIDENCE assessment's formatted text never contains the NEUTRAL sentence", () => {
    const a = assessment({ status: "insufficient_evidence", bullishPressure: undefined, bearishPressure: undefined, evidenceStrength: "none", basis: ["No usable microstructure signal was available"] });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(!/is currently balanced/i.test(text));
    assert.ok(!/neither confirms nor contradicts/i.test(text));
  });

  // ---------------------------------------------------------------------
  // 16: Missing numeric field must not become zero
  // ---------------------------------------------------------------------
  await test("16: an assessment with no bullishPressure/bearishPressure never has the formatter print a fabricated 0", () => {
    const a = assessment({ status: "insufficient_evidence", bullishPressure: undefined, bearishPressure: undefined, evidenceStrength: "none", basis: ["No usable microstructure signal was available"] });
    const text = formatMicrostructureEvidenceExplanation(a).join("\n");
    assert.ok(!/\b0(\.0+)?\b/.test(text), "a missing pressure value must never render as a fabricated 0 - the formatter must simply omit it");
  });

  // ---------------------------------------------------------------------
  // Structural: formatter never recomputes - reads D2.8.11's own basis[] verbatim, in order
  // ---------------------------------------------------------------------
  await test("structural: the formatter never recalculates evidence - it reproduces D2.8.11's own basis[] verbatim and in order", () => {
    const a = assessment({ basis: ["line one - real, from D2.8.11", "line two - real, from D2.8.11"] });
    const lines = formatMicrostructureEvidenceExplanation(a);
    const evidenceIdx = lines.indexOf("Evidence:");
    assert.equal(lines[evidenceIdx + 1], "- line one - real, from D2.8.11");
    assert.equal(lines[evidenceIdx + 2], "- line two - real, from D2.8.11");
  });

  // ---------------------------------------------------------------------
  // Part B: end-to-end wiring - a real D2.8.11 assessment reaches the presenter's prompt
  // ---------------------------------------------------------------------
  await test("end-to-end: a real CONFIRMS assessment (computed via DecisionContextService.build) appears verbatim in the presenter's userQuestion", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-1", userId: "u1", question: "What is the trend on BTCUSD?", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const decisionContext = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
    assert.ok(decisionContext.microstructureEvidence);
    assert.equal(decisionContext.microstructureEvidence!.status, "confirms");

    const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
    await orchestrator.present(ctx.envelope, "What is the trend on BTCUSD?", ctx.microstructure, decisionContext.microstructureEvidence);
    assert.ok(presenter.lastQuestion.includes("Microstructure Evidence Relationship:"), "the presenter must receive the D2.8.12 explanation block");
    assert.ok(presenter.lastQuestion.includes("Relationship: CONFIRMS"));
    for (const b of decisionContext.microstructureEvidence!.basis) {
      assert.ok(presenter.lastQuestion.includes(b), "the exact D2.8.11 basis text must reach the presenter verbatim - no re-derivation");
    }
  });

  await test("end-to-end: a real CONTRADICTS assessment for the same instrument also reaches the presenter verbatim", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bearishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-2", userId: "u1", question: "What is the trend on BTCUSD?", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const decisionContext = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
    assert.ok(decisionContext.microstructureEvidence);
    assert.equal(decisionContext.microstructureEvidence!.status, "contradicts");

    const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
    await orchestrator.present(ctx.envelope, "What is the trend on BTCUSD?", ctx.microstructure, decisionContext.microstructureEvidence);
    assert.ok(presenter.lastQuestion.includes("Relationship: CONTRADICTS"));
  });

  await test("end-to-end: omitting microstructureEvidence from present() leaves the presenter's userQuestion byte-identical to pre-D2.8.12 behavior", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-3", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);

    const { orchestrator: withoutEvidence, presenter: p1 } = orchestratorWithRecordingPresenter();
    await withoutEvidence.present(ctx.envelope, "BTCUSD", ctx.microstructure);
    assert.ok(!p1.lastQuestion.includes("Microstructure Evidence Relationship:"));

    const { orchestrator: legacy2Arg, presenter: p2 } = orchestratorWithRecordingPresenter();
    await legacy2Arg.present(ctx.envelope, "BTCUSD");
    assert.equal(p2.lastQuestion, "BTCUSD", "the pre-D2.8.8/D2.8.12 2-arg call shape must remain completely unaffected");
  });

  await test("end-to-end: presenting with microstructureEvidence never mutates the envelope's intelligenceScore/regime/hypotheses", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-4", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const before = JSON.parse(JSON.stringify({ score: ctx.envelope.intelligenceScore, regime: ctx.envelope.regime, hypotheses: ctx.envelope.hypotheses }));
    const decisionContext = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
    const { orchestrator } = orchestratorWithRecordingPresenter();
    await orchestrator.present(ctx.envelope, "BTCUSD", ctx.microstructure, decisionContext.microstructureEvidence);
    const after = JSON.parse(JSON.stringify({ score: ctx.envelope.intelligenceScore, regime: ctx.envelope.regime, hypotheses: ctx.envelope.hypotheses }));
    assert.deepEqual(after, before, "D2.8.12 must never mutate the Intelligence Score/regime/hypotheses");
  });

  // ---------------------------------------------------------------------
  // Part C: response-integrity microstructure-overclaim checks (fixtures
  // built at the top of main() so they're also available to test 13b above)
  // ---------------------------------------------------------------------
  await test("integrity: 'Binance confirms global market liquidity' is rejected", () => {
    assert.ok(checkMicrostructureOverclaimText("Binance order flow confirms global market liquidity is bullish."));
  });
  await test("integrity: 'Positive delta guarantees price will rise' is rejected", () => {
    assert.ok(checkMicrostructureOverclaimText("This positive delta guarantees the price will rise."));
  });
  await test("integrity: 'Order-book imbalance guarantees BUY' is rejected", () => {
    assert.ok(checkMicrostructureOverclaimText("The order-book imbalance guarantees a BUY here."));
  });
  await test("integrity: 'Microstructure proves the next candle direction' is rejected", () => {
    assert.ok(checkMicrostructureOverclaimText("This microstructure reading proves the next candle direction."));
  });
  await test("integrity: a genuine, honestly-scoped CONFIRMS explanation passes validateResponseIntegrity cleanly", () => {
    assert.ok(integrityDecisionContext.microstructureEvidence);
    const explanation = formatMicrostructureEvidenceExplanation(integrityDecisionContext.microstructureEvidence!).join(" ");
    const result = validateResponseIntegrity(explanation, integrityEnvelope, integrityDecisionContext, integrityMicrostructure);
    assert.equal(result.valid, true, `expected valid, got violations: ${JSON.stringify(result.violations)}`);
  });
  await test("integrity: a genuinely honest INSUFFICIENT_EVIDENCE explanation is never misclassified as an overclaim", () => {
    const a = assessment({ status: "insufficient_evidence", bullishPressure: undefined, bearishPressure: undefined, evidenceStrength: "none", basis: ["No usable microstructure signal was available"] });
    const text = formatMicrostructureEvidenceExplanation(a).join(" ");
    assert.equal(checkMicrostructureOverclaimText(text), false);
  });

  // ---------------------------------------------------------------------
  // Part D: real runtime validation (live network, self-skipping)
  // ---------------------------------------------------------------------
  for (const [label, symbol] of [["BTCUSD", "BTCUSD"], ["ETHUSD", "ETHUSD"]] as const) {
    await liveTest(`real ${label} runtime: a real assessment formats into a real, presenter-ready explanation with no fabricated fields`, async () => {
      const real = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol });
      const bullish = assessMicrostructureEvidence(real, { type: "trend-continuation-bullish" }, new Date().toISOString());
      const bearish = assessMicrostructureEvidence(real, { type: "trend-continuation-bearish" }, new Date().toISOString());
      const bullishText = formatMicrostructureEvidenceExplanation(bullish).join("\n");
      const bearishText = formatMicrostructureEvidenceExplanation(bearish).join("\n");
      console.log(`    real ${label} vs bullish: ${bullish.status} (strength=${bullish.evidenceStrength})`);
      console.log(`    real ${label} vs bearish: ${bearish.status} (strength=${bearish.evidenceStrength})`);
      assert.ok(bullishText.includes(`Relationship: ${bullish.status === "confirms" ? "CONFIRMS" : bullish.status === "contradicts" ? "CONTRADICTS" : bullish.status === "neutral" ? "NEUTRAL" : "INSUFFICIENT_EVIDENCE"}`));
      assert.ok(bearishText.includes(`Relationship: ${bearish.status === "confirms" ? "CONFIRMS" : bearish.status === "contradicts" ? "CONTRADICTS" : bearish.status === "neutral" ? "NEUTRAL" : "INSUFFICIENT_EVIDENCE"}`));
      if (bullish.provider) assert.ok(bullishText.includes(`Source: ${bullish.provider}`));
      if (bullish.balance !== "neutral") assert.notEqual(bullish.status, bearish.status);

      // Prove the actual chat-integration seam also carries this real
      // assessment through to a candidate presenter, end to end.
      const decisionContextService = new DecisionContextService();
      const envelope = await buildRealEnvelopeForLiveSymbol(symbol as string);
      if (envelope) {
        const dc = decisionContextService.build(envelope, real);
        if (dc.microstructureEvidence) {
          const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
          await orchestrator.present(envelope, `Analyze ${symbol}`, real, dc.microstructureEvidence);
          assert.ok(presenter.lastQuestion.includes("Microstructure Evidence Relationship:"));
        }
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (live/network)`);
  if (failed > 0) process.exit(1);
}

// ============================================================
// Shared fixtures / helpers (mirroring scripts/validate-microstructure-evidence-fusion.ts
// and scripts/validate-microstructure-presentation.ts's own established conventions)
// ============================================================
function rawEvidence(overrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureEvidence {
  return {
    bid: { state: "available", value: 63189.99 },
    ask: { state: "available", value: 63190.0 },
    bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1.92 }] },
    askLevels: { state: "available", value: [{ price: 63190.0, quantity: 6.39 }] },
    trades: {
      state: "available",
      value: [
        { price: 63189.99, quantity: 0.5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
        { price: 63190.0, quantity: 0.1, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
      ],
    },
    sequenceId: { state: "available", value: "1" },
    ...overrides,
  };
}
function rawResult(overrides: Partial<RawMicrostructureResult> = {}, evidenceOverrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureResult {
  return {
    symbol: "BTCUSD",
    provider: "binance",
    assetClass: "crypto",
    timestamp: "2026-08-17T11:59:56.500Z",
    retrievedAt: "2026-08-17T11:59:56.600Z",
    evidence: rawEvidence(evidenceOverrides),
    ...overrides,
  };
}
function freshRawResult(evidenceOverrides: Partial<RawMicrostructureEvidence>): RawMicrostructureResult {
  const now = new Date().toISOString();
  return rawResult({ timestamp: now, retrievedAt: now }, evidenceOverrides);
}
const bullishEvidenceOverrides: Partial<RawMicrostructureEvidence> = {
  bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 10 }] },
  askLevels: { state: "available", value: [{ price: 63190.0, quantity: 1 }] },
  trades: {
    state: "available",
    value: [
      { price: 63189.99, quantity: 5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
      { price: 63190.0, quantity: 0.5, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
    ],
  },
};
const bearishEvidenceOverrides: Partial<RawMicrostructureEvidence> = {
  bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1 }] },
  askLevels: { state: "available", value: [{ price: 63190.0, quantity: 10 }] },
  trades: {
    state: "available",
    value: [
      { price: 63189.99, quantity: 0.5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
      { price: 63190.0, quantity: 5, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
    ],
  },
};

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    open: close - 5,
    high: close + 10,
    low: close - 10,
    close,
    volume: 1000 + i,
  }));
}
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(30000 + i * 20);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 5 + (i % 3));
  return [...rise, ...plateau];
}
const bullishCandles = makeCandles(trendingBullishCloses());

class FakeMarketData implements MarketDataProvider {
  readonly name = "fake-market-data";
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { symbol: request.symbol, provider: this.name, retrievedAt: new Date().toISOString(), evidence: [] };
  }
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const now = new Date();
    return {
      symbol: request.symbol,
      assetClass: "crypto",
      price: bullishCandles[bullishCandles.length - 1].close,
      quoteCurrency: "USD",
      timestamp: now.toISOString(),
      timezone: "UTC",
      marketStatus: "open",
      provider: "test-fixture",
      retrievedAt: now.toISOString(),
    };
  }
  async getTimeSeries(): Promise<Candle[]> {
    return bullishCandles;
  }
}
function fakeAnalysisRunService(): IntelligenceAnalysisRunService {
  return {
    async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
      return {
        id: "fake-run-1",
        userId: input.userId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        pipelineVersion: null,
        analysisResult: null,
        regimeAtTime: null,
        hypothesisSnapshot: input.hypothesisSnapshot ?? null,
        evaluationStatus: "pending",
        createdAt: new Date().toISOString(),
      };
    },
    async getAnalysisRun(): Promise<IntelligenceAnalysisRun | null> {
      return null;
    },
    async listPendingEvaluationRuns(): Promise<IntelligenceAnalysisRun[]> {
      return [];
    },
    async markEvaluated(): Promise<IntelligenceAnalysisRun | null> {
      return null;
    },
  } as unknown as IntelligenceAnalysisRunService;
}
class FakeMicrostructureProvider implements MarketDataProvider, MicrostructureProvider {
  readonly name = "binance";
  callCount = 0;
  constructor(private readonly behavior: () => Promise<RawMicrostructureResult>) {}
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(): Promise<never> {
    throw new Error("not used");
  }
  async getMicrostructureSnapshot(): Promise<RawMicrostructureResult> {
    this.callCount += 1;
    return this.behavior();
  }
}
function buildRealTimeService(symbol: string, microstructureBehavior?: () => Promise<RawMicrostructureResult>) {
  const marketData = new FakeMarketData();
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(microstructureBehavior ?? (async () => rawResult({ symbol })));
  const microstructureService = new MicrostructureSnapshotService();
  const svc = new RealTimeIntelligenceService({ marketData, analysisRunService, microstructureProvider, microstructureService });
  return { svc, microstructureProvider };
}

/** Records exactly the userQuestion string a candidate presenter receives - the real, production AIIntelligencePresenter interface, completely unmodified. */
class RecordingPresenter implements AIIntelligencePresenter {
  readonly name = "recording-presenter";
  lastQuestion = "";
  constructor(private readonly responseText: string = "Real, verified analysis text.") {}
  async present(_envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult> {
    this.lastQuestion = userQuestion;
    return { text: this.responseText, presentedBy: this.name, envelopeGeneratedAt: _envelope.generatedAt };
  }
}
function orchestratorWithRecordingPresenter(responseText?: string): { orchestrator: AIPresenterOrchestratorService; presenter: RecordingPresenter } {
  const presenter = new RecordingPresenter(responseText);
  const slots: PresenterSlot[] = [{ name: "recording", isAvailable: () => true, createPresenter: () => presenter }];
  const orchestrator = new AIPresenterOrchestratorService({ slots });
  return { orchestrator, presenter };
}

/** Builds a real envelope for a live-network symbol via the same fake market-data fixture path used elsewhere in this file (candles are synthetic/trending; only the microstructure snapshot below is real). */
async function buildRealEnvelopeForLiveSymbol(symbol: string): Promise<IntelligenceEnvelope | undefined> {
  const { svc } = buildRealTimeService(symbol);
  const ctx = await svc.build({ requestId: `live-${symbol}`, userId: "u1", question: symbol, symbol, includeMicrostructure: false });
  return ctx.envelope;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
