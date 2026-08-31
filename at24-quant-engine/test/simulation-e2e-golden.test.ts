import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.43: the complete, fully-specified deterministic scenario —
 * Market bars -> Strategy signal -> Decision -> RiskEvaluation ->
 * RiskAction -> Order -> Fill -> Position -> Account -> Trade -> Metrics
 * -> Provenance. See test/fixtures/simulation-fixtures.ts for the exact,
 * hand-verified numbers this asserts against.
 */
test("golden fixture: no entry before the signal fires (bars 0-2)", () => {
  const result = runSimulation(GOLDEN_BARS.slice(0, 3), buildGoldenConfig(GOLDEN_BARS.slice(0, 3)));
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.finalPositions.length, 0);
});

test("golden fixture: full run produces exactly one trade, closed at the take-profit, with the exact expected numbers", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());

  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.side, "BUY");
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 111);
  assert.equal(trade.quantity, 1);
  assert.equal(trade.grossPnl, 9);
  assert.equal(trade.fees, 0);
  assert.equal(trade.netPnl, 9);
  assert.equal(trade.rMultiple, 1.5);

  assert.equal(result.finalPositions.length, 0, "the position should be fully closed by the take-profit exit");

  assert.equal(result.finalAccount.balance, 10_009);
  assert.equal(result.finalAccount.realizedPnl, 9);
  assert.equal(result.finalAccount.fees, 0);
  assert.equal(result.finalAccount.equity, 10_009);

  assert.equal(result.metrics.tradeCount, 1);
  assert.equal(result.metrics.netProfit, 9);
  assert.equal(result.metrics.winRate, 100);
  assert.equal(result.metrics.averageR, 1.5);
  assert.equal(result.metrics.totalFees, 0);
});

test("golden fixture: provenance records every required field (Q0.5.40)", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const p = result.provenance;
  assert.equal(p.datasetId, "golden-fixture");
  assert.equal(p.datasetVersion, "v1");
  assert.equal(p.dataFidelity, "D1");
  assert.equal(p.fillModel, "BarFillModel");
  assert.equal(p.spreadModel, "ZeroSpread");
  assert.equal(p.slippageModel, "ZeroSlippage");
  assert.equal(p.feeModel, "ZeroFee");
  assert.equal(p.latencyModel, "ZeroLatency");
  assert.equal(p.initialBalance, 10_000);
  assert.equal(p.positionAccountingMode, "NETTING");
  assert.equal(p.strategyVersion, "1.0.0");
  assert.ok(p.strategyHash.length > 0);
  assert.ok(p.runtimeVersion.length > 0);
});

test("golden fixture: event/execution statistics are populated and internally consistent", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  assert.equal(result.eventStatistics.totalEvents > 0, true);
  assert.equal(result.eventStatistics.eventsByType.MARKET_BAR, GOLDEN_BARS.length);
  assert.equal(result.executionStatistics.ordersCreated, 1);
  assert.equal(result.executionStatistics.ordersFilled, 1);
});

test("golden fixture: resultHash is a real, non-empty deterministic fingerprint", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  assert.equal(typeof result.resultHash, "string");
  assert.equal(result.resultHash.length, 64); // sha256 hex digest
});

test("re-entry scenario: a strategy whose entry condition remains true after an exit legitimately re-enters", () => {
  const result = runSimulation(GOLDEN_BARS_WITH_REENTRY, buildGoldenConfig(GOLDEN_BARS_WITH_REENTRY));
  assert.equal(result.executionStatistics.ordersCreated, 2);
  assert.equal(result.tradeLedger.length, 1, "the first trade closed at TP");
  assert.equal(result.finalPositions.length, 1, "the second entry remains open at the end of the window");
  assert.equal(result.finalPositions[0]!.entryPrice, 105);
});
