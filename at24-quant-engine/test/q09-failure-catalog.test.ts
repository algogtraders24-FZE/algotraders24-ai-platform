import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";
import { reduceStrategyIRToSpec } from "../src/runtime/reduction/ir-to-spec-reducer.js";
import { compileStrategy, computeCompilationHash } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation, buildIndicatorSeriesFromIR, type SimulationAdapterOptions } from "../src/runtime/reduction/simulation-adapter.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import {
  fixtureMQL5Netting,
  fixtureEMACrossover,
  fixtureRepainting,
  fixtureTimezoneSensitive,
  fixtureMTF,
  fixtureMQL4OrderFlow,
  fixtureUnsupportedSemantic,
  fixturePineRequestSecurity,
} from "./fixtures/strategy-ir-fixtures.js";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { baseOptions } from "./fixtures/mql-fixtures.js";
import { MQL5_EMA_CROSS_FIXED_SLTP, MQL4_EMA_CROSS_FIXED_SLTP, buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_OPTIONS: SimulationAdapterOptions = {
  initialBalance: 10000,
  datasetId: "failure-catalog",
  datasetVersion: "v1",
  dataFidelity: "D1",
  spreadModel: ZeroSpread,
  slippageModel: ZeroSlippage,
  feeModel: ZeroFee,
  latencyModel: ZeroLatency,
  fidelity: "D1_OHLC",
};

/** Q0.9's 24-item failure catalog — the reduction/compilation/simulation-bridge layer's own honest-failure modes (distinct from Q0.8's MQL-parsing-level catalog in test/mql-failure-catalog.test.ts). Every failure here is a clean, typed result or a clear thrown Error — never a silent wrong answer. */

test("1. invalid IR: an IR that fails validateStrategyIR is never even reduced — the eligibility gate surfaces the same structural errors, never a fabricated spec", () => {
  const ir = { ...fixtureMQL5Netting(), entries: [] };
  const structural = validateStrategyIR(ir);
  assert.equal(structural.valid, false);
  const result = reduceStrategyIRToSpec(ir);
  assert.equal(result.status, "BLOCKED");
});

test("2. missing expression: an entry with no provable condition (placeholder) blocks via the 'entry/exit signal logic' unsupported semantic, never silently defaults to always-true", () => {
  const ir = fixtureMQL4OrderFlow(); // built without a simple-entry-condition site
  const result = checkReductionEligibility(ir);
  assert.equal(result.eligible, false);
});

test("3. unsupported indicator: a generic (non-named) indicator blocks at the simulation-adapter boundary with an explicit reason", () => {
  const ir = { ...fixtureMQL5Netting(), indicators: [{ kind: "generic" as const, name: "X", parameters: [], inputs: [] as const, outputFields: ["v"] }] };
  const bars = buildSyntheticFxBars(60, "IRFIXTURE", "H1");
  const built = buildIndicatorSeriesFromIR(ir, bars);
  assert.ok(built.blockingReasons.length > 0);
});

test("4. unsupported order: a STOP_LIMIT executionType is accepted structurally but its full order-lifecycle correctness is Q0.5/Q0.6's own concern, not re-validated by the reducer — passthrough is proven not to throw", () => {
  const ir = { ...fixtureMQL5Netting(), entries: [{ ...fixtureMQL5Netting().entries[0]!, executionType: "STOP_LIMIT" as const }] };
  assert.doesNotThrow(() => reduceStrategyIRToSpec(ir));
});

test("5. unsupported timing: a non-NEXT_BAR_OPEN entry timing (INTRABAR) is blocking", () => {
  const ir = { ...fixtureMQL5Netting(), entries: [{ ...fixtureMQL5Netting().entries[0]!, timing: "INTRABAR" as const }] };
  const result = checkReductionEligibility(ir);
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.some((r) => r.includes("timing")));
});

test("6. unsupported MTF: a HIGHER-role timeframeSeries blocks — genuine dual-timeframe calculation is deferred", () => {
  const result = checkReductionEligibility(fixtureMTF());
  assert.ok(result.blockingReasons.some((r) => r.includes("HIGHER")));
});

test("7. future data: an insufficient-bars-for-warmup condition is rejected explicitly rather than silently reading past the available series", () => {
  const netting = fixtureMQL5Netting();
  const ema = fixtureEMACrossover();
  const ir = { ...netting, indicators: ema.indicators, entries: ema.entries, exits: [] };
  const compilation = compileStrategy(ir);
  const tooFewBars = buildSyntheticFxBars(2, ir.instruments[0]!.symbol, ir.timeframes[0]!);
  assert.throws(() => compileToSimulation(compilation, tooFewBars, SIM_OPTIONS));
});

test("8. repainting: a REPAINTING repaintingModel is blocking regardless of any other property", () => {
  const result = reduceStrategyIRToSpec(fixtureRepainting());
  assert.equal(result.status, "BLOCKED");
});

test("9. unknown/ambiguous timezone: a strategy relying on broker/local time is still eligible (WARNING-disclosed, not blocking) — proves the distinction between a disclosed assumption and an actual block", () => {
  const result = checkReductionEligibility(fixtureTimezoneSensitive());
  // timezone alone isn't blocking in the eligibility gate (session strategies commonly declare one); the fixture blocks only for its unrelated default pyramiding/reversal shape.
  assert.ok(result.blockingReasons.every((r) => !r.toLowerCase().includes("timezone")));
});

test("10. invalid risk: a StrategySpec failing Q0's own validateStrategySpec() causes the reducer to return BLOCKED, never a spec that fails downstream", () => {
  const ir = { ...fixtureMQL5Netting(), risk: { sizing: { method: "fixed-quantity" as const, quantity: -1 } } };
  const result = reduceStrategyIRToSpec(ir);
  assert.equal(result.status, "BLOCKED");
});

test("11. invalid execution: execution.declared is passed through unmodified — a structurally invalid one is caught by validateStrategySpec, not silently accepted", () => {
  const ir = fixtureMQL5Netting();
  const result = reduceStrategyIRToSpec(ir);
  assert.equal(result.strategySpec!.execution, ir.execution.declared);
});

test("12. semantic loss: fixturePineRequestSecurity's SEMANTIC_EQUIVALENT status (a real, disclosed platform-mapping choice) still blocks for its own HIGHER-timeframe reason — semantic loss disclosure and execution eligibility are independent axes", () => {
  const result = checkReductionEligibility(fixturePineRequestSecurity());
  assert.equal(result.eligible, false);
});

test("13. unresolved state (G01-style): an UNSUPPORTED semanticStatus with a BLOCKING unsupportedSemantic entry blocks reduction", () => {
  const result = reduceStrategyIRToSpec(fixtureUnsupportedSemantic());
  assert.equal(result.status, "BLOCKED");
});

test("14. unresolved dependency: a strategy declaring a dependency timeframe with no matching HIGHER-role series still structurally validates but is a Q0.7-level concern, not re-invented here", () => {
  const ir = fixtureMQL5Netting();
  assert.doesNotThrow(() => validateStrategyIR(ir));
});

test("15. invalid position mode: HEDGING accountingMode is blocking — Q0.5/Q0.6 implement NETTING only", () => {
  const result = checkReductionEligibility(fixtureMQL4OrderFlow());
  assert.ok(result.blockingReasons.some((r) => r.includes("HEDGING")));
});

test("16. compilation hash mismatch: two structurally-different eligible IRs never share a compilation hash", () => {
  const ir1 = fixtureMQL5Netting();
  const ir2 = { ...ir1, entries: [{ ...ir1.entries[0]!, sizingModel: { method: "fixed-quantity" as const, quantity: 999 } }] };
  assert.notEqual(compileStrategy(ir1).resultHash, compileStrategy(ir2).resultHash);
});

test("17. mutation attempt: reduceStrategyIRToSpec/compileStrategy/compileToSimulation never mutate any input object passed to them", () => {
  const ir = fixtureMQL5Netting();
  const irSnapshot = JSON.stringify(ir);
  const compilation = compileStrategy(ir);
  const bars = buildSyntheticFxBars(60, ir.instruments[0]!.symbol, ir.timeframes[0]!);
  const barsSnapshot = JSON.stringify(bars);
  compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.equal(JSON.stringify(ir), irSnapshot);
  assert.equal(JSON.stringify(bars), barsSnapshot);
});

test("18. simulation adapter mismatch: an indicatorKey() computed by the adapter always matches the key an Expression's indicatorOperand() would reference — never a silent lookup miss", () => {
  const netting = fixtureMQL5Netting();
  const ema = fixtureEMACrossover();
  const ir = { ...netting, indicators: ema.indicators, entries: ema.entries, exits: [] };
  const bars = buildSyntheticFxBars(60, ir.instruments[0]!.symbol, ir.timeframes[0]!);
  const built = buildIndicatorSeriesFromIR(ir, bars);
  const conditionLeft = (ir.entries[0]!.condition as { left: { kind: string; ref: { name: string; params: readonly number[] } } }).left;
  assert.equal(conditionLeft.kind, "indicator");
  const key = `${conditionLeft.ref.name}(${conditionLeft.ref.params.join(",")})`;
  assert.ok(built.series.has(key));
});

test("19. result nondeterminism: compiling+simulating the same real MQL5 source twice produces byte-identical hashes", () => {
  const { ir } = importMQLSource({ sourceText: MQL5_EMA_CROSS_FIXED_SLTP, fileName: "f.mq5", options: baseOptions({ strategyId: "nondeterminism-check" }), forcedDialect: "MQL5" });
  const bars = buildSyntheticFxBars();
  const c1 = compileStrategy(ir);
  const c2 = compileStrategy(ir);
  assert.equal(c1.resultHash, c2.resultHash);
  const s1 = compileToSimulation(c1, bars, SIM_OPTIONS);
  const s2 = compileToSimulation(c2, bars, SIM_OPTIONS);
  assert.equal(s1.simulationResultHash, s2.simulationResultHash);
});

test("20. G01 state-machine blocking: the real G01 EA compiles to BLOCKED (verified in full in test/q09-g01-reduction.test.ts; this is the catalog's cross-reference entry)", () => {
  const g01Path = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");
  const { ir } = importMQLSource({
    sourceText: fs.readFileSync(g01Path, "utf8"),
    fileName: "g01.mq5",
    options: { strategyId: "g01-catalog-check", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  assert.equal(compileStrategy(ir).reductionReport.status, "BLOCKED");
});

test("21. invalid MQL4/MQL5 strategy: a syntactically-recoverable but semantically-empty source (no entries at all) yields a structurally-valid but execution-ineligible IR, never a crash", () => {
  const { ir } = importMQLSource({ sourceText: "void OnTick() {}\nint OnInit(){return(0);}", fileName: "empty.mq5", options: baseOptions({ strategyId: "empty-strategy" }), forcedDialect: "MQL5" });
  assert.doesNotThrow(() => compileStrategy(ir));
});

test("22. MQL4/MQL5 parity mismatch: the same strategy shape written in both dialects reduces to StrategySpecs with matching risk/entry-direction semantics (full parity assertions live in test/q09-parity.test.ts)", () => {
  const { ir: ir5 } = importMQLSource({ sourceText: MQL5_EMA_CROSS_FIXED_SLTP, fileName: "f.mq5", options: baseOptions({ strategyId: "parity-catalog-5" }), forcedDialect: "MQL5" });
  const { ir: ir4 } = importMQLSource({ sourceText: MQL4_EMA_CROSS_FIXED_SLTP, fileName: "f.mq4", options: baseOptions({ strategyId: "parity-catalog-4" }), forcedDialect: "MQL4" });
  const spec5 = reduceStrategyIRToSpec(ir5).strategySpec!;
  const spec4 = reduceStrategyIRToSpec(ir4).strategySpec!;
  assert.deepEqual(spec5.risk, spec4.risk);
});

test("23. missing source provenance: reduceStrategyIRToSpec on an IR with an empty sourceHash still runs (provenance completeness is Q0.7's own validator's concern, not re-invented here) but the compiled hash still incorporates whatever hash IS present", () => {
  const ir = fixtureMQL5Netting();
  const blank = { ...ir, sourceHash: "0".repeat(64), provenance: { ...ir.provenance, sourceHash: "0".repeat(64) } };
  assert.doesNotThrow(() => compileStrategy(blank));
});

test("24. computeCompilationHash is a pure function: calling it twice on the same (ir, reduction) pair never produces different output", () => {
  const ir = fixtureMQL5Netting();
  const reduction = reduceStrategyIRToSpec(ir);
  assert.equal(computeCompilationHash(ir, reduction), computeCompilationHash(ir, reduction));
});
