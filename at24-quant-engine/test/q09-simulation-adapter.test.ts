import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIndicatorSeriesFromIR, compileToSimulation, type SimulationAdapterOptions } from "../src/runtime/reduction/simulation-adapter.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import { fixtureEMACrossover, fixtureRepainting, fixtureMQL5Netting } from "./fixtures/strategy-ir-fixtures.js";
import { buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";

const SIM_OPTIONS: SimulationAdapterOptions = {
  initialBalance: 10000,
  datasetId: "adapter-test",
  datasetVersion: "v1",
  dataFidelity: "D1",
  spreadModel: ZeroSpread,
  slippageModel: ZeroSlippage,
  feeModel: ZeroFee,
  latencyModel: ZeroLatency,
  fidelity: "D1_OHLC",
};

test("Q0.9: buildIndicatorSeriesFromIR computes the correct EMA warmup (period bars) and keys series identically to indicatorKey()", () => {
  const ir = fixtureEMACrossover();
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.equal(built.blockingReasons.length, 0);
  assert.equal(built.warmupBars, 21); // max(EMA(9)=9, EMA(21)=21)
  assert.ok(built.series.has(indicatorKey(indicator("EMA", 9))));
  assert.ok(built.series.has(indicatorKey(indicator("EMA", 21))));
});

test("Q0.9: buildIndicatorSeriesFromIR blocks (never crashes) on a generic indicator with no executable runtime implementation", () => {
  const ir = { ...fixtureEMACrossover(), indicators: [{ kind: "generic" as const, name: "CustomThing", parameters: [1], inputs: ["close" as const], outputFields: ["value"] }] };
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.ok(built.blockingReasons.some((r) => r.includes("generic indicator")));
  assert.equal(built.series.size, 0);
});

test("Q0.9: buildIndicatorSeriesFromIR blocks on a multi-output family (MACD/BOLLINGER_BANDS) — never partially wired", () => {
  const ir = { ...fixtureEMACrossover(), indicators: [{ kind: "named" as const, family: "MACD" as const, params: [12, 26, 9] }] };
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.ok(built.blockingReasons.some((r) => r.includes("MACD")));
});

test("Q0.9: buildIndicatorSeriesFromIR blocks on an invalid (non-positive/non-finite) period parameter", () => {
  const ir = { ...fixtureEMACrossover(), indicators: [{ kind: "named" as const, family: "EMA" as const, params: [-5] }] };
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.ok(built.blockingReasons.some((r) => r.includes("invalid period")));
});

test("Q0.9: compileToSimulation throws (never fabricates a result) when handed a BLOCKED compilation", () => {
  const compilation = compileStrategy(fixtureRepainting());
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  assert.throws(() => compileToSimulation(compilation, bars, SIM_OPTIONS), /BLOCKED compilation/);
});

test("Q0.9: compileToSimulation throws an explicit, clear error (never a silent zero-bar truncation) when bars.length <= warmup requirement", () => {
  const netting = fixtureMQL5Netting();
  const ema = fixtureEMACrossover();
  const ir = { ...netting, indicators: ema.indicators, entries: ema.entries, exits: [] };
  const compilation = compileStrategy(ir);
  const tooFewBars = buildSyntheticFxBars(3, ir.instruments[0]!.symbol, ir.timeframes[0]!);
  assert.throws(() => compileToSimulation(compilation, tooFewBars, SIM_OPTIONS), /insufficient bars for indicator warmup/);
});

test("Q0.9: the warmup-sliced bars/series passed into the underlying simulation never include an undefined indicator value at index 0 (the exact bug this fix resolves)", () => {
  const netting = fixtureMQL5Netting();
  const ema = fixtureEMACrossover();
  const ir = { ...netting, indicators: ema.indicators, entries: ema.entries.map((e) => ({ ...e, id: e.id })), exits: [] };
  const bars = buildSyntheticFxBars(120, ir.instruments[0]!.symbol, ir.timeframes[0]!);
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.ok(built.series.size > 0);
  for (const [, values] of built.series) {
    assert.ok(values.length - built.warmupBars > 0);
    assert.notEqual(values[built.warmupBars], undefined);
  }
});
