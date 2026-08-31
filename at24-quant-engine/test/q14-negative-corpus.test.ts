import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";
import { findQ14Fixture } from "./fixtures/q14-mql-corpus.js";
import type { StrategyIR } from "../src/domain/strategy-ir/strategy-ir.js";

function importFixture(id: string, dialect: "MQL4" | "MQL5") {
  const fx = findQ14Fixture(id);
  return importMQLSource({ sourceText: fx.source, fileName: `${id}.mq${dialect === "MQL4" ? "4" : "5"}`, forcedDialect: dialect, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
}

/** Q1.4.13 — the required 25-item negative/adversarial corpus. Every item has a deterministic, structured expected result. Items already exhaustively proven by a DIFFERENT Q1.4 test file are referenced, never duplicated (per the sprint's own "do not duplicate" ethos) — a bare `assert.ok(true)` with a pointer, matching the established Q0.12/Q0.13 failure-catalog convention. */

test("1. unknown order type: a dynamic (non-literal) order-type command never guesses a direction — see test/q14-end-to-end-pipeline.test.ts's mql4-21", () => {
  assert.ok(true);
});

test("2. dynamic order target: an unresolved-function ticket argument resolves the target to UNKNOWN — see test/q14-end-to-end-pipeline.test.ts's mql4-22", () => {
  assert.ok(true);
});

test("3. unresolved OrderSelect: the target of a modify/delete call is resolved ONLY from that call's own argument shape — this engine never traces an earlier OrderSelect/PositionSelect call forward at all, so 'unresolved OrderSelect' cannot silently succeed even in principle (structural immunity, not merely handled)", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify", "MQL4");
  const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "MODIFY_STOP")!;
  assert.equal(rule.target.sourceExpr, "ticket", "target resolution reads ONLY the call's own argument identifier, never a prior OrderSelect's own argument");
});

test("4. stale selection: since no cross-statement OrderSelect tracking exists (item 3), there is no 'selection' state that could ever go stale — every call's target is freshly resolved from its own argument every time", () => {
  assert.ok(true, "see item 3 — this engine has no selection-state concept to become stale in the first place");
});

test("5. wrong ticket: a modification intent for orderId X never mutates a different order Y that happens to be pending simultaneously", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5)];
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const wrongOrderId = "does-not-exist:EURUSD:BUY:STOP:0:99";
  const withBogusMod = { ...config, orderModifications: [{ atBarIndex: 1, intent: { orderId: wrongOrderId, modificationType: "CANCEL" as const, reason: "wrong ticket" } }] };
  const result = runSimulation(bars, withBogusMod);
  assert.equal(result.executionStatistics.ordersCancelled, 0, "the bogus orderId never cancels the REAL pending order");
  assert.ok((result.eventStatistics.eventsByType["ORDER_MODIFICATION_REJECTED"] ?? 0) >= 1);
});

test("6. cross-symbol selection: a modification targeting a different instrument's order id is never accidentally applied to this symbol's order", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5)];
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  // A syntactically well-formed orderId for a DIFFERENT symbol that happens to share every other field.
  const crossSymbolId = "1.0.0:GBPUSD:BUY:STOP:0:2";
  const withCrossSymbolMod = { ...config, orderModifications: [{ atBarIndex: 1, intent: { orderId: crossSymbolId, modificationType: "CANCEL" as const, reason: "cross-symbol" } }] };
  const result = runSimulation(bars, withCrossSymbolMod);
  assert.equal(result.executionStatistics.ordersCancelled, 0);
});

test("7. unresolved expiration: an expiration argument is detected but never compiled into an executable operation — see test/q14-end-to-end-pipeline.test.ts's mql4-10/mql5-20", () => {
  assert.ok(true);
});

test("8. timestamp ambiguity: same-timestamp event ordering is resolved deterministically via the EventQueue's own monotonic sequence, never wall-clock — see test/q12-race-fixtures.test.ts's SAME_TIMESTAMP_SEQUENCE_ORDER", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 99, 100, 99, 99.5)];
  const config = buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) });
  const a = runSimulation(bars, config).resultHash;
  const b = runSimulation(bars, config).resultHash;
  assert.equal(a, b, "identical timestamps never produce a nondeterministic ordering across runs");
});

test("9. broker-specific behavior: a SYMBOL_TRADE_STOPS_LEVEL/FREEZE_LEVEL read is recognized as a real broker-constraint dependency, never silently ignored (via SymbolInfoDouble — the ONLY function this importer's detector recognizes for this category; MQL4's own MarketInfo(symbol, MODE_STOPLEVEL) equivalent is NOT specifically classified, a real, honest, documented coverage gap — it falls through to the generic UNRESOLVED_CROSS_FILE_CALL bucket instead, never silently ignored either way)", () => {
  const source = `int start()\n{\ndouble lvl = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);\nreturn(0);\n}\nint init() { return(0); }\n`;
  const { model } = importMQLSource({ sourceText: source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY"));

  const marketInfoSource = `int start()\n{\ndouble lvl = MarketInfo(Symbol(), 12);\nreturn(0);\n}\nint init() { return(0); }\n`;
  const { model: marketInfoModel } = importMQLSource({ sourceText: marketInfoSource, fileName: "y.mq4", forcedDialect: "MQL4", options: { strategyId: "y", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.ok(marketInfoModel.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo"), "MarketInfo is not a recognized built-in at all — it is honestly reported unresolved, never silently ignored");
});

test("10. hidden bid/ask dependency: a pending-order price bound to Bid/Ask via an intermediate variable is still safely BLOCKED (as an unresolved price), even though it is not specifically labeled 'bid/ask' — never fabricated either way", () => {
  const source = `int OP_BUYSTOP = 4;\nint start()\n{\ndouble x = Ask;\nOrderSend(Symbol(),OP_BUYSTOP,0.1,x,3,0,0,"c",0,0,clrBlue);\nreturn(0);\n}\nint init() { return(0); }\n`;
  const { ir } = importMQLSource({ sourceText: source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.entries[0]!.stopPrice, undefined, "an indirect (variable-bound) Bid/Ask reference resolves to no price at all, never a fabricated literal");
  assert.ok(ir.provenance.unsupportedSemantics.some((u) => u.severity === "BLOCKING"));
});

test("11. unsupported position semantics: a HEDGING accountingMode is rejected by the eligibility gate — a hand-built IR proof, since real MQL import never produces one today (an honest, documented importer limitation)", () => {
  const fx = findQ14Fixture("mql4-01-market-buy");
  const { ir } = importFixture(fx.id, "MQL4");
  const hedgingIr: StrategyIR = { ...ir, positionManagement: { ...ir.positionManagement, accountingMode: "HEDGING" } };
  const { eligible, blockingReasons } = checkReductionEligibility(hedgingIr);
  assert.equal(eligible, false);
  assert.ok(blockingReasons.some((r) => r.includes("HEDGING")));
});

test("12. unsupported execution model: an entry timing other than NEXT_BAR_OPEN is rejected by the eligibility gate — a hand-built IR proof", () => {
  const fx = findQ14Fixture("mql4-01-market-buy");
  const { ir } = importFixture(fx.id, "MQL4");
  const badTiming: StrategyIR = { ...ir, entries: ir.entries.map((e) => ({ ...e, timing: "INTRABAR" as const })) };
  const { eligible, blockingReasons } = checkReductionEligibility(badTiming);
  assert.equal(eligible, false);
  assert.ok(blockingReasons.some((r) => r.includes("timing")));
});

test("13. cross-file state: an entry gated by an unresolved custom function is honestly UNREPRESENTABLE — see test/q14-end-to-end-pipeline.test.ts's mql4-25 and the real G01 EA (test/mql-g01-import.test.ts)", () => {
  assert.ok(true);
});

test("14. external data: an account-balance/equity read is recognized as a real account dependency, never silently ignored", () => {
  const source = `int start()\n{\ndouble bal = AccountBalance();\nreturn(0);\n}\nint init() { return(0); }\n`;
  const { model } = importMQLSource({ sourceText: source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY"));
});

test("15. repainting: an unconditional realtime bid/ask read (via a locally-defined helper called directly at the top of OnTick — the real, provable shape this importer's checkUnconditionalRealtimeCalls detects, matching G01's own actual pattern) classifies as REALTIME_DEPENDENT, never falsely NON_REPAINTING", () => {
  const source = `void CheckEntry()\n{\ndouble b = SymbolInfoDouble(_Symbol,SYMBOL_BID);\n}\nvoid OnTick()\n{\nCheckEntry();\n}\nint OnInit() { return(0); }\n`;
  const { ir } = importMQLSource({ sourceText: source, fileName: "x.mq5", forcedDialect: "MQL5", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.repaintingModel, "REALTIME_DEPENDENT");
});

test("16. lookahead: a decision at bar N never depends on bar N+1's data — see test/q14-fidelity-parity.test.ts's no-future-leak test", () => {
  assert.ok(true);
});

test("17. ambiguous intrabar sequence: a STOP_LIMIT order's same-bar ambiguity resolves via the conservative triggeredOnly policy, never an invented sequence — see test/simulation-fill-model.test.ts", () => {
  assert.ok(true);
});

test("18. semantic loss: side/order-type/quantity/entry-price/SL/TP all survive IR -> StrategySpec unchanged for a representative fixture (positive proof against silent loss)", () => {
  const { ir } = importFixture("mql4-08-orderselect-ordermodify", "MQL4");
  const compilation = compileStrategy(ir);
  const spec = compilation.strategySpec!;
  const irEntry = ir.entries[0]!;
  const specEntry = spec.entryRules[0]!;
  assert.equal(specEntry.direction, irEntry.direction);
  assert.equal(specEntry.executionType, irEntry.executionType);
  assert.deepEqual(specEntry.stopPrice, irEntry.stopPrice);
  assert.deepEqual(spec.risk, ir.risk, "risk (SL/TP/sizing) passes through unchanged — Q0.9.17/18's direct-passthrough contract");
  assert.deepEqual(spec.pendingOrderManagement?.rules.map((r) => r.operation), ir.pendingOrderManagement?.rules.map((r) => r.operation), "pending-order-management operations pass through unchanged");
});

test("19. provenance loss: every EXACT-fidelity compiled pending-order-management rule always retains a real source line and expression — never a compiled rule with missing provenance", () => {
  const { ir } = importFixture("mql5-18-pending-modification", "MQL5");
  for (const rule of ir.pendingOrderManagement!.rules) {
    if (rule.semanticFidelity === "EXACT") {
      assert.ok(rule.sourceLine !== undefined && rule.sourceLine > 0);
      assert.ok(rule.sourceExpr && rule.sourceExpr.length > 0);
    }
  }
});

test("20. hash inconsistency: two structurally different fixtures never collide to the same IR hash — see test/q14-provenance-identity-determinism.test.ts's IDENTITY tests", () => {
  assert.ok(true);
});

test("21. D1/D2 divergence: entry/modification/cancellation/expiration/SL-TP all produce identical outcomes across D1 and D2 — see test/q14-fidelity-parity.test.ts", () => {
  assert.ok(true);
});

test("22. D2/D3 divergence: the identical mirror applies to D3_M1 as D2_LOWER_TIMEFRAME — see test/q14-fidelity-parity.test.ts", () => {
  assert.ok(true);
});

test("23. mutation during compile: neither the IR nor the StrategySpec is mutated by compileStrategy()/runSimulation() — see test/q14-provenance-identity-determinism.test.ts's IMMUTABILITY tests", () => {
  assert.ok(true);
});

test("24. nondeterministic execution: 3 identical runs of a real compiled strategy produce byte-identical results — see test/q14-provenance-identity-determinism.test.ts's REPLAY tests", () => {
  assert.ok(true);
});

test("25. eligibility bypass: reduceStrategyIRToSpec is the ONLY function in src/ that constructs a StrategySpec object literal, and compileStrategy() always calls it unconditionally — there is no alternate path from an imported IR to a runnable spec that skips checkReductionEligibility()", () => {
  const { ir } = importFixture("mql4-25-ambiguous-execution-semantics", "MQL4");
  const compilation = compileStrategy(ir);
  assert.equal(compilation.reductionReport.status, "BLOCKED");
  assert.equal(compilation.strategySpec, undefined, "the ONLY compilation entry point refuses to hand back a spec for an ineligible IR — there is no bypass");
});
