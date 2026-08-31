import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reducePosition, openPosition } from "../src/runtime/simulation/position-engine.js";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, buildManagementConfig } from "./fixtures/q10-position-management-fixtures.js";
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import { evaluateBreakeven } from "../src/runtime/risk/breakeven.js";
import { evaluatePartialClose } from "../src/runtime/risk/partial-close.js";
import { evaluateMaxHoldingPeriod } from "../src/runtime/risk/holding-period.js";
import { resolveDistanceSpec } from "../src/runtime/risk/distance-spec.js";
import { computeRMultiple } from "../src/runtime/risk/r-multiple.js";
import { validateRiskSpecification } from "../src/domain/risk-specification.js";
import { resolveProtectiveExit } from "../src/runtime/simulation/bar-fill-model.js";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";
import { fixtureMQL5Netting, fixtureEMACrossover } from "./fixtures/strategy-ir-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Q0.10.25 — the minimum 15-item failure catalog, each proven against the REAL function that must reject it, never a description of intended behavior. */

test("1. negative close quantity: reducePosition throws rather than accepting a nonsensical close", () => {
  const pos = openPosition({ id: "p1", originatingOrderIntentId: "o1", instrument: { symbol: "X" }, side: "BUY", quantity: 2, entryPrice: 100, entryTimestamp: 0, fee: 0 });
  assert.throws(() => reducePosition(pos, -1, 105, 1, 0));
  assert.throws(() => reducePosition(pos, 0, 105, 1, 0));
});

test("2. close > position: reducePosition throws rather than closing more than the position holds", () => {
  const pos = openPosition({ id: "p1", originatingOrderIntentId: "o1", instrument: { symbol: "X" }, side: "BUY", quantity: 2, entryPrice: 100, entryTimestamp: 0, fee: 0 });
  assert.throws(() => reducePosition(pos, 3, 105, 1, 0));
});

test("3. invalid trailing distance: a zero or negative distance/activation is rejected by RiskSpecification validation, never silently accepted", () => {
  const result = validateRiskSpecification({
    sizing: { method: "fixed-quantity", quantity: 1 },
    trailingStop: { activation: { mode: "absolute", value: 3 }, distance: { mode: "absolute", value: 0 } },
  });
  assert.equal(result.valid, false);
});

test("4. invalid breakeven trigger: a zero trigger is rejected (trigger=0 means 'act immediately', a degenerate, disallowed configuration)", () => {
  const result = validateRiskSpecification({
    sizing: { method: "fixed-quantity", quantity: 1 },
    breakeven: { trigger: { mode: "absolute", value: 0 }, lockOffset: { mode: "absolute", value: 1 } },
  });
  assert.equal(result.valid, false);
});

test("5. SL moving against risk: both breakeven and trailing refuse to move the stop unless the proposal is strictly risk-reducing", () => {
  const trailing = evaluateTrailingStop({ activation: { mode: "absolute", value: 1 }, distance: { mode: "absolute", value: 10 } }, "BUY", 100, 105, /* currentStopLoss */ 98, undefined);
  assert.equal(trailing.triggered, false, "a proposed stop (105-10=95) worse than the current stop (98) must never be applied");

  const breakeven = evaluateBreakeven({ trigger: { mode: "absolute", value: 1 }, lockOffset: { mode: "absolute", value: 0 } }, "BUY", 100, 105, undefined, 101);
  assert.equal(breakeven.triggered, false, "a proposed breakeven stop (100) worse than the current stop (101) must never be applied");
});

test("6. duplicate partial close: a position already flagged partialCloseAlreadyTriggered never re-triggers, even if the price condition is still met", () => {
  const result = evaluatePartialClose({ trigger: { mode: "absolute", value: 1 }, closePercent: 50 }, "BUY", 100, 110, undefined, /* alreadyTriggered */ true);
  assert.equal(result.triggered, false);
});

test("7. holding expiry ambiguity: non-finite timestamps produce an explicit BLOCKING violation, never a silently-wrong duration", () => {
  const result = evaluateMaxHoldingPeriod({ sizing: { method: "fixed-quantity", quantity: 1 }, maxHoldingPeriod: { maxBars: 5 } }, { entryTimestamp: NaN, barsHeld: 3 }, 1000);
  assert.equal(result.passed, false);
  assert.equal(result.violation!.severity, "BLOCKING");
});

test("8. future timestamp: an evaluation clock earlier than the position's own entry never falsely reports an exceeded holding duration", () => {
  const result = evaluateMaxHoldingPeriod({ sizing: { method: "fixed-quantity", quantity: 1 }, maxHoldingPeriod: { maxDurationMs: 1000 } }, { entryTimestamp: 5000, barsHeld: 0 }, /* asOf earlier than entry */ 1000);
  assert.equal(result.passed, true, "a negative duration must never be misread as 'exceeded'");
});

test("9. missing position: evaluateRisk() with neither proposedEntry nor existingPosition set returns a safe NO_ACTION, never throws or guesses", () => {
  const result = evaluateRisk({ asOf: 0, riskSpecification: { sizing: { method: "fixed-quantity", quantity: 1 } }, instrument: { symbol: "X" }, direction: "BUY", portfolio: { openPositionCount: 0 }, dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 0 } });
  assert.equal(result.outcome, "ALLOWED");
  assert.equal(result.action.type, "NO_ACTION");
});

test("10. invalid ATR: an atr-multiple DistanceSpec with no supplied ATR value throws explicitly, and a strategy referencing an undeclared ATR period is BLOCKED at the eligibility gate", () => {
  assert.throws(() => resolveDistanceSpec({ mode: "atr-multiple", atrMultiple: 1, atrPeriod: 14 }, 100, undefined));

  const netting = fixtureMQL5Netting();
  const ema = fixtureEMACrossover();
  const ir = { ...netting, indicators: ema.indicators, entries: ema.entries, exits: [], risk: { sizing: { method: "fixed-quantity" as const, quantity: 1 }, trailingStop: { activation: { mode: "atr-multiple" as const, atrMultiple: 1, atrPeriod: 14 }, distance: { mode: "atr-multiple" as const, atrMultiple: 1, atrPeriod: 14 } } } };
  const eligibility = checkReductionEligibility(ir);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.blockingReasons.some((r) => r.includes("no matching ATR indicator")));
});

test("11. zero risk distance: computeRMultiple refuses a non-positive risk distance rather than dividing by zero or a negative number", () => {
  assert.throws(() => computeRMultiple(0, 5));
  assert.throws(() => computeRMultiple(-1, 5));
});

test("12. same-bar conflict: both stop-loss and take-profit reachable within one bar resolves conservatively (stop-loss), flagged ambiguous", () => {
  const outcome = resolveProtectiveExit("BUY", 96, 111, { timestamp: 0, instrument: { symbol: "X" }, timeframe: "H1", open: 103, high: 115, low: 90, close: 105, volume: 1 });
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 96);
  assert.equal(outcome.ambiguous, true);
});

test("13. unsupported management pattern: a dynamic (non-literal) new-SL expression in OrderModify is never fabricated into a management rule", () => {
  const source = `
    void OnTick() {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if (bid - OrderOpenPrice() >= 0.0030) {
        OrderModify(0, 0.0, G01_CalculateDynamicStop(), 0.0, 0, clrBlue);
      }
    }
    int OnInit() { return(0); }
  `;
  const { ir } = importMQLSource({ sourceText: source, fileName: "f.mq5", options: { strategyId: "s", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.risk.breakeven, undefined, "an unresolvable (cross-file) new-SL expression must never be reduced into a fabricated breakeven rule");
  assert.equal(ir.risk.trailingStop, undefined);
});

test("14. cross-file unresolved state: G01's real 17 position-management calls keep pyramiding/reversal conservative (PLATFORM_DEFINED), never falsely assumed safe", () => {
  const g01Path = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");
  const sourceText = fs.readFileSync(g01Path, "utf8");
  const { ir } = importMQLSource({ sourceText, fileName: "AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5", options: { strategyId: "g01", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  assert.equal(ir.positionManagement.reversal.buyToSell, "PLATFORM_DEFINED");
  assert.equal(ir.positionManagement.pyramiding.sameDirectionBehavior, "REJECT");
});

test("15. non-deterministic timestamp: identical management-bearing simulations produce byte-identical result hashes — no Date.now()/wall-clock leakage", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, trailingStop: { activation: { mode: "absolute" as const, value: 3 }, distance: { mode: "absolute" as const, value: 2 } } };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 106, 102.5, 105), bar(3, 106, 109, 105.5, 108), bar(4, 107, 107.5, 105, 106)];
  const r1 = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  const r2 = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(r1.resultHash, r2.resultHash);
});
