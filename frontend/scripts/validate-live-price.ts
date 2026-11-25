// scripts/validate-live-price.ts - the forming candle follows the live quote, and a plan the price has run away from is flagged.
// Run: npx tsx scripts/validate-live-price.ts
import assert from "node:assert/strict";
import { applyLiveQuote, marketOrderCheck, planFreshness } from "../lib/chart-engine/live-price";
import type { ChartCandle } from "../types/chart-data";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const H = 3_600_000;
const T0 = Date.parse("2026-11-25T17:00:00Z");
const c = (time: number, o: number, h: number, l: number, cl: number): ChartCandle => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });
const series = [c(T0 - 2 * H, 3500, 3510, 3490, 3505), c(T0 - H, 3505, 3525, 3440, 3445), c(T0, 3445, 3512, 3444, 3508.95)];

test("the forming candle takes the live mid as its close", () => {
  const out = applyLiveQuote(series, { bid: 3518.5, ask: 3518.6 }, H, T0 + 20 * 60_000);
  assert.equal(out.length, 3);
  assert.equal(out[2].close, 3518.55);
  assert.equal(out[2].high, 3518.55, "price beyond the old high lifts the high");
  assert.equal(out[2].low, 3444);
  assert.equal(series[2].close, 3508.95, "the input is not mutated");
});
test("a price inside the candle's range only changes the close", () => {
  const out = applyLiveQuote(series, { bid: 3500, ask: 3500.2 }, H, T0 + 20 * 60_000);
  assert.equal(out[2].high, 3512);
  assert.equal(out[2].close, 3500.1);
});
test("nothing is patched when the last candle is not the current period (feed a period behind, market closed)", () => {
  assert.equal(applyLiveQuote(series, { bid: 3518, ask: 3519 }, H, T0 + 3 * H), series);
});
test("no quote, no interval or an invalid quote: the same array", () => {
  assert.equal(applyLiveQuote(series, undefined, H, T0 + 1000), series);
  assert.equal(applyLiveQuote(series, { bid: 1, ask: 1 }, undefined, T0 + 1000), series);
  assert.equal(applyLiveQuote(series, { bid: NaN, ask: 1 }, H, T0 + 1000), series);
});
test("nothing is appended: the candle count never changes", () => {
  assert.equal(applyLiveQuote(series, { bid: 3600, ask: 3601 }, H, T0 + 1000).length, series.length);
});

const longLimit = { dir: "long" as const, entryType: "limit" as const, entry: 3511.4, stop: 3487, target: 3560 };
const shortLimit = { dir: "short" as const, entryType: "limit" as const, entry: 3530.3, stop: 3551.3, target: 3488.4 };
test("a fresh plan is fine", () => {
  assert.equal(planFreshness(longLimit, 3518.5).ok, true);
  assert.equal(planFreshness(shortLimit, 3518.5).ok, true);
});
test("a long limit is stale once price is at or below its entry; a short limit once price is at or above it", () => {
  assert.equal(planFreshness(longLimit, 3511).ok, false);
  assert.equal(planFreshness(shortLimit, 3531).ok, false);
});
test("a plan whose target or stop price has already reached is stale", () => {
  assert.match(planFreshness(longLimit, 3561).reason ?? "", /target/);
  assert.match(planFreshness(longLimit, 3480).reason ?? "", /stop/);
  assert.match(planFreshness(shortLimit, 3480).reason ?? "", /target/);
  assert.match(planFreshness(shortLimit, 3560).reason ?? "", /stop/);
});
test("a market plan is stale when price ran more than a quarter of the risk from the entry", () => {
  const m = { dir: "long" as const, entryType: "market" as const, entry: 3500, stop: 3480, target: 3540 };
  assert.equal(planFreshness(m, 3504).ok, true);
  assert.equal(planFreshness(m, 3510).ok, false);
});
test("an unusable live price never blocks a plan", () => {
  assert.equal(planFreshness(longLimit, NaN).ok, true);
});

test("market order now: a buy fills at the ask, a sell at the bid, with the plan's own stop and target", () => {
  const buy = marketOrderCheck({ dir: "long", stop: 3487, target: 3560 }, { bid: 3518.5, ask: 3518.6 });
  assert.equal(buy.ok, true);
  assert.equal(buy.entry, 3518.6);
  assert.ok(Math.abs(buy.rr - (3560 - 3518.6) / (3518.6 - 3487)) < 1e-9);
  const sell = marketOrderCheck({ dir: "short", stop: 3551.3, target: 3488.4 }, { bid: 3518.5, ask: 3518.6 });
  assert.equal(sell.ok, true);
  assert.equal(sell.entry, 3518.5);
});
test("market order now: refused once price is beyond the stop or the target", () => {
  assert.equal(marketOrderCheck({ dir: "long", stop: 3487, target: 3560 }, { bid: 3486, ask: 3486.1 }).ok, false);
  assert.equal(marketOrderCheck({ dir: "long", stop: 3487, target: 3560 }, { bid: 3561, ask: 3561.1 }).ok, false);
  assert.equal(marketOrderCheck({ dir: "short", stop: 3551.3, target: 3488.4 }, { bid: 3560, ask: 3560.1 }).ok, false);
  assert.equal(marketOrderCheck({ dir: "short", stop: 3551.3, target: 3488.4 }, { bid: 3480, ask: 3480.1 }).ok, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
