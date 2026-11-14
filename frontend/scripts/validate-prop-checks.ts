// scripts/validate-prop-checks.ts
// No database, no network: the rule-style checks of the Edge Analyzer on hand-made trades.
//   npx tsx scripts/validate-prop-checks.ts
import assert from "node:assert/strict";
import { computePropChecks, PROP_CHECK_NOTES } from "../services/edge-analyzer/analysis/prop-checks";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 5, 9, 0, 0); // a Monday, broker time read as UTC

let n = 0;
function trade(o: Partial<ClosedTrade> & { openMin: number; holdMin: number; net: number }): ClosedTrade {
  const openTime = DAY0 + o.openMin * MIN;
  return {
    positionId: String(++n),
    symbol: o.symbol ?? "XAUUSD",
    direction: o.direction ?? "buy",
    volume: 0.1,
    openTime,
    closeTime: openTime + o.holdMin * MIN,
    openPrice: 100,
    closePrice: 101,
    stopLoss: o.stopLoss === undefined ? 99 : o.stopLoss,
    takeProfit: null,
    commission: 0,
    swap: 0,
    profit: o.net,
    net: o.net,
    tag: "",
  };
}
const DAYM = 24 * 60;

test("consistency: best day share, top-3 share, profitable and losing days", () => {
  const c = computePropChecks([
    trade({ openMin: 0, holdMin: 10, net: 100 }), // day 1
    trade({ openMin: DAYM, holdMin: 10, net: 50 }), // day 2
    trade({ openMin: 2 * DAYM, holdMin: 10, net: -20 }), // day 3
  ]).consistency;
  assert.equal(c.totalNet, 130);
  assert.equal(c.tradingDays, 3);
  assert.equal(c.profitableDays, 2);
  assert.equal(c.losingDays, 1);
  assert.equal(c.bestDayNet, 100);
  assert.equal(c.bestDayDate, "2026-10-05");
  assert.equal(c.bestDaySharePct, 76.92);
  assert.equal(c.top3DaysSharePct, 100);
});

test("consistency: a ratio is not invented when total profit is not positive", () => {
  const c = computePropChecks([trade({ openMin: 0, holdMin: 5, net: 40 }), trade({ openMin: DAYM, holdMin: 5, net: -90 })]).consistency;
  assert.equal(c.totalNet, -50);
  assert.equal(c.bestDaySharePct, null);
  assert.equal(c.top3DaysSharePct, null);
  assert.equal(c.bestDayNet, 40);
});

test("stop loss use: trades with a missing or zero stop are counted", () => {
  const s = computePropChecks([
    trade({ openMin: 0, holdMin: 5, net: 1 }),
    trade({ openMin: 10, holdMin: 5, net: 1, stopLoss: null }),
    trade({ openMin: 20, holdMin: 5, net: 1, stopLoss: 0 }),
    trade({ openMin: 30, holdMin: 5, net: 1, stopLoss: null }),
  ]).stopLoss;
  assert.deepEqual(s, { withStopLoss: 1, withoutStopLoss: 3, withoutPct: 75 });
});

test("overlap: adding in the same direction, hedging, and other symbols are told apart", () => {
  const o = computePropChecks([
    trade({ openMin: 0, holdMin: 20, net: 1, direction: "buy" }), // A
    trade({ openMin: 5, holdMin: 30, net: 1, direction: "buy" }), // B: same direction while A open
    trade({ openMin: 6, holdMin: 10, net: 1, direction: "sell" }), // C: opposite while A and B open
    trade({ openMin: 7, holdMin: 10, net: 1, direction: "buy", symbol: "EURUSD" }), // D: other symbol, not counted
  ]).overlap;
  assert.equal(o.maxOpenOnOneSymbol, 3);
  assert.equal(o.openedWhileSameDirectionOpenPct, 25); // B only, of 4 trades
  assert.equal(o.openedWhileOppositeDirectionOpenPct, 25); // C only
});

test("overlap: a position that is already closed does not count as open", () => {
  const o = computePropChecks([trade({ openMin: 0, holdMin: 10, net: 1 }), trade({ openMin: 10, holdMin: 10, net: 1 })]).overlap;
  assert.equal(o.maxOpenOnOneSymbol, 1);
  assert.equal(o.openedWhileSameDirectionOpenPct, 0);
});

test("holding: share under 1 and 5 minutes and the median", () => {
  const trades = [
    { ...trade({ openMin: 0, holdMin: 0, net: 1 }), closeTime: DAY0 + 30_000 }, // 30 s
    trade({ openMin: 10, holdMin: 4, net: 1 }),
    trade({ openMin: 30, holdMin: 10, net: 1 }),
  ];
  const h = computePropChecks(trades).holding;
  assert.equal(h.under1MinutePct, 33.33);
  assert.equal(h.under5MinutesPct, 66.67);
  assert.equal(h.medianHoldMs, 4 * MIN);
});

test("no trades: zeros and nulls, no crash", () => {
  const p = computePropChecks([]);
  assert.equal(p.tradeCount, 0);
  assert.equal(p.consistency.bestDayNet, null);
  assert.equal(p.consistency.bestDaySharePct, null);
  assert.equal(p.stopLoss.withoutPct, 0);
  assert.equal(p.overlap.maxOpenOnOneSymbol, 0);
  assert.equal(p.holding.medianHoldMs, null);
});

test("same input, same output, input untouched; the notes say these are measurements, not a verdict", () => {
  const input = [trade({ openMin: 5, holdMin: 5, net: 3 }), trade({ openMin: 0, holdMin: 5, net: 2 })];
  const copy = JSON.stringify(input);
  assert.deepEqual(computePropChecks(input), computePropChecks(input));
  assert.equal(JSON.stringify(input), copy);
  assert.ok(computePropChecks(input).notes.some((x) => /not a pass\/fail/i.test(x)));
  assert.equal(PROP_CHECK_NOTES.length, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
