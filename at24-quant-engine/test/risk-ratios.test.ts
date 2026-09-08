import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRiskRatios } from "../src/domain/metrics.js";

function closeTo(actual: number, expected: number, tolerance = 1e-9): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

test("zero trades: every ratio is null, never a fabricated 0", () => {
  const r = computeRiskRatios([], [], { totalReturn: 0, maxDrawdown: 0, netProfit: 0 });
  assert.equal(r.sharpeRatio, null);
  assert.equal(r.sortinoRatio, null);
  assert.equal(r.calmarRatio, null);
  assert.equal(r.recoveryFactor, null);
  assert.equal(r.ulcerIndex, null);
});

test("a single trade: Sharpe/Sortino are null (fewer than 2 returns to estimate variance from), but a real, always-rising equity curve gives a well-defined ulcerIndex of exactly 0", () => {
  const trades = [{ pnl: 100 }];
  const equityCurve = [{ balance: 1000 }, { balance: 1100 }];
  const r = computeRiskRatios(trades, equityCurve, { totalReturn: 10, maxDrawdown: 0, netProfit: 100 });
  assert.equal(r.sharpeRatio, null);
  assert.equal(r.sortinoRatio, null);
  assert.equal(r.calmarRatio, null, "maxDrawdown is 0 here - Calmar is undefined, not 0");
  assert.equal(r.recoveryFactor, null, "the curve never draws down - Recovery Factor is undefined, not 0");
  assert.equal(r.ulcerIndex, 0, "an equity curve with zero drawdown at every point has a real, well-defined Ulcer Index of exactly 0");
});

test("two trades with IDENTICAL per-trade returns: sampleStdDev is genuinely 0, so Sharpe is null - not a divide-by-a-tiny-number artifact", () => {
  const trades = [{ pnl: 100 }, { pnl: 110 }];
  const equityCurve = [{ balance: 1000 }, { balance: 1100 }, { balance: 1210 }];
  // r0 = 100/1000 = 0.1, r1 = 110/1100 = 0.1 - identical returns, by construction.
  const r = computeRiskRatios(trades, equityCurve, { totalReturn: 21, maxDrawdown: 0, netProfit: 210 });
  assert.equal(r.sharpeRatio, null);
  assert.equal(r.sortinoRatio, null, "both returns are positive - downside deviation is genuinely 0, Sortino is undefined, not infinite");
});

test("hand-verified Sharpe/Sortino: two offsetting returns (+0.1, -0.1) produce a real, well-defined ratio of exactly 0, not null", () => {
  const trades = [{ pnl: 100 }, { pnl: -100 }];
  // Deliberately equityCurve[0] = equityCurve[1] = 1000, so both trades'
  // own "before" balance is exactly 1000 - r0 = 100/1000 = 0.1, r1 =
  // -100/1000 = -0.1. mean = 0; sampleStdDev = sqrt(((0.1)^2+(0.1)^2)/1) = sqrt(0.02).
  // sharpeRatio = 0 / sqrt(0.02) = 0 - a REAL, defined value (mean return
  // happens to be exactly 0), not the same thing as "undefined".
  const equityCurve = [{ balance: 1000 }, { balance: 1000 }, { balance: 1100 }];
  const r = computeRiskRatios(trades, equityCurve, { totalReturn: 0, maxDrawdown: 0, netProfit: 0 });
  assert.ok(r.sharpeRatio !== null && closeTo(r.sharpeRatio, 0), `expected ~0, got ${r.sharpeRatio}`);
  // downsideDeviation = sqrt((min(0.1,0)^2 + min(-0.1,0)^2)/2) = sqrt((0+0.01)/2) = sqrt(0.005)
  // sortinoRatio = 0 / sqrt(0.005) = 0
  assert.ok(r.sortinoRatio !== null && closeTo(r.sortinoRatio, 0), `expected ~0, got ${r.sortinoRatio}`);
});

test("hand-verified Calmar/Recovery Factor/Ulcer Index over a real drawdown: peak 1200, trough 900 (25% drawdown, 300 currency)", () => {
  const equityCurve = [{ balance: 1000 }, { balance: 1200 }, { balance: 900 }];
  const r = computeRiskRatios([], equityCurve, { totalReturn: 50, maxDrawdown: 25, netProfit: -300 });
  assert.equal(r.calmarRatio, 2, "totalReturn(50) / maxDrawdown(25%) = 2");
  assert.equal(r.recoveryFactor, -1, "netProfit(-300) / maxDrawdownCurrency(300) = -1");
  // drawdownPercent at each point: 0 (peak), 0 (new peak), 25 (1200->900).
  // ulcerIndex = sqrt((0^2 + 0^2 + 25^2) / 3) = sqrt(625/3) = 25/sqrt(3).
  const expectedUlcer = 25 / Math.sqrt(3);
  assert.ok(r.ulcerIndex !== null && closeTo(r.ulcerIndex, expectedUlcer, 1e-9), `expected ~${expectedUlcer}, got ${r.ulcerIndex}`);
});

test("maxDrawdown = 0 (an always-profitable run) makes Calmar undefined; a curve that never draws down makes Recovery Factor undefined - both null, independently of trade count", () => {
  const trades = [{ pnl: 50 }, { pnl: 50 }, { pnl: 50 }];
  const equityCurve = [{ balance: 1000 }, { balance: 1050 }, { balance: 1100 }, { balance: 1150 }];
  const r = computeRiskRatios(trades, equityCurve, { totalReturn: 15, maxDrawdown: 0, netProfit: 150 });
  assert.equal(r.calmarRatio, null);
  assert.equal(r.recoveryFactor, null);
  assert.equal(r.ulcerIndex, 0);
});

test("determinism: two independent calls over the same inputs produce byte-identical output (no hidden randomness/mutable state)", () => {
  const trades = [{ pnl: 120 }, { pnl: -60 }, { pnl: 80 }];
  const equityCurve = [{ balance: 5000 }, { balance: 5120 }, { balance: 5060 }, { balance: 5140 }];
  const coreMetrics = { totalReturn: 2.8, maxDrawdown: 1.171875, netProfit: 140 };
  const first = computeRiskRatios(trades, equityCurve, coreMetrics);
  const second = computeRiskRatios(trades, equityCurve, coreMetrics);
  assert.deepEqual(first, second);
});

test("computeRiskRatios never mutates its own inputs (trades/equityCurve arrays and their elements)", () => {
  const trades = [{ pnl: 100 }, { pnl: -50 }];
  const equityCurve = [{ balance: 1000 }, { balance: 1100 }, { balance: 1050 }];
  const tradesSnapshot = JSON.parse(JSON.stringify(trades));
  const curveSnapshot = JSON.parse(JSON.stringify(equityCurve));
  computeRiskRatios(trades, equityCurve, { totalReturn: 5, maxDrawdown: 4.545454545454546, netProfit: 50 });
  assert.deepEqual(trades, tradesSnapshot);
  assert.deepEqual(equityCurve, curveSnapshot);
});
