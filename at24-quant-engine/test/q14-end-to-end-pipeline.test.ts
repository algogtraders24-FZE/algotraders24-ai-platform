import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { Q14_CORPUS } from "./fixtures/q14-mql-corpus.js";

/**
 * Q1.4.2/3/4 — traces every corpus fixture through the FULL canonical
 * pipeline: SOURCE -> PARSED -> SEMANTIC RESULT -> IR -> COMPILED SPEC ->
 * ELIGIBILITY. This is the evidence source for
 * docs/Q1.4_END_TO_END_IMPORT_MATRIX.md and docs/Q1.4_SEMANTIC_PRESERVATION.md
 * — every row in those docs traces back to one of these assertions, never
 * hand-typed without a passing test behind it.
 */

for (const fx of Q14_CORPUS) {
  test(`Q1.4 CORPUS ${fx.id}: ${fx.description}`, () => {
    // --- SOURCE -> PARSED (lexer/parser only, zero semantic meaning yet) ---
    const tokens = tokenize(fx.source);
    assert.ok(tokens.length > 0, "lexer must produce at least one token");
    const { program, diagnostics: parseDiagnostics } = parseMQL(tokens);
    assert.equal(parseDiagnostics.filter((d) => d.severity === "BLOCKING").length, 0, "every fixture must parse with zero BLOCKING parse diagnostics");
    assert.ok(program.body.length > 0);

    // --- SEMANTIC RESULT -> IR -> COMPILED SPEC -> ELIGIBILITY ---
    const { ir, report } = importMQLSource({
      sourceText: fx.source,
      fileName: `${fx.id}.mq${fx.dialect === "MQL4" ? "4" : "5"}`,
      forcedDialect: fx.dialect,
      options: { strategyId: fx.id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 },
    });
    const compilation = compileStrategy(ir);

    assert.equal(
      compilation.reductionReport.status,
      fx.expectation,
      `expected ${fx.expectation}, got ${compilation.reductionReport.status}. diagnostics: ${JSON.stringify(compilation.reductionReport.diagnostics)}`,
    );

    if (fx.expectation === "BLOCKED") {
      assert.equal(compilation.strategySpec, undefined, "a BLOCKED reduction must never hand back a partial or fabricated StrategySpec");
      assert.ok(compilation.reductionReport.diagnostics.length > 0, "a BLOCKED result must always name why");
    } else {
      assert.ok(compilation.strategySpec, "a REDUCED/REDUCED_WITH_WARNINGS result must always produce a real StrategySpec");
      assert.ok(compilation.strategySpec!.entryRules.length > 0, "every non-blocked fixture here has at least one real entry rule");
    }

    // Never silently drop diagnostics — every report's diagnostic must carry a real, non-empty reason.
    for (const d of report.diagnostics) assert.ok(d.message.length > 0);
  });
}

// --- Targeted deep assertions for the specific mechanisms this corpus exists to prove ---

test("Q1.4 CORPUS mql4-08: OrderSelect+OrderModify compiles into a real, EXACT-fidelity, executable pending-order-management rule", () => {
  const fx = Q14_CORPUS.find((f) => f.id === "mql4-08-orderselect-ordermodify")!;
  const { ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.ok(ir.pendingOrderManagement, "IR must carry a compiled pendingOrderManagement block");
  const rule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "MODIFY_STOP");
  assert.ok(rule, "a real MODIFY_STOP rule must be compiled");
  assert.equal(rule!.semanticFidelity, "EXACT");
});

test("Q1.5.2 CORPUS mql5-17: OrderGetInteger(ORDER_TYPE) is now recognized as a provable ORDER_TYPE_FILTER (previously a documented coverage gap — resolved UNKNOWN, closed this sprint)", () => {
  const fx = Q14_CORPUS.find((f) => f.id === "mql5-17-orderget-integer-ordertype")!;
  const { ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq5", forcedDialect: "MQL5", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  const deleteRule = ir.pendingOrderManagement!.rules.find((r) => r.operation.kind === "CANCEL_PENDING");
  assert.ok(deleteRule, "the CTrade.OrderDelete call is still detected and its operation still resolves to CANCEL_PENDING");
  assert.equal(deleteRule!.condition.kind, "ORDER_TYPE_FILTER", "OrderGetInteger(ORDER_TYPE) is now recognized by resolveOrderTypeFilter (Q1.5.2)");
  assert.equal((deleteRule!.condition as { orderTypeConstant?: string }).orderTypeConstant, "ORDER_TYPE_BUY_STOP");
  assert.equal(deleteRule!.semanticFidelity, "EXACT", "a provable condition against a mapped MQL5 constant now resolves to a fully executable rule");
});

test("Q1.4 CORPUS mql4-21: a dynamic (non-literal) order-type command produces the honest UNREPRESENTABLE placeholder condition, never a guessed direction", () => {
  const fx = Q14_CORPUS.find((f) => f.id === "mql4-21-dynamic-order-type")!;
  const { ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.entries[0]!.direction, "FLAT");
  assert.ok(ir.provenance.unsupportedSemantics.some((u) => u.severity === "BLOCKING" && u.feature === "entry/exit signal logic"), "the real entry sequence must be honestly reported unrepresentable, at BLOCKING severity, never silently approximated");
});

test("Q1.4 CORPUS mql4-22: an unresolved-function ticket argument on OrderModify resolves the target to UNKNOWN, but does not block the whole strategy", () => {
  const fx = Q14_CORPUS.find((f) => f.id === "mql4-22-unresolved-order-target")!;
  const { ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.equal(rule.target.provable, false);
  assert.equal(rule.semanticFidelity, "UNKNOWN");
});

test("Q1.4 CORPUS mql4-24: a bare Bid/Ask pending-order price is BLOCKED at eligibility, never approximated with an OHLC proxy", () => {
  const fx = Q14_CORPUS.find((f) => f.id === "mql4-24-bidask-dependency")!;
  const { ir } = importMQLSource({ sourceText: fx.source, fileName: "x.mq4", forcedDialect: "MQL4", options: { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.entries[0]!.stopPrice?.kind, "UNSUPPORTED");
  assert.equal(ir.entries[0]!.stopPrice?.reason, "ASK");
});
