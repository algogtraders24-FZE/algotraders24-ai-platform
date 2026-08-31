import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSignal, firstMatchingEntryRule } from "../src/runtime/signal-generator.js";
import { buildStrategySpec, buildMarketState } from "./fixtures.js";

test("generateSignal produces BUY when the entry condition is met", () => {
  const spec = buildStrategySpec();
  const state = buildMarketState({ ema20: 2400, ema50: 2380, rsi14: 60 });
  const signal = generateSignal(spec, state);
  assert.equal(signal.direction, "BUY");
  assert.equal(signal.triggeredByRuleId, "entry-buy-ema-rsi");
  assert.equal(signal.strategyId, spec.identity.strategyId);
  assert.equal(signal.strategyVersion, spec.version);
  assert.equal(signal.generatedAt, state.asOf);
});

test("generateSignal produces FLAT when no entry condition matches", () => {
  const spec = buildStrategySpec();
  const state = buildMarketState({ ema20: 2350, ema50: 2380, rsi14: 40 });
  const signal = generateSignal(spec, state);
  assert.equal(signal.direction, "FLAT");
  assert.equal(signal.triggeredByRuleId, null);
});

test("generateSignal produces SELL when a SELL entry rule matches", () => {
  const spec = buildStrategySpec();
  const sellSpec = {
    ...spec,
    entryRules: [{ ...spec.entryRules[0]!, direction: "SELL" as const }],
  };
  const state = buildMarketState({ ema20: 2400, ema50: 2380, rsi14: 60 });
  const signal = generateSignal(sellSpec, state);
  assert.equal(signal.direction, "SELL");
});

test("firstMatchingEntryRule returns the first rule whose condition is true, in order", () => {
  const spec = buildStrategySpec();
  const secondRule = { ...spec.entryRules[0]!, id: "second-rule" };
  const state = buildMarketState({ ema20: 2400, ema50: 2380, rsi14: 60 });
  const match = firstMatchingEntryRule([spec.entryRules[0]!, secondRule], state);
  assert.equal(match?.id, "entry-buy-ema-rsi");
});
