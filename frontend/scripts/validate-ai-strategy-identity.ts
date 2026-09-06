// scripts/validate-ai-strategy-identity.ts
// P4.8-T1 (docs/P4.8-T1-CANONICAL-AI-STRATEGY-IDENTITY.md) - pure unit
// tests (no DB, no network, no real LLM) proving the deterministic,
// per-user AI strategy identity scheme in
// services/algo-test/nl-strategy-compiler.service.ts. Same offline
// fake-AIProvider discipline as validate-nl-strategy-compiler.ts - every
// test here runs against the REAL compilation pipeline, never a mock of
// the identity logic itself.
//
// Decision 1 (revised): the canonical identity primitive is
// computeCrossPlatformSemanticHash(ir), NOT computeCanonicalIRHash(ir).
// The latter keeps `provenance`, and `provenance.sourceHash` is itself
// derived from the LLM's own restated `intent` text - it was proven,
// with a failing test, to NOT survive a phrasing-only change. See the
// P4.8-T1 doc's own "Decision-1 re-audit" section for the full trace.
import assert from "node:assert/strict";
import { computeCrossPlatformSemanticHash, computeSemanticStrategyHash } from "at24-quant-engine";
import { compileNaturalLanguageStrategy } from "../services/algo-test/nl-strategy-compiler.service";
import { getStrategyDefinition } from "../services/algo-test/strategy-registry";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionResponse } from "../lib/ai/types";

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

function fakeProvider(respond: () => string): AIProvider {
  return {
    name: "claude",
    async complete(): Promise<AICompletionResponse> {
      return { content: respond(), model: "fake-model", provider: "claude" };
    },
  };
}

function emaCrossResponse(intent: string, fastPeriod: number, slowPeriod: number): string {
  return JSON.stringify({
    intent,
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    indicators: [
      { family: "EMA", params: [fastPeriod] },
      { family: "EMA", params: [slowPeriod] },
    ],
    entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [fastPeriod] } }, right: { kind: "indicator", ref: { name: "EMA", params: [slowPeriod] } } } }],
    exitConditions: [],
    risk: { sizing: { method: "percent-equity-risk", percent: 1 }, stopLoss: { type: "fixed-distance", distance: 5 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
  });
}

const INTENT_A = "EMA 20 crosses above EMA 50 on gold M15";
const INTENT_A_REPHRASED = "Enter long on XAUUSD once the 20-period EMA crosses above the 50-period EMA on the M15 chart";
const RESPONSE_A = emaCrossResponse(INTENT_A, 20, 50);
// Byte-identical entries/exits/indicators/risk/instruments/timeframes as
// RESPONSE_A - only `intent` (the LLM's own restated wording) differs.
const RESPONSE_A_REPHRASED = emaCrossResponse(INTENT_A_REPHRASED, 20, 50);
// Genuinely different trading logic (a different EMA period) - must
// never collide with RESPONSE_A's identity.
const RESPONSE_DIFFERENT_LOGIC = emaCrossResponse(INTENT_A, 10, 50);

function identityFor(userId: string, name: string, createdAt: number) {
  return { userId, strategyVersion: "1.0.0", name, strategyTimezone: "UTC", createdAt };
}

async function main(): Promise<void> {
  console.log("=== Same user + identical semantic IR -> same hash, same strategyId ===");
  await test("compiling the identical response twice, same user, different createdAt timestamps, produces the SAME strategyId (no timestamp leaks into identity)", async () => {
    const r1 = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "A", 0));
    const r2 = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "A", 999_999_999));
    assert.ok(r1.compiledIR && r2.compiledIR);
    assert.equal(r1.compiledIR!.strategyId, r2.compiledIR!.strategyId);
    assert.equal(r1.compiledSpec!.identity.strategyId, r2.compiledSpec!.identity.strategyId);
  });

  await test("the resulting strategyId is ai-${userId}-${computeCrossPlatformSemanticHash(ir)}, verified by recomputing the hash independently on the compiled IR", async () => {
    const r = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "A", 0));
    const independentHash = computeCrossPlatformSemanticHash({ ...r.compiledIR!, strategyId: "irrelevant-placeholder" });
    assert.equal(r.compiledIR!.strategyId, `ai-user-1-${independentHash}`);
  });

  console.log("\n=== Different user + identical semantic IR -> different strategyId, same underlying hash ===");
  await test("the SAME semantic strategy compiled by two DIFFERENT users gets two DIFFERENT strategyIds, but the SAME underlying canonical hash", async () => {
    const rUser1 = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "A", 0));
    const rUser2 = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-2", "A", 0));
    assert.notEqual(rUser1.compiledIR!.strategyId, rUser2.compiledIR!.strategyId, "different users must never silently share one library identity");
    const hash1 = computeCrossPlatformSemanticHash({ ...rUser1.compiledIR!, strategyId: "x" });
    const hash2 = computeCrossPlatformSemanticHash({ ...rUser2.compiledIR!, strategyId: "x" });
    assert.equal(hash1, hash2, "the underlying semantic fingerprint must still agree - only the user scope differs");
  });

  console.log("\n=== Different semantic IR -> different identity ===");
  await test("a different EMA period (genuinely different trading logic) produces a DIFFERENT strategyId, even for the same user", async () => {
    const rA = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "A", 0));
    const rDifferent = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_DIFFERENT_LOGIC), identityFor("user-1", "A", 0));
    assert.notEqual(rA.compiledIR!.strategyId, rDifferent.compiledIR!.strategyId);
  });

  console.log("\n=== Metadata/description/generated-name changes -> identity unchanged (the adversarial case this lock specifically required) ===");
  await test("metadata-only change (identity.name differs, everything else identical, including intent) -> same strategyId", async () => {
    const rNameA = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "My EMA Strategy", 0));
    const rNameB = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "Totally Different Display Name", 0));
    assert.notEqual(rNameA.compiledIR!.metadata.name, rNameB.compiledIR!.metadata.name, "the fixture must actually vary the name - otherwise this proves nothing");
    assert.equal(rNameA.compiledIR!.strategyId, rNameB.compiledIR!.strategyId);
  });

  await test("description-only change (intent/description text differs, name identical) -> same strategyId", async () => {
    const rDescA = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "Fixed Name", 0));
    const rDescB = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A_REPHRASED), identityFor("user-1", "Fixed Name", 0));
    assert.notEqual(rDescA.compiledIR!.metadata.description, rDescB.compiledIR!.metadata.description, "the fixture must actually vary the restated intent - otherwise this proves nothing");
    assert.equal(rDescA.compiledIR!.strategyId, rDescB.compiledIR!.strategyId);
  });

  await test("LLM-restated intent change (the exact adversarial pair: name AND intent both differ, entries/exits/indicators/risk/instruments/timeframes byte-identical) -> same strategyId", async () => {
    const rOriginal = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "EMA crossover A", 0));
    const rRephrased = await compileNaturalLanguageStrategy("Go long on EMA cross", fakeProvider(() => RESPONSE_A_REPHRASED), identityFor("user-1", "Enter long on EMA cross B", 111));
    assert.notEqual(rOriginal.compiledIR!.metadata.description, rRephrased.compiledIR!.metadata.description);
    assert.notEqual(rOriginal.compiledIR!.metadata.name, rRephrased.compiledIR!.metadata.name);
    assert.equal(rOriginal.compiledIR!.strategyId, rRephrased.compiledIR!.strategyId, "computeCrossPlatformSemanticHash() must exclude metadata AND provenance - phrasing/naming must never affect logical strategy identity");
  });

  console.log("\n=== Existing non-AI identity is untouched ===");
  await test("the golden registry strategy's own identity is still the fixed literal 'sim-golden', unaffected by this phase (a wholly separate code path, never compileNaturalLanguageStrategy)", () => {
    const golden = getStrategyDefinition("golden");
    assert.ok(golden);
    const spec = golden!.buildSpec({});
    assert.equal(spec.identity.strategyId, "sim-golden");
  });

  await test("the MQL-imported ref-ema-crossover registry strategy's own identity is still its fixed literal, unaffected by this phase", () => {
    const imported = getStrategyDefinition("ref-ema-crossover");
    assert.ok(imported);
    const spec = imported!.buildSpec({});
    assert.equal(spec.identity.strategyId, "ref-ema-crossover");
  });

  console.log("\n=== The disclosed, NOT-fixed asymmetry: strategyHash still varies with name/description ===");
  await test("MEASURED, not assumed: computeSemanticStrategyHash() still produces DIFFERENT hashes for the adversarial (identical-logic, different-phrasing) pair above, because `identity.name` is real semantic content computeSemanticStrategyHash does not strip - this is the exact mismatch the P4.8-T1 lock required us to report, not silently fix", async () => {
    const rOriginal = await compileNaturalLanguageStrategy("EMA cross", fakeProvider(() => RESPONSE_A), identityFor("user-1", "EMA crossover A", 0));
    const rRephrased = await compileNaturalLanguageStrategy("Go long on EMA cross", fakeProvider(() => RESPONSE_A_REPHRASED), identityFor("user-1", "Enter long on EMA cross B", 111));
    // strategyId (the new logical-library identity) already agrees - proven above.
    assert.equal(rOriginal.compiledIR!.strategyId, rRephrased.compiledIR!.strategyId);
    // strategyHash (the existing, UNMODIFIED persisted fingerprint) does NOT -
    // computeSemanticStrategyHash(spec) keeps `identity` (which includes `name`)
    // in its hash input, and StrategySpec has no `provenance` field to lean
    // on either. Asserting the CURRENT real behavior (not equal) so a future
    // accidental change to computeSemanticStrategyHash is caught here, not
    // silently absorbed.
    const hashOriginal = computeSemanticStrategyHash(rOriginal.compiledSpec!);
    const hashRephrased = computeSemanticStrategyHash(rRephrased.compiledSpec!);
    assert.notEqual(hashOriginal, hashRephrased, "documents the known, disclosed strategyId/strategyHash split - see the P4.8-T1 doc's own stop-condition section. This gap is NOT fixed by this phase.");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
