import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCoreMetrics } from "../src/domain/metrics.js";

test("no trades: all metrics are well-defined zero, not NaN/undefined", () => {
  const m = computeCoreMetrics([], 10_000);
  assert.equal(m.tradeCount, 0);
  assert.equal(m.netProfit, 0);
  assert.equal(m.winRate, 0);
  assert.equal(m.profitFactor, 0);
  assert.equal(m.averageTrade, 0);
  assert.equal(m.totalReturn, 0);
  assert.equal(m.maxDrawdown, 0);
});

test("all-winning trades: profitFactor is Infinity (no losses to divide by), well-defined not NaN", () => {
  const m = computeCoreMetrics([{ pnl: 100 }, { pnl: 50 }], 10_000);
  assert.equal(m.grossLoss, 0);
  assert.equal(m.profitFactor, Number.POSITIVE_INFINITY);
  assert.equal(m.winRate, 100);
});

test("known hand-computed trade sequence", () => {
  // trades: +100, -40, +60, -20  => net = 100
  const trades = [{ pnl: 100 }, { pnl: -40 }, { pnl: 60 }, { pnl: -20 }];
  const m = computeCoreMetrics(trades, 1000);
  assert.equal(m.tradeCount, 4);
  assert.equal(m.netProfit, 100);
  assert.equal(m.grossProfit, 160);
  assert.equal(m.grossLoss, -60);
  assert.equal(m.winRate, 50);
  assert.equal(m.profitFactor, 160 / 60);
  assert.equal(m.averageTrade, 25);
  assert.equal(m.expectancy, m.averageTrade);
  assert.equal(m.totalReturn, 10);
});

test("maxDrawdown is computed from the running equity curve peak, hand-verified", () => {
  // equity: 1000 -> 1200 (peak) -> 900 (dd = 300/1200=25%) -> 1000 -> 700 (dd = 500/1200=41.667%, new max)
  const trades = [{ pnl: 200 }, { pnl: -300 }, { pnl: 100 }, { pnl: -300 }];
  const m = computeCoreMetrics(trades, 1000);
  assert.ok(Math.abs(m.maxDrawdown - (500 / 1200) * 100) < 1e-9);
});

test("expectancy is always mathematically identical to averageTrade for this trade model", () => {
  const trades = [{ pnl: 30 }, { pnl: -10 }, { pnl: 5 }, { pnl: -2 }, { pnl: 17 }];
  const m = computeCoreMetrics(trades, 5000);
  assert.equal(m.expectancy, m.averageTrade);
});

test("repeated computation on identical input is deterministic", () => {
  const trades = [{ pnl: 30 }, { pnl: -10 }, { pnl: 5 }];
  assert.deepEqual(computeCoreMetrics(trades, 1000), computeCoreMetrics(trades, 1000));
});

test("totalReturn is 0 (not NaN/Infinity) when initialEquity is 0", () => {
  const m = computeCoreMetrics([{ pnl: 100 }], 0);
  assert.equal(m.totalReturn, 0);
});
