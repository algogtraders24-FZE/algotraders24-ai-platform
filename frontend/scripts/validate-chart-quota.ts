// scripts/validate-chart-quota.ts - the Analyze / PRAGYA limits: 30 free days, 10 analyses a day, then a paid plan.
// Run: npx tsx scripts/validate-chart-quota.ts
import assert from "node:assert/strict";
import { BACKTEST_QUOTA, CHART_QUOTA, decideBacktest, decideQuota, utcDayStart, type QuotaInput } from "../lib/access/chart-quota";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const NOW = new Date("2026-12-01T10:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const base: QuotaInput = { kind: "chart_analyze", now: NOW, firstUseAt: daysAgo(3), usedToday: 0, isPro: false, isAdmin: false };

test("a new free user (never used) is allowed and has the full 30 days", () => {
  const d = decideQuota({ ...base, firstUseAt: null });
  assert.equal(d.allowed, true);
  assert.equal(d.trialDaysLeft, 30);
  assert.equal(d.remainingToday, 10);
});
test("free user inside the 30 days: 10 analyses a day, the 11th is refused with daily_limit", () => {
  assert.equal(decideQuota({ ...base, usedToday: 9 }).allowed, true);
  const d = decideQuota({ ...base, usedToday: 10 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "daily_limit");
  assert.equal(d.remainingToday, 0);
});
test("free user after 30 days is refused with trial_ended, whatever today's count", () => {
  const d = decideQuota({ ...base, firstUseAt: daysAgo(31), usedToday: 0 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "trial_ended");
  assert.equal(d.trialDaysLeft, 0);
});
test("day 29 is still free, day 30 exactly is over", () => {
  assert.equal(decideQuota({ ...base, firstUseAt: daysAgo(29) }).allowed, true);
  assert.equal(decideQuota({ ...base, firstUseAt: daysAgo(30) }).allowed, false);
});
test("a paid user is never blocked by the free period, only by the higher daily cap", () => {
  const old = { ...base, isPro: true, firstUseAt: daysAgo(400) };
  assert.equal(decideQuota({ ...old, usedToday: 59 }).allowed, true);
  const d = decideQuota({ ...old, usedToday: CHART_QUOTA.proAnalyzeDaily });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "daily_limit");
  assert.equal(d.trialDaysLeft, null);
});
test("an admin is never blocked", () => {
  const d = decideQuota({ ...base, isAdmin: true, firstUseAt: daysAgo(400), usedToday: 5000 });
  assert.equal(d.allowed, true);
});
test("PRAGYA answers have their own, wider daily cap", () => {
  assert.equal(decideQuota({ ...base, kind: "pragya_answer", usedToday: 19 }).allowed, true);
  assert.equal(decideQuota({ ...base, kind: "pragya_answer", usedToday: 20 }).allowed, false);
  assert.equal(decideQuota({ ...base, kind: "pragya_answer", isPro: true, usedToday: 119 }).allowed, true);
  assert.equal(decideQuota({ ...base, kind: "pragya_answer", isPro: true, usedToday: 120 }).allowed, false);
});
test("the day is the UTC day", () => {
  assert.equal(utcDayStart(new Date("2026-12-01T23:59:59Z")).toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(utcDayStart(new Date("2026-12-02T00:00:00Z")).toISOString(), "2026-12-02T00:00:00.000Z");
});
test("trial end time is exactly 30 days after the first use", () => {
  const d = decideQuota({ ...base, firstUseAt: daysAgo(3) });
  assert.equal(d.trialEndsAt, new Date(daysAgo(3).getTime() + 30 * 86_400_000).toISOString());
  assert.equal(d.trialDaysLeft, 27);
});

test("backtests: a free user gets exactly one, limited to 90 days", () => {
  const first = decideBacktest({ usedTotal: 0, usedToday: 0, isPro: false, isAdmin: false });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(first.maxRangeDays, BACKTEST_QUOTA.freeMaxRangeDays);
  const second = decideBacktest({ usedTotal: 1, usedToday: 1, isPro: false, isAdmin: false });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "free_limit_reached");
});
test("backtests: the free test is not renewed by a new day", () => {
  assert.equal(decideBacktest({ usedTotal: 1, usedToday: 0, isPro: false, isAdmin: false }).allowed, false);
});
test("backtests: a paid user is limited per day, not in total, and has no free-window cap", () => {
  assert.equal(decideBacktest({ usedTotal: 500, usedToday: 29, isPro: true, isAdmin: false }).allowed, true);
  const d = decideBacktest({ usedTotal: 500, usedToday: 30, isPro: true, isAdmin: false });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "daily_limit");
  assert.equal(d.maxRangeDays, null);
});
test("backtests: an admin is never limited", () => {
  const d = decideBacktest({ usedTotal: 9999, usedToday: 9999, isPro: false, isAdmin: true });
  assert.equal(d.allowed, true);
  assert.equal(d.remaining, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
