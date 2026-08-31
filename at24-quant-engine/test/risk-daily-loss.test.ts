import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDailyLossLimit, computeTradingDayKey, isSameTradingDay } from "../src/runtime/risk/daily-loss.js";
import type { RiskSpecification } from "../src/domain/risk-specification.js";

const fixedSpec: RiskSpecification = { sizing: { method: "fixed-lot", lots: 1 }, dailyLossLimit: { mode: "fixed-amount", amount: 500 } };
const percentSpec: RiskSpecification = { sizing: { method: "fixed-lot", lots: 1 }, dailyLossLimit: { mode: "percent-equity", percent: 5 } };

test("no dailyLossLimit configured: always passes", () => {
  const result = evaluateDailyLossLimit({ sizing: { method: "fixed-lot", lots: 1 } }, { realizedPnlToday: -100_000, equityAtDayStart: 10_000 });
  assert.equal(result.passed, true);
});

test("fixed-amount: loss below the limit passes", () => {
  const result = evaluateDailyLossLimit(fixedSpec, { realizedPnlToday: -400, equityAtDayStart: 10_000 });
  assert.equal(result.passed, true);
});

test("fixed-amount: loss exactly at the limit is REJECTED", () => {
  const result = evaluateDailyLossLimit(fixedSpec, { realizedPnlToday: -500, equityAtDayStart: 10_000 });
  assert.equal(result.passed, false);
  assert.equal(result.violation!.code, "DAILY_LOSS_LIMIT");
});

test("fixed-amount: loss above the limit is REJECTED", () => {
  assert.equal(evaluateDailyLossLimit(fixedSpec, { realizedPnlToday: -600, equityAtDayStart: 10_000 }).passed, false);
});

test("a net-positive day (profit) never triggers the loss limit", () => {
  assert.equal(evaluateDailyLossLimit(fixedSpec, { realizedPnlToday: 10_000, equityAtDayStart: 10_000 }).passed, true);
});

test("percent-equity mode computes the limit against equityAtDayStart, not a live/current equity", () => {
  // 5% of 10,000 = 500
  assert.equal(evaluateDailyLossLimit(percentSpec, { realizedPnlToday: -499, equityAtDayStart: 10_000 }).passed, true);
  assert.equal(evaluateDailyLossLimit(percentSpec, { realizedPnlToday: -500, equityAtDayStart: 10_000 }).passed, false);
});

test("computeTradingDayKey buckets timestamps on the same UTC day identically", () => {
  const t1 = Date.parse("2026-06-01T00:00:01Z");
  const t2 = Date.parse("2026-06-01T23:59:59Z");
  assert.equal(computeTradingDayKey(t1, 0), computeTradingDayKey(t2, 0));
});

test("computeTradingDayKey separates timestamps across the UTC boundary", () => {
  const beforeMidnight = Date.parse("2026-06-01T23:59:59Z");
  const afterMidnight = Date.parse("2026-06-02T00:00:01Z");
  assert.notEqual(computeTradingDayKey(beforeMidnight, 0), computeTradingDayKey(afterMidnight, 0));
});

test("a non-zero dayBoundaryOffsetMinutes shifts the boundary (broker-day convention, e.g. UTC-5)", () => {
  // 23:30 UTC is 18:30 in UTC-5 — still "the same broker day" as 00:30 UTC
  // (19:30 UTC-5) the next calendar UTC date, until the -5h shift crosses.
  const t1 = Date.parse("2026-06-01T23:30:00Z");
  const t2 = Date.parse("2026-06-02T02:00:00Z"); // 21:00 in UTC-5 on the *same* broker day as t1
  const offsetMinutes = -5 * 60;
  assert.equal(isSameTradingDay(t1, t2, offsetMinutes), true);
});

test("isSameTradingDay is deterministic and consistent with computeTradingDayKey", () => {
  const t1 = Date.parse("2026-06-01T10:00:00Z");
  const t2 = Date.parse("2026-06-01T20:00:00Z");
  assert.equal(isSameTradingDay(t1, t2, 0), computeTradingDayKey(t1, 0) === computeTradingDayKey(t2, 0));
});
