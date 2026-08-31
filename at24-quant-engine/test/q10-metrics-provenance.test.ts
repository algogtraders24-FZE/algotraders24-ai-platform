import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, buildManagementConfig } from "./fixtures/q10-position-management-fixtures.js";

// --- Q0.10.34: metrics correctly account for partial realized P&L + the final exit, with no double counting ---
test("Q0.10.34: a partial close followed by a full stop-out accounts for BOTH legs in metrics/account exactly once each, never double-counted", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 2 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, partialClose: { trigger: { mode: "absolute" as const, value: 3 }, closePercent: 50 } };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 106, 102.5, 105), bar(3, 104, 104, 90, 92)];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));

  assert.equal(result.tradeLedger.length, 2);
  const [partial, final] = result.tradeLedger;
  const expectedRealized = partial!.netPnl + final!.netPnl;
  assert.equal(expectedRealized, 3 + -6);
  assert.equal(result.finalAccount.realizedPnl, expectedRealized, "account realizedPnl must equal the SUM of both ledger entries, not one or the other");
  assert.equal(result.finalAccount.balance, 10_000 + expectedRealized, "balance must reflect both legs exactly once");
  assert.equal(result.metrics.tradeCount, 2, "tradeCount counts each ledger entry — the partial close and the final exit are two distinct realized trades, not one merged trade nor two double-counted closes");
  assert.equal(result.finalPositions.length, 0, "no quantity may remain unaccounted for after the final exit");
});

test("Q0.10.34: a full-quantity trailing-stop exit reports grossProfit/netProfit consistent with the single realized trade (no phantom partial leg)", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, trailingStop: { activation: { mode: "absolute" as const, value: 3 }, distance: { mode: "absolute" as const, value: 2 } } };
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 106, 102.5, 105), bar(3, 106, 109, 105.5, 108), bar(4, 107, 107.5, 105, 106)];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  assert.equal(result.metrics.tradeCount, 1);
  assert.equal(result.metrics.grossProfit, 4);
  assert.equal(result.metrics.netProfit, 4);
  assert.equal(result.finalAccount.realizedPnl, 4);
});

// --- Q0.10.35: result provenance — changing a management parameter must change the result's identity ---
test("Q0.10.35: changing ONLY the trailing distance changes resultHash — management parameters are part of result identity", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 106, 102.5, 105), bar(3, 106, 109, 105.5, 108), bar(4, 107, 107.5, 105, 106)];
  const riskA = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, trailingStop: { activation: { mode: "absolute" as const, value: 3 }, distance: { mode: "absolute" as const, value: 2 } } };
  const riskB = { ...riskA, trailingStop: { ...riskA.trailingStop, distance: { mode: "absolute" as const, value: 4 } } };

  const resultA = runSimulation(bars, buildManagementConfig(bars, "BUY", riskA));
  const resultB = runSimulation(bars, buildManagementConfig(bars, "BUY", riskB));
  assert.notEqual(resultA.resultHash, resultB.resultHash);
  assert.notDeepEqual(resultA.tradeLedger, resultB.tradeLedger, "a different trailing distance must produce a genuinely different trade outcome, not just a different label");
});

test("Q0.10.35: adding a breakeven rule (with everything else held constant) changes resultHash even on a run where breakeven never actually triggers", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 104, 101, 103)];
  const riskWithout = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 } };
  const riskWith = { ...riskWithout, breakeven: { trigger: { mode: "absolute" as const, value: 100 }, lockOffset: { mode: "absolute" as const, value: 0 } } }; // trigger deliberately unreachable in this short run

  const resultWithout = runSimulation(bars, buildManagementConfig(bars, "BUY", riskWithout));
  const resultWith = runSimulation(bars, buildManagementConfig(bars, "BUY", riskWith));
  assert.notEqual(resultWithout.resultHash, resultWith.resultHash, "the STRATEGY's identity (declared policy) is part of provenance even when that policy never fires during this particular run");
});
