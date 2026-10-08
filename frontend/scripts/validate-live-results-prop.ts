// Validates Prop Mode: settings validation and the rule check, with hand-computed expectations. Pure.
import assert from "node:assert/strict";
import { computePropCheck, parsePropSettings, readStoredProp, DEFAULT_PROP_RULES, PROP_DISCLAIMER } from "../services/live-results/prop";
import { buildPublicResults, type BuildInput, type DealWithMagic } from "../services/live-results/build";
import { validatePageInput } from "../services/live-results/pages";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const at = (iso: string) => Date.parse(iso + "Z");
const T = (id: string, iso: string, net: number): ClosedTrade => ({ positionId: id, symbol: "US30", direction: "buy", volume: 1, openTime: at(iso) - 600_000, closeTime: at(iso), openPrice: 1, closePrice: 2, stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: net, net, tag: "" });
const dep = [{ time: at("2026-03-01T08:00:00"), amount: 10_000 }];
const rules = { profitTargetPct: 10, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 4 };

// ---- settings validation
const good = { profitTargetPct: 10, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 4, showPublic: false };
eq(parsePropSettings(good), good, "valid settings are accepted as they are");
eq(parsePropSettings({ ...good, profitTargetPct: 8.126 }), { ...good, profitTargetPct: 8.13 }, "numbers are rounded to 2 decimals");
for (const [bad, why] of [
  [{ ...good, profitTargetPct: 0 }, "target 0"], [{ ...good, profitTargetPct: 101 }, "target > 100"], [{ ...good, dailyLossPct: -1 }, "negative daily"],
  [{ ...good, dailyLossPct: 51 }, "daily > 50"], [{ ...good, maxLossPct: 4 }, "max below daily"], [{ ...good, minTradingDays: 2.5 }, "fractional days"],
  [{ ...good, minTradingDays: 61 }, "days > 60"], [{ ...good, showPublic: "yes" }, "showPublic not boolean"], [{ ...good, profitTargetPct: "10" }, "string number"],
  [{ ...good, dailyLossPct: NaN }, "NaN"], [null, "null"], [[1], "array"], ["x", "string"],
] as const) ok(typeof parsePropSettings(bad) === "string", `rejects ${why}`);
ok(readStoredProp({ nonsense: true }) === null && readStoredProp(null) === null && readStoredProp(good) !== null, "a bad stored value just means Prop Mode is off");
eq(DEFAULT_PROP_RULES, { profitTargetPct: 10, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 4 }, "defaults are the common challenge numbers");

// ---- page input carries it
const pageBody = { accountId: "acc_12345", title: "Page", description: "", visibility: "private", magicFilter: null, showAmounts: false, positionDelayMin: 15, listingSlug: null };
ok(validatePageInput(pageBody).ok && (validatePageInput(pageBody) as { value: { propMode: unknown } }).value.propMode === null, "no propMode in the request = off");
eq((validatePageInput({ ...pageBody, propMode: good }) as { value: { propMode: unknown } }).value.propMode, good, "a valid propMode is kept");
ok(!validatePageInput({ ...pageBody, propMode: { ...good, maxLossPct: 1 } }).ok, "an invalid propMode rejects the whole page save");

// ---- the check, hand computed (initial deposit 10 000)
// day 1: +300, -200 (never below its start)      -> day loss 0
// day 2: -400, -300, +100                         -> running -400, -700, -600 -> day loss 7.00 %
const a = computePropCheck([
  T("1", "2026-03-02T10:00:00", 300), T("2", "2026-03-02T12:00:00", -200),
  T("3", "2026-03-03T09:00:00", -400), T("4", "2026-03-03T11:00:00", -300), T("5", "2026-03-03T15:00:00", 100),
], dep, rules);
eq([a.state, a.brokenRule, a.brokenOn], ["rule_broken", "daily_loss", "2026-03-03"], "a 7% day against a 5% daily limit breaks the daily rule on that day");
eq([a.worstDailyLossPct, a.worstDailyLossDate, a.maxLossUsedPct, a.profitPct, a.tradingDays], [7, "2026-03-03", 6, -5, 2], "worst day 7%, deepest 6%, profit -5%, 2 trading days");
eq(a.targetProgressPct, 0, "a losing account has 0% target progress, never negative");

// relaxed daily limit: nothing broken, still in progress
const b = computePropCheck([
  T("1", "2026-03-02T10:00:00", 300), T("2", "2026-03-02T12:00:00", -200),
  T("3", "2026-03-03T09:00:00", -400), T("4", "2026-03-03T11:00:00", -300), T("5", "2026-03-03T15:00:00", 100),
], dep, { ...rules, dailyLossPct: 8 });
eq([b.state, b.brokenOn], ["in_progress", null], "with an 8% daily limit the same trades break nothing");

// target reached with enough days: + day 3 +700, day 4 +900 -> cum 1100 = 11 %
const c = computePropCheck([
  T("1", "2026-03-02T10:00:00", 300), T("2", "2026-03-02T12:00:00", -200),
  T("3", "2026-03-03T09:00:00", -400), T("4", "2026-03-03T11:00:00", -300), T("5", "2026-03-03T15:00:00", 100),
  T("6", "2026-03-04T10:00:00", 700), T("7", "2026-03-05T10:00:00", 900),
], dep, { ...rules, dailyLossPct: 8, minTradingDays: 4 });
eq([c.state, c.profitPct, c.targetProgressPct, c.tradingDays], ["target_reached", 11, 100, 4], "11% profit, 4 days, no loss rule broken = target reached (progress capped at 100)");
const c2 = computePropCheck([T("1", "2026-03-02T10:00:00", 1200)], dep, rules);
eq([c2.state, c2.tradingDays], ["in_progress", 1], "target reached on 1 day but 4 are required = still in progress");

// max loss breach without a daily breach: -600 (day 1, 6%), -500 (day 2, 5%) -> cum -1100 = 11 % >= 10
const d = computePropCheck([T("1", "2026-03-02T10:00:00", -600), T("2", "2026-03-03T10:00:00", -500)], dep, { ...rules, dailyLossPct: 8 });
eq([d.state, d.brokenRule, d.brokenOn, d.maxLossUsedPct], ["rule_broken", "max_loss", "2026-03-03", 11], "the static max loss breaks on the day the account is 11% below its start");

// both on the same day: the daily rule is reported (it is the more specific one)
const e = computePropCheck([T("1", "2026-03-02T10:00:00", -600)], dep, { ...rules, dailyLossPct: 5, maxLossPct: 5 });
eq(e.brokenRule, "daily_loss", "same-day tie reports the daily rule");

// exactly at the limit counts as broken (prop firms treat reaching the limit as a breach)
const f = computePropCheck([T("1", "2026-03-02T10:00:00", -500)], dep, rules);
eq([f.state, f.brokenRule], ["rule_broken", "daily_loss"], "exactly 5% in a day = broken");
const g = computePropCheck([T("1", "2026-03-02T10:00:00", -499)], dep, rules);
eq(g.state, "in_progress", "4.99% in a day is not broken");

// no deposit / empty
eq(computePropCheck([T("1", "2026-03-02T10:00:00", 50)], [], rules).state, "no_deposit", "no initial deposit -> cannot measure percentages");
eq(computePropCheck([], dep, rules).state, "in_progress", "a funded account with no trades yet is in progress");
// only the FIRST deposit is the base, whatever order the operations arrive in
eq(computePropCheck([T("1", "2026-03-02T10:00:00", -300)], [{ time: at("2026-03-02T08:00:00"), amount: 50_000 }, ...dep], rules).maxLossUsedPct, 3, "the EARLIEST deposit (10 000 on 03-01) is the base even when operations arrive unsorted: 300 / 10 000 = 3%");
eq(computePropCheck([T("1", "2026-03-02T10:00:00", -300)], [...dep, { time: at("2026-03-10T08:00:00"), amount: 50_000 }], rules).maxLossUsedPct, 3, "a LATER deposit is ignored: 300 / 10 000 = 3%");

// ---- inside the public view model
let ms = at("2026-10-01T06:00:00");
let pid = 0;
const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 3_600_000), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40000, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...p });
const pair = (profit: number): DealWithMagic[] => { const id = String(++pid); return [deal({ positionId: id }), deal({ positionId: id, type: "sell", entry: "out", profit, comment: "" })]; };
const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0" })];
for (let i = 0; i < 20; i++) deals.push(...pair(i % 4 ? 80 : -150));
const base: BuildInput = {
  page: { title: "T", description: "", showAmounts: false, positionDelayMin: 15, magicFilter: null },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: at("2026-10-01T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 4, chainHead: "c".repeat(64) },
  deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
};
ok(buildPublicResults(base).prop === undefined, "no prop rules passed in (off, or the viewer may not see it) -> no prop key at all");
const withProp = buildPublicResults({ ...base, page: { ...base.page, prop: rules } });
ok(withProp.prop !== undefined && withProp.prop.tradingDays > 0, "prop rules passed in -> a rule check is in the view model");
ok(!JSON.stringify(withProp.prop).includes("USD") && !/"(balance|deposit|net|profit)"/.test(JSON.stringify(withProp.prop)), "the rule check is percent-only: no currency and no money field, even on a percent-only page");
ok(PROP_DISCLAIMER.includes("not an official result of any prop firm"), "the disclaimer says it is not an official prop-firm result");

console.log(`validate-live-results-prop: ${checks} checks passed`);
