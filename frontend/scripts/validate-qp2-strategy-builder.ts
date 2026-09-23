// scripts/validate-qp2-strategy-builder.ts
// QP-2 - Conversational Strategy Builder (docs/architecture/
// QUANT_PRO_MASTER_ARCHITECTURE_LOCK.md, QP-2 contract lock). Same two
// established conventions every prior sprint in this program uses (no
// test framework exists here, per package.json):
//   1. Real behavioral tests, including a fake AIProvider injected
//      directly at the service boundary - the SAME convention
//      validate-nl-strategy-compiler.ts already established (no real
//      ANTHROPIC_API_KEY exists in this project; every test here runs
//      offline and deterministically against controlled LLM-response
//      doubles).
//   2. Structural source verification for the locked architectural
//      decisions that can't be behaviorally observed from outside (e.g.
//      "the API route never calls compileAndRunAiStrategy/runBacktest",
//      "K0-K3's own page is untouched").
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAccumulatedIntent, classifyModification, applyModification } from "../services/algo-test/quant-strategy-builder.service";
import { explainStrategySpec } from "../lib/ai/strategy-compiler/strategy-explainer";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionRequest, AICompletionResponse } from "../lib/ai/types";
import type { StrategySpec } from "at24-quant-engine";

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

// Same fakeProvider() shape validate-nl-strategy-compiler.ts already established.
function fakeProvider(respond: (req: AICompletionRequest) => string): AIProvider {
  return {
    name: "claude",
    async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
      return { content: respond(req), model: "fake-model", provider: "claude" };
    },
  };
}

const EMA_RESPONSE = (fastPeriod: number, slowPeriod: number) =>
  JSON.stringify({
    intent: `EMA ${fastPeriod} crosses above EMA ${slowPeriod} on gold M15`,
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

const PARAMETER_ONLY_RESPONSE = (percent: number) =>
  JSON.stringify({
    intent: "EMA 20 crosses above EMA 50 on gold M15",
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    indicators: [
      { family: "EMA", params: [20] },
      { family: "EMA", params: [50] },
    ],
    entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [20] } }, right: { kind: "indicator", ref: { name: "EMA", params: [50] } } } }],
    exitConditions: [],
    risk: { sizing: { method: "percent-equity-risk", percent }, stopLoss: { type: "fixed-distance", distance: 5 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
  });

const MALFORMED_RESPONSE = "not valid json at all";

async function main(): Promise<void> {
  console.log("\n=== A - buildAccumulatedIntent (real behavior) ===");

  await test("an empty previous intent returns the new turn's own text, trimmed", () => {
    assert.equal(buildAccumulatedIntent("", "  Buy gold on EMA crossover  "), "Buy gold on EMA crossover");
  });

  await test("a non-empty previous intent is preserved, with the new turn appended as an explicit additional instruction - never replaced or lost", () => {
    const result = buildAccumulatedIntent("Buy gold on EMA crossover", "Change RSI period from 14 to 21");
    assert.ok(result.startsWith("Buy gold on EMA crossover"));
    assert.ok(result.includes("Additional instruction: Change RSI period from 14 to 21"));
  });

  console.log("\n=== B - classifyModification (real structural diff, never fabricated certainty) ===");

  const specA = { instruments: [{ symbol: "XAUUSD" }], timeframes: ["M15"], entryRules: [{ id: "e1", direction: "BUY", condition: { type: "comparison", operator: ">", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 0 } } }], exitRules: [], risk: { sizing: { method: "percent-equity-risk", percent: 1 } }, execution: { fillModel: "next-bar-open", costsExplicitlyZero: true }, identity: { strategyId: "a", name: "A" }, version: "1.0.0", metadata: { createdAt: 0 }, parameters: [] } as unknown as StrategySpec;

  await test("either spec missing (e.g. a failed compile) -> unknown, never guessed", () => {
    assert.equal(classifyModification(undefined, specA), "unknown");
    assert.equal(classifyModification(specA, undefined), "unknown");
  });

  await test("only risk/execution differ -> parameter", () => {
    const specB = { ...specA, risk: { sizing: { method: "percent-equity-risk", percent: 2 } } } as unknown as StrategySpec;
    assert.equal(classifyModification(specA, specB), "parameter");
  });

  await test("only entryRules/exitRules/instruments/timeframes differ -> logic", () => {
    const specB = { ...specA, exitRules: [{ id: "x1", condition: { type: "comparison", operator: "<", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 0 } } }] } as unknown as StrategySpec;
    assert.equal(classifyModification(specA, specB), "logic");
  });

  await test("both structural and parametric fields differ -> mixed", () => {
    const specB = { ...specA, risk: { sizing: { method: "percent-equity-risk", percent: 2 } }, exitRules: [{ id: "x1", condition: { type: "comparison", operator: "<", left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 0 } } }] } as unknown as StrategySpec;
    assert.equal(classifyModification(specA, specB), "mixed");
  });

  await test("a byte-identical recompile (no meaningful change) -> unknown, not a fabricated 'parameter' or 'logic' label", () => {
    assert.equal(classifyModification(specA, { ...specA }), "unknown");
  });

  console.log("\n=== C - applyModification (real behavior, fake provider - the actual QP-2 MODIFY pipeline) ===");

  await test("a first modification compiles via the REAL compileNaturalLanguageStrategy and produces a real compiledSpec", async () => {
    const provider = fakeProvider(() => EMA_RESPONSE(20, 50));
    const result = await applyModification({ userId: "test-user", state: { turns: [], currentIntent: "" }, userText: "Buy gold on EMA 20/50 crossover", deps: { provider } });
    assert.ok(result.run.compiledSpec);
    assert.equal(result.state.currentIntent, "Buy gold on EMA 20/50 crossover");
    assert.equal(result.state.turns.length, 2);
    assert.equal(result.state.turns[0]!.role, "user");
    assert.equal(result.state.turns[1]!.role, "assistant");
  });

  await test("a second modification accumulates on top of the first turn's intent - never discards prior conversation context", async () => {
    const provider = fakeProvider(() => PARAMETER_ONLY_RESPONSE(2));
    const firstState = { turns: [], currentIntent: "Buy gold on EMA 20/50 crossover, 1% equity risk" };
    const result = await applyModification({ userId: "test-user", state: firstState, userText: "Change risk to 2% equity", deps: { provider } });
    assert.ok(result.state.currentIntent.includes("Buy gold on EMA 20/50 crossover, 1% equity risk"));
    assert.ok(result.state.currentIntent.includes("Additional instruction: Change risk to 2% equity"));
  });

  await test("a parameter-only follow-up is classified 'parameter' via the real diff, not a separate classifier call", async () => {
    const provider = fakeProvider(() => EMA_RESPONSE(20, 50));
    const first = await applyModification({ userId: "test-user", state: { turns: [], currentIntent: "" }, userText: "Buy gold on EMA 20/50", deps: { provider } });
    const providerB = fakeProvider(() => PARAMETER_ONLY_RESPONSE(5));
    const second = await applyModification({ userId: "test-user", state: first.state, userText: "Change risk to 5%", deps: { provider: providerB } });
    assert.equal(second.modificationKind, "parameter");
  });

  await test("a failed compile (malformed LLM response) never advances currentIntent - a rejected turn must not silently become part of the strategy's own description", async () => {
    const provider = fakeProvider(() => MALFORMED_RESPONSE);
    const startState = { turns: [], currentIntent: "" };
    const result = await applyModification({ userId: "test-user", state: startState, userText: "gibberish request", deps: { provider } });
    assert.equal(result.run.compiledSpec, undefined);
    assert.equal(result.state.currentIntent, "");
  });

  console.log("\n=== D - explainStrategySpec (deterministic explanation, zero LLM, zero network) ===");

  const FULL_SPEC: StrategySpec = {
    identity: { strategyId: "s1", name: "Gold EMA Crossover" },
    version: "1.0.0",
    metadata: { createdAt: 0 },
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    parameters: [],
    entryRules: [{ id: "e1", direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [20] } }, right: { kind: "indicator", ref: { name: "EMA", params: [50] } } } }],
    exitRules: [{ id: "x1", condition: { type: "comparison", operator: "<", left: { kind: "indicator", ref: { name: "RSI", params: [14] } }, right: { kind: "literal", value: 30 } } }],
    risk: { sizing: { method: "percent-equity-risk", percent: 1 }, stopLoss: { type: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };

  await test("renders the real instrument, timeframe, entry/exit rules, sizing, stop-loss, take-profit and execution assumptions - no field fabricated, everything present in the spec", () => {
    const text = explainStrategySpec(FULL_SPEC);
    assert.ok(text.includes("XAUUSD"));
    assert.ok(text.includes("M15"));
    assert.ok(text.includes("BUY when EMA(20) crosses above EMA(50)"));
    assert.ok(text.includes("Exit when RSI(14) is less than 30"));
    assert.ok(text.includes("1% of equity at risk per trade"));
    assert.ok(text.includes("1.5x ATR(14)"));
    assert.ok(text.includes("2R (risk-multiple)"));
    assert.ok(text.includes("next-bar-open"));
    assert.ok(text.includes("zero spread/slippage/commission/fees"));
  });

  await test("a spec with no take-profit set omits the Take-profit line entirely - never renders a guessed/default value", () => {
    const specWithoutTP: StrategySpec = { ...FULL_SPEC, risk: { ...FULL_SPEC.risk, takeProfit: undefined } };
    const text = explainStrategySpec(specWithoutTP);
    assert.ok(!text.includes("Take-profit:"));
  });

  await test("never throws regardless of which sub-shape the risk/sizing fields use", () => {
    assert.doesNotThrow(() => explainStrategySpec({ ...FULL_SPEC, risk: { sizing: { method: "fixed-quantity", quantity: 1 } } }));
  });

  console.log("\n=== E - structural checks (locked QP-2 boundaries actually hold in the real source) ===");

  function readSource(relativePath: string): string {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    if (!existsSync(path)) throw new Error(`${relativePath} does not exist`);
    return readFileSync(path, "utf8");
  }

  /** Strips `//` line comments before a structural check - several of these
   *  files' own doc comments deliberately NAME the thing they're explicitly
   *  NOT doing (e.g. "never calls compileAndRunAiStrategy()"), which would
   *  otherwise false-positive a bare substring search. Only real code
   *  should ever satisfy these assertions. */
  function stripLineComments(src: string): string {
    return src.replace(/\/\/.*$/gm, "");
  }

  await test("the compile-only API route never calls compileAndRunAiStrategy or runBacktest - only the new applyModification path", () => {
    const route = stripLineComments(readSource("../app/api/private/algo-test/strategy-builder/route.ts"));
    assert.ok(route.includes("applyModification"));
    assert.ok(!route.includes("compileAndRunAiStrategy"));
    assert.ok(!route.includes("runBacktest"));
  });

  await test("the Quant Strategy Builder service calls the EXISTING compileNaturalLanguageStrategy directly - never duplicates compiler/schema logic, never calls a backtest", () => {
    const service = stripLineComments(readSource("../services/algo-test/quant-strategy-builder.service.ts"));
    assert.ok(service.includes('from "./nl-strategy-compiler.service"'));
    assert.ok(service.includes("compileNaturalLanguageStrategy("));
    assert.ok(!service.includes("runBacktest"));
    assert.ok(!service.includes("AgentRuntime"));
    assert.ok(!service.includes("agent-type-registry"));
  });

  await test("no new AgentType/AgentRuntime surface was introduced anywhere in the QP-2 files (locked decision: lightweight service, not AgentRuntime)", () => {
    for (const f of ["../services/algo-test/quant-strategy-builder.service.ts", "../app/api/private/algo-test/strategy-builder/route.ts", "../app/dashboard/quant-chat/QuantChatClient.tsx"]) {
      const src = stripLineComments(readSource(f));
      assert.ok(!src.includes("AgentRuntime"), `${f} must not reference AgentRuntime`);
      assert.ok(!src.includes("AGENT_TYPE_REGISTRY"), `${f} must not reference the agent type registry`);
    }
  });

  await test("K0-K3's own assistant page is untouched by QP-2 - it references nothing from the new Quant Chat/strategy-builder domain", () => {
    const assistantPage = readSource("../app/dashboard/assistant/page.tsx");
    assert.ok(!assistantPage.includes("quant-chat"));
    assert.ok(!assistantPage.includes("strategy-builder"));
    assert.ok(!assistantPage.includes("quantChatPromptSuggestions"));
  });

  await test("ChatWindow's new emptyState prop is optional and the original K-series copy is still the default - an existing caller passing no emptyState prop is unaffected", () => {
    const chatWindow = readSource("../components/ai/ChatWindow.tsx");
    assert.ok(chatWindow.includes("emptyState?:"));
    assert.ok(chatWindow.includes("Start your first conversation"));
    assert.ok(chatWindow.includes("Upload knowledge first"));
  });

  await test("PromptSuggestions' new suggestions prop is optional and defaults to the original promptSuggestions import - an existing caller passing no prop is unaffected", () => {
    const promptSuggestions = readSource("../components/ai/PromptSuggestions.tsx");
    assert.ok(promptSuggestions.includes("suggestions?:"));
    assert.ok(promptSuggestions.includes("suggestions ?? promptSuggestions"));
  });

  await test("MessageBubble's new strategyState field is additive - every prior field (sources/marketAnalysis/intelligence) and their render branches are still present, unchanged", () => {
    const messageBubble = readSource("../components/ai/MessageBubble.tsx");
    assert.ok(messageBubble.includes("sources?:"));
    assert.ok(messageBubble.includes("marketAnalysis?:"));
    assert.ok(messageBubble.includes("intelligence?:"));
    assert.ok(messageBubble.includes("strategyState?:"));
    assert.ok(messageBubble.includes("message.sources &&"));
    assert.ok(messageBubble.includes("message.marketAnalysis &&"));
    assert.ok(messageBubble.includes("message.intelligence &&"));
    assert.ok(messageBubble.includes("message.strategyState &&"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
