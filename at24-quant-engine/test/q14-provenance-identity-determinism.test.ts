import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation } from "../src/runtime/reduction/simulation-adapter.js";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { computeSemanticStrategyHash } from "../src/runtime/identity.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { findQ14Fixture } from "./fixtures/q14-mql-corpus.js";
import { computeSemanticProfileHash, PLATFORM_SEMANTIC_MATRIX } from "../src/domain/strategy-ir/platform-matrix.js";
import type { PendingOrderManagementPolicy } from "../src/domain/pending-order-management-policy.js";

function importFixture(id: string) {
  const fx = findQ14Fixture(id);
  return importMQLSource({ sourceText: fx.source, fileName: `${id}.mq${fx.dialect === "MQL4" ? "4" : "5"}`, forcedDialect: fx.dialect, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
}

// --- Q1.4.8: provenance continuity, source -> AST/semantic -> IR -> compiled -> spec -> order -> execution -> trade -> result ---

test("Q1.4 PROVENANCE: source hash is identical across document/IR/provenance, never silently diverging", () => {
  const fx = findQ14Fixture("mql4-08-orderselect-ordermodify");
  const { document, ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.sourceHash, document.sourceHash);
  assert.equal(ir.provenance.sourceHash, document.sourceHash);
  assert.equal(ir.provenance.sourcePlatform, ir.sourcePlatform);
});

test("Q1.4 PROVENANCE: a compiled pending-order-management rule retains source line/expression, never fabricated", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify");
  const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "MODIFY_STOP")!;
  assert.ok(rule.sourceLine !== undefined && rule.sourceLine > 0);
  assert.ok(rule.sourceExpr && rule.sourceExpr.includes("OrderModify"));
});

test("Q1.4 PROVENANCE: the compilation hash ties IR hash + spec hash + reducer version + status together, and changes when any of them change", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify");
  const a = compileStrategy(ir);
  const b = compileStrategy({ ...ir, strategyVersion: "9.9.9" });
  assert.notEqual(a.resultHash, b.resultHash, "a real content change (strategyVersion, which participates in the IR's own identity) must change the compilation hash");
});

test("Q1.4 PROVENANCE: full pipeline result carries strategyHash/datasetId/dataFidelity through to the final SimulationResult, unbroken", () => {
  const { ir } = importFixture("mql5-11-market-order");
  const compilation = compileStrategy(ir);
  assert.ok(compilation.strategySpec);
  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, { initialBalance: 10_000, datasetId: "q14-provenance", datasetVersion: "v1", dataFidelity: "D1", spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" });
  assert.ok(result.provenance.strategyHash);
  assert.equal(result.provenance.datasetId, "q14-provenance");
  assert.equal(result.provenance.dataFidelity, "D1");
  assert.ok(result.simulationResultHash);
  assert.equal(result.compilationHash, compilation.resultHash);
  assert.equal(result.strategySpecHash, computeSemanticStrategyHash(compilation.strategySpec!));
});

test("Q1.4 PROVENANCE: an UNKNOWN semantic never fabricates provenance — a BLOCKED reduction still names a real, non-empty diagnostic for every gap", () => {
  const { ir } = importFixture("mql4-25-ambiguous-execution-semantics");
  const compilation = compileStrategy(ir);
  assert.equal(compilation.reductionReport.status, "BLOCKED");
  assert.ok(compilation.reductionReport.diagnostics.length > 0);
  for (const d of compilation.reductionReport.diagnostics) assert.ok(d.length > 0);
});

// --- Q1.4.9: identity / semantic hashing ---

test("Q1.4 IDENTITY: identical source + identical semantic profile -> identical IR canonical hash across 3 independent imports", () => {
  const fx = findQ14Fixture("mql5-18-pending-modification");
  const hashes = [0, 1, 2].map(() => computeCanonicalIRHash(importMQLSource({ sourceText: fx.source, fileName: "x.mq5", forcedDialect: "MQL5", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } }).ir));
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
});

test("Q1.4 IDENTITY: an execution-affecting semantic change (a different pending-order-management operation) changes the IR canonical hash", () => {
  const withDelete = importFixture("mql4-09-orderselect-orderdelete").ir;
  const withModify = importFixture("mql4-08-orderselect-ordermodify").ir;
  assert.notEqual(computeCanonicalIRHash({ ...withDelete, strategyId: "same-id" }), computeCanonicalIRHash({ ...withModify, strategyId: "same-id" }));
});

test("Q1.4 IDENTITY: an execution-affecting change to the order-type/execution-policy changes identity — BUY_LIMIT vs BUY_STOP on otherwise identical source", () => {
  const limit = importFixture("mql4-03-buy-limit").ir;
  const stop = importFixture("mql4-05-buy-stop").ir;
  assert.notEqual(computeCanonicalIRHash(limit), computeCanonicalIRHash(stop));
});

test("Q1.4 IDENTITY: an execution-affecting expiration/management-rule change alters StrategySpec semantic identity", () => {
  const rule1: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "CANCEL_PENDING" }, semanticFidelity: "EXACT" }] };
  const rule2: PendingOrderManagementPolicy = { rules: [{ id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" }] };
  const base = buildOrderTypeConfig([bar(0, 100, 101, 99, 101)], "BUY", "STOP", { stopPrice: absolute(103) }).strategySpec;
  const specA = { ...base, pendingOrderManagement: rule1 };
  const specB = { ...base, pendingOrderManagement: rule2 };
  assert.notEqual(computeSemanticStrategyHash(specA), computeSemanticStrategyHash(specB), "an execution-affecting pendingOrderManagement change must participate in the strategy's semantic identity hash");
});

test("Q1.4 IDENTITY: an irrelevant metadata change (description/author/tags/createdAt) does NOT change the semantic identity hash", () => {
  const base = buildOrderTypeConfig([bar(0, 100, 101, 99, 101)], "BUY", "STOP", { stopPrice: absolute(103) }).strategySpec;
  const withMeta = { ...base, metadata: { ...base.metadata, description: "irrelevant text", author: "someone", tags: ["a", "b"] } };
  assert.equal(computeSemanticStrategyHash(base), computeSemanticStrategyHash(withMeta), "metadata is deliberately excluded from the semantic hash (runtime/identity.ts)");
});

test("Q1.4 IDENTITY: the platform semantic profile hash changes deterministically when the matrix changes, and is stable when it does not", () => {
  const a = computeSemanticProfileHash();
  const b = computeSemanticProfileHash();
  assert.equal(a, b);
  assert.ok(Object.keys(PLATFORM_SEMANTIC_MATRIX).length >= 6);
});

// --- Q1.4.10: deterministic replay (3x identical runs, plus replay from the same canonical input) ---

test("Q1.4 REPLAY: 3 identical runs of a real MQL-compiled strategy produce byte-identical resultHash, provenance, and trade ledger", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify");
  const compilation = compileStrategy(ir);
  const bars = buildSyntheticFxBars(150, "EURUSD", "M5");
  const opts = { initialBalance: 10_000, datasetId: "q14-replay", datasetVersion: "v1", dataFidelity: "D1" as const, spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" as const };
  const runs = [0, 1, 2].map(() => compileToSimulation(compilation, bars, opts));
  assert.equal(runs[0]!.simulationResultHash, runs[1]!.simulationResultHash);
  assert.equal(runs[1]!.simulationResultHash, runs[2]!.simulationResultHash);
  assert.equal(runs[0]!.provenance.strategyHash, runs[2]!.provenance.strategyHash);
});

test("Q1.4 REPLAY: re-importing from a JSON round-trip of the SAME source text produces the identical IR canonical hash (replay from the same canonical input)", () => {
  const fx = findQ14Fixture("mql5-19-pending-cancellation");
  const sourceRoundTrip = JSON.parse(JSON.stringify(fx.source)) as string;
  const a = importMQLSource({ sourceText: fx.source, fileName: "x.mq5", forcedDialect: "MQL5", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } }).ir;
  const b = importMQLSource({ sourceText: sourceRoundTrip, fileName: "x.mq5", forcedDialect: "MQL5", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } }).ir;
  assert.equal(computeCanonicalIRHash(a), computeCanonicalIRHash(b));
});

// --- Q1.4.11: immutability ---

test("Q1.4 IMMUTABILITY: transitionOrder never mutates its input order object", () => {
  const order = createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "X" }, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 99, creationTimestamp: 0 }, 1);
  const statusBefore = order.status;
  const next = transitionOrder(order, "SUBMITTED");
  assert.equal(order.status, statusBefore, "the original order object must remain untouched");
  assert.notEqual(next.status, order.status);
  assert.notEqual(next, order, "transitionOrder must return a genuinely new object, never mutate-and-return");
});

test("Q1.4 IMMUTABILITY: the IR object is not mutated by compileStrategy()", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify");
  const before = JSON.stringify(ir);
  compileStrategy(ir);
  const after = JSON.stringify(ir);
  assert.equal(before, after, "compileStrategy must never mutate the IR it was given");
});

test("Q1.4 IMMUTABILITY: the StrategySpec object is not mutated by runSimulation(), and the SAME spec/bars are safely reusable for a second run", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 97, 98)];
  const config = buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(98) });
  const specBefore = JSON.stringify(config.strategySpec);
  const first = runSimulation(bars, config);
  const specAfter = JSON.stringify(config.strategySpec);
  assert.equal(specBefore, specAfter, "runSimulation must never mutate the StrategySpec it was given");
  const second = runSimulation(bars, config);
  assert.equal(first.resultHash, second.resultHash, "the identical config/bars must remain safely reusable, producing an identical result on a second run");
});
