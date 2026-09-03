// scripts/validate-nl-strategy-compiler.ts
// P4 - pure unit tests (no DB, no network, no real LLM) for
// services/algo-test/nl-strategy-compiler.service.ts. Same "no real
// ANTHROPIC_API_KEY exists in this project" reality lib/ai/providers/
// claude.provider.ts's own header already discloses - this file injects
// a fake AIProvider directly at the service boundary (never touches
// ClaudeProvider/loadAnthropicEnv at all) so every test here runs
// offline, deterministically, exercising the REAL validation/compilation
// pipeline against controlled LLM-response doubles.
import assert from "node:assert/strict";
import { compileNaturalLanguageStrategy } from "../services/algo-test/nl-strategy-compiler.service";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionRequest, AICompletionResponse } from "../lib/ai/types";

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

function fakeProvider(respond: (req: AICompletionRequest) => string): AIProvider {
  return {
    name: "claude",
    async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
      return { content: respond(req), model: "fake-model", provider: "claude" };
    },
  };
}

const IDENTITY = { strategyId: "test-strategy", strategyVersion: "1.0.0", name: "Test", strategyTimezone: "UTC", createdAt: 0 };

const VALID_EMA_CROSS_RESPONSE = JSON.stringify({
  intent: "EMA 20 crosses above EMA 50 on gold M15",
  instruments: [{ symbol: "XAUUSD" }],
  timeframes: ["M15"],
  indicators: [
    { family: "EMA", params: [20] },
    { family: "EMA", params: [50] },
  ],
  entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [20] } }, right: { kind: "indicator", ref: { name: "EMA", params: [50] } } } }],
  exitConditions: [],
  risk: { sizing: { method: "percent-equity-risk", percent: 1 }, stopLoss: { type: "fixed-distance", distance: 5 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
});

async function main(): Promise<void> {
  console.log("=== Happy path ===");
  await test("a well-formed response reaches EVIDENCE... EXECUTION_VALID, produces a real compiledSpec, and its buildIndicatorSeries genuinely fires on a real crossover", async () => {
    const provider = fakeProvider(() => VALID_EMA_CROSS_RESPONSE);
    const result = await compileNaturalLanguageStrategy("EMA 20 crosses above EMA 50 on gold M15", provider, IDENTITY);
    assert.equal(result.reachedStage, "EXECUTION_VALID");
    assert.ok(result.compiledSpec);
    assert.ok(result.buildIndicatorSeries);
    assert.equal(result.compiledSpec!.entryRules.length, 1);
    assert.equal(result.compiledSpec!.entryRules[0]!.direction, "BUY");

    // Real behavioral proof, not just structural - the SAME discipline
    // P3.6's ref-ema-crossover test established: a compiled strategy
    // that reaches EXECUTION_VALID must actually produce a real position
    // under a genuine signal, not merely have a valid-looking IR.
    const { runSimulation, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency } = await import("at24-quant-engine");
    const bars = Array.from({ length: 5 }, (_, i) => ({ timestamp: i * 900_000, instrument: { symbol: "XAUUSD" }, timeframe: "M15" as const, open: 2000, high: 2001, low: 1999, close: 2000, volume: 1000 }));
    const indicatorSeries = result.buildIndicatorSeries!(bars);
    // Force a genuine crossover on bar 2: EMA20 rises above EMA30 (EMA50 in this fixture's key), matching the compiled entry condition's own indicator keys.
    const fastKey = [...indicatorSeries.keys()].find((k) => k.startsWith("EMA(20"))!;
    const slowKey = [...indicatorSeries.keys()].find((k) => k.startsWith("EMA(50"))!;
    const forcedSeries = new Map(indicatorSeries);
    forcedSeries.set(fastKey, [100, 100, 105, 106, 107]);
    forcedSeries.set(slowKey, [100, 100, 100, 100, 100]);

    const outcome = runSimulation(bars as never, {
      strategySpec: result.compiledSpec!,
      instrument: { symbol: "XAUUSD" },
      timeframe: "M15" as never,
      initialBalance: 10_000,
      datasetId: "p4-offline-test",
      datasetVersion: "1",
      dataFidelity: "D1",
      spreadModel: ZeroSpread,
      slippageModel: ZeroSlippage,
      feeModel: ZeroFee,
      latencyModel: ZeroLatency,
      indicatorSeries: forcedSeries,
    } as never);
    assert.ok(outcome.tradeLedger.length > 0 || outcome.finalPositions.length > 0, "a genuine EMA crossover must produce a real position or trade - a decorative-only compilation would produce neither");
  });

  console.log("\n=== Honest failures at the right stage ===");
  await test("a non-JSON response fails at PARSED, not silently treated as a valid empty strategy", async () => {
    const provider = fakeProvider(() => "I cannot help with that.");
    const result = await compileNaturalLanguageStrategy("do something vague", provider, IDENTITY);
    assert.equal(result.reachedStage, "IMPORTED");
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.equal(result.compiledSpec, undefined);
  });

  await test("JSON wrapped in a markdown code fence is still extracted correctly (a common real LLM deviation from 'respond with ONLY the JSON')", async () => {
    const provider = fakeProvider(() => "Here you go:\n```json\n" + VALID_EMA_CROSS_RESPONSE + "\n```");
    const result = await compileNaturalLanguageStrategy("EMA cross", provider, IDENTITY);
    assert.equal(result.reachedStage, "EXECUTION_VALID");
  });

  await test("a missing required field fails at PARSED with a real, specific reason naming the field", async () => {
    const broken = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    delete broken.risk;
    const provider = fakeProvider(() => JSON.stringify(broken));
    const result = await compileNaturalLanguageStrategy("EMA cross", provider, IDENTITY);
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.match(result.stages.find((s) => s.stage === "PARSED")?.detail ?? "", /\$\.risk/);
  });

  await test("an unsupported symbol fails at PARSED, naming the real supported list", async () => {
    const broken = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    broken.instruments = [{ symbol: "GOOGL" }];
    const provider = fakeProvider(() => JSON.stringify(broken));
    const result = await compileNaturalLanguageStrategy("trade GOOGL", provider, IDENTITY);
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.match(result.stages.find((s) => s.stage === "PARSED")?.detail ?? "", /GOOGL/);
  });

  await test("an unsupported indicator family (MACD - real, engine-implemented, but multi-output and deliberately excluded this phase) fails at PARSED, not silently dropped or approximated", async () => {
    const broken = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    broken.indicators.push({ family: "MACD", params: [12, 26, 9] });
    const provider = fakeProvider(() => JSON.stringify(broken));
    const result = await compileNaturalLanguageStrategy("EMA cross with MACD filter", provider, IDENTITY);
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.match(result.stages.find((s) => s.stage === "PARSED")?.detail ?? "", /MACD/);
  });

  await test("a condition referencing an undeclared indicator fails at PARSED - every referenced indicator must be declared, never implicit", async () => {
    const broken = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    broken.indicators = [{ family: "EMA", params: [20] }]; // EMA(50) referenced in entryConditions but not declared
    const provider = fakeProvider(() => JSON.stringify(broken));
    const result = await compileNaturalLanguageStrategy("EMA cross", provider, IDENTITY);
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.match(result.stages.find((s) => s.stage === "PARSED")?.detail ?? "", /not declared/);
  });

  await test("an atr-multiple stopLoss without a matching declared ATR indicator fails at PARSED with the specific, actionable reason (mirrors eligibility-gate.ts's own real ATR-consistency rule, checked earlier and more specifically here)", async () => {
    const broken = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    broken.risk.stopLoss = { type: "atr-multiple", atrMultiple: 1, atrPeriod: 14 };
    const provider = fakeProvider(() => JSON.stringify(broken));
    const result = await compileNaturalLanguageStrategy("EMA cross with ATR stop", provider, IDENTITY);
    assert.equal(result.stages.find((s) => s.stage === "PARSED")?.outcome, "FAILED");
    assert.match(result.stages.find((s) => s.stage === "PARSED")?.detail ?? "", /ATR\(14\)/);
  });

  await test("declaring the matching ATR indicator makes the atr-multiple stopLoss request pass all the way to EXECUTION_VALID", async () => {
    const fixed = JSON.parse(VALID_EMA_CROSS_RESPONSE);
    fixed.risk.stopLoss = { type: "atr-multiple", atrMultiple: 1, atrPeriod: 14 };
    fixed.indicators.push({ family: "ATR", params: [14] });
    const provider = fakeProvider(() => JSON.stringify(fixed));
    const result = await compileNaturalLanguageStrategy("EMA cross with ATR stop", provider, IDENTITY);
    assert.equal(result.reachedStage, "EXECUTION_VALID");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
