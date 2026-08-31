import { test } from "node:test";
import assert from "node:assert/strict";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { reconstructIntrabarSequence } from "../src/runtime/fidelity/bar-magnifier.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import { timeframeDurationMs, expectedChildCount } from "../src/runtime/fidelity/timeframe-duration.js";
import { resolveIntrabarOrderFill, resolveIntrabarProtectiveExit } from "../src/runtime/fidelity/intrabar-fill.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { compareFidelities } from "../src/runtime/fidelity/fidelity-comparison-engine.js";
import { createOrder } from "../src/runtime/simulation/order-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { SIM_INSTRUMENT } from "./fixtures/simulation-fixtures.js";
import {
  CHILD_TIMEFRAME,
  FIXTURE_A_PARENT_BARS,
  FIXTURE_A_CHILD_BARS,
  FIXTURE_C_PARENT_BAR,
  FIXTURE_C_CHILD_BARS,
  FIXTURE_D_PARENT_BAR,
  FIXTURE_D_CHILD_BARS,
  buildFixtureAD1Config,
  buildFixtureAD2Config,
} from "./fixtures/fidelity-fixtures.js";

/** Q0.6.47: the 18 required failure modes, each proven with a concrete test. */

test("1. MISSING detail data with the default FAIL policy throws INSUFFICIENT_DETAIL_DATA rather than silently degrading", () => {
  const config = { ...buildFixtureAD2Config(), missingDetailPolicy: "FAIL" as const };
  assert.throws(() => runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config), /INSUFFICIENT_DETAIL_DATA/);
});

test("2. MISSING detail data with FALLBACK_TO_D1 degrades gracefully and is tracked, never silent", () => {
  const result = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  assert.ok(result.provenance.fidelityQuality.parentsResolvedAtParentGranularity > 0);
});

test("3. PARTIAL coverage (fewer than the expected child count) is reported PARTIAL, never silently upgraded to COMPLETE", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_C_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_C_PARENT_BAR);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(detail.status, "PARTIAL");
  assert.equal(FIXTURE_C_CHILD_BARS.length, 3);
  assert.equal(expectedChildCount("H1", CHILD_TIMEFRAME), 4);
});

test("4. an invalid child bar (high < low) throws at reconstruction time rather than being silently accepted", () => {
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const badDetail = { status: "COMPLETE" as const, bars: [{ timestamp: parent.closeTimestamp, instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, open: 100, high: 90, low: 95, close: 92, volume: 1 }] };
  assert.throws(() => reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, badDetail));
});

test("5. a mismatched requested childTimeframe returns MISSING, never a silent substitution of whatever the provider actually holds", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const result = provider.getDetail({ parent, childTimeframe: "M5" });
  assert.equal(result.status, "MISSING");
});

test("6. requesting expectedChildCount for a non-exact-multiple (child longer than parent) throws explicitly", () => {
  assert.throws(() => expectedChildCount("M15", "H1"), /not a valid detail timeframe/);
});

test("7. MN1 (no fixed duration) cannot participate as a parent or child timeframe — throws rather than guessing a length", () => {
  assert.throws(() => timeframeDurationMs("MN1"));
});

test("8. a later parent's children never leak into an earlier parent's query, even when both live in the same backing array (HTF lookahead protection)", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const earlierParent = parentBarIdentity(FIXTURE_A_PARENT_BARS[0]!);
  const result = provider.getDetail({ parent: earlierParent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "MISSING");
});

test("9. ambiguity that even a single CHILD bar's own OHLC cannot resolve is preserved (ambiguous: true), never fabricated certainty", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
  // A pathological single child whose own range reaches BOTH levels must still report ambiguous:true.
  const bothReachableChild = { ...sequence.observations[0]!, high: 113, low: 90 };
  const pathological = { ...sequence, observations: [bothReachableChild] };
  const outcome = resolveIntrabarProtectiveExit("BUY", 96, 111, pathological, SIM_INSTRUMENT, CHILD_TIMEFRAME);
  assert.equal(outcome.exited, true);
  assert.equal(outcome.ambiguous, true);
  assert.equal(outcome.exitPrice, 96); // still resolves to the conservative stop-loss, never the favorable take-profit
});

test("10. resultHash differs between D1_OHLC and D2_LOWER_TIMEFRAME for the identical bars/strategy/config (fidelity is part of result identity)", () => {
  const d1 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  assert.notEqual(d1.resultHash, d2.resultHash);
});

test("11. a STOP_LIMIT that never trades through the limit within ANY available child returns triggeredOnly, never a fabricated fill", () => {
  const provider = createStaticBarDetailProvider([FIXTURE_D_CHILD_BARS[0]!], CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_D_PARENT_BAR);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
  const order = createOrder({ strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "STOP_LIMIT", stopPrice: 105, limitPrice: 108, creationTimestamp: parent.openTimestamp - 1 }, 1);
  const outcome = resolveIntrabarOrderFill(order, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME, ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, false);
  assert.equal(outcome.triggeredOnly, true);
});

test("12. an unrecognized fidelity value bypassing the TS union throws explicitly rather than silently falling through to D1 or D2 semantics", () => {
  const config = { ...buildFixtureAD2Config(), fidelity: "D9_INVENTED" as never };
  assert.throws(() => runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, config));
});

test("13. D2/D3 fidelity requires BOTH detailProvider and detailTimeframe — omitting either throws explicitly rather than defaulting to D1 behavior silently", () => {
  const base = buildFixtureAD2Config();
  const { detailProvider: _dp, ...noProvider } = base;
  const { detailTimeframe: _dt, ...noTimeframe } = base;
  void _dp;
  void _dt;
  assert.throws(() => runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, noProvider), /requires both detailProvider and detailTimeframe/);
  assert.throws(() => runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, noTimeframe), /requires both detailProvider and detailTimeframe/);
});

test("14. duplicate child-bar timestamps are rejected by the reused Q0.2 validateMarketSeries, not silently deduplicated", () => {
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const ts = FIXTURE_A_CHILD_BARS[0]!.timestamp;
  const dupDetail = {
    status: "COMPLETE" as const,
    bars: [
      { timestamp: ts, instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { timestamp: ts, instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ],
  };
  assert.throws(() => reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, dupDetail), /duplicate timestamp/);
});

test("15. FidelityComparison correctly lists unmatched trade IDs on whichever side has MORE trades, never silently dropping them", () => {
  const baseline = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const truncated = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS.slice(0, 4), buildFixtureAD1Config());
  const comparison = compareFidelities(baseline, truncated);
  assert.equal(comparison.unmatchedComparedTradeIds.length, 0);
  assert.equal(comparison.unmatchedBaselineTradeIds.length, 1);
  assert.equal(comparison.unmatchedBaselineTradeIds[0], baseline.tradeLedger[0]!.tradeId);
});

test("16. compareFidelities is direction-sensitive: swapping baseline/compared negates netPnlDelta but keeps the same classification and identical bit", () => {
  const d1 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD1Config());
  const d2 = runMultiFidelitySimulation(FIXTURE_A_PARENT_BARS, buildFixtureAD2Config());
  const forward = compareFidelities(d1, d2);
  const backward = compareFidelities(d2, d1);
  assert.equal(forward.netPnlDelta, -backward.netPnlDelta);
  assert.equal(forward.differenceClassification, backward.differenceClassification);
  assert.equal(forward.identical, backward.identical);
});

test("17. an empty BarDetailProvider backing array reports MISSING for every parent, never crashes or fabricates COMPLETE", () => {
  const provider = createStaticBarDetailProvider([], CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const result = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "MISSING");
});

test("18. child bars for a DIFFERENT symbol never match a query for this symbol, even within the exact same timestamp window", () => {
  const wrongSymbolChildren = FIXTURE_A_CHILD_BARS.map((b) => ({ ...b, instrument: { symbol: "OTHERSYMBOL" } }));
  const provider = createStaticBarDetailProvider(wrongSymbolChildren, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const result = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "MISSING");
});
