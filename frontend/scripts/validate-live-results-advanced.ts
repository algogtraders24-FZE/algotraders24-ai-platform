// Validates the Live Results advanced tabs (hourly, weekday, risk of ruin, duration). Pure, hand-computed.
import assert from "node:assert/strict";
import { computeAdvanced, DURATION_POINTS } from "../services/live-results/advanced";
import { buildPublicResults, type DealWithMagic } from "../services/live-results/build";
import type { BalanceOp, ClosedTrade } from "../services/edge-analyzer/types";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const at = (iso: string) => Date.parse(iso + "Z"); // 2026-10-05 is a Monday, 2026-10-07 a Wednesday
let id = 0;
const trade = (openIso: string, net: number, holdMin = 60): ClosedTrade => {
  const open = at(openIso);
  return { positionId: String(++id), symbol: "US30", direction: "buy", volume: 1, openTime: open, closeTime: open + holdMin * 60_000, openPrice: 1, closePrice: 1, stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: net, net, tag: "" };
};
const dep = (iso: string, amount: number): BalanceOp => ({ time: at(iso), amount });

// ---- hourly + weekday
const t = [
  trade("2026-10-05T09:10:00", 50),   // Mon 09 win
  trade("2026-10-05T09:40:00", -30),  // Mon 09 loss
  trade("2026-10-07T14:05:00", 20),   // Wed 14 win
];
const a = computeAdvanced(t, [dep("2026-10-01T00:00:00", 1000)], 1040, 1, false);
eq(a.hourly.length, 24, "24 hourly bins");
eq([a.hourly[9].wins, a.hourly[9].losses, a.hourly[14].wins, a.hourly[14].losses], [1, 1, 1, 0], "winners/losers land in the hour of entry");
eq(a.hourly.reduce((n, h) => n + h.wins + h.losses, 0), 3, "no trade lost across hourly bins");
eq(a.weekday.map((d) => d.day), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "weekdays start on Monday");
eq([a.weekday[0].trades, a.weekday[0].winRatePct, a.weekday[1].trades, a.weekday[1].winRatePct, a.weekday[2].winRatePct], [2, 50, 0, null, 100], "weekday counts and win rates (empty day = null)");
ok(a.weekday.every((d) => d.net === undefined), "percent-only: weekday has no net amounts");
ok(!JSON.stringify(a).includes('"net"'), "percent-only advanced payload carries no net field at all");
const am = computeAdvanced(t, [dep("2026-10-01T00:00:00", 1000)], 1040, 1, true);
eq([am.weekday[0].net, am.weekday[2].net], [20, 20], "with amounts: weekday net per day");

// ---- duration: growth % of each trade vs balance before it, last N only
const d = computeAdvanced([trade("2026-10-05T09:00:00", 100, 90), trade("2026-10-05T12:00:00", -55, 30)], [dep("2026-10-01T00:00:00", 1000)], 1045, 1, false);
eq(d.duration.map((p) => [p.gainPct, p.win, p.durationMs]), [[10, true, 5_400_000], [-5, false, 1_800_000]], "gain % = net / balance before the trade; duration in ms");
const many: ClosedTrade[] = [];
for (let i = 0; i < DURATION_POINTS + 50; i++) many.push(trade("2026-10-05T00:00:00", 1, 10));
many.forEach((x, i) => { x.openTime += i * 60_000; x.closeTime += i * 60_000; });
eq(computeAdvanced(many, [dep("2026-10-01T00:00:00", 10_000)], 10_250, 0, false).duration.length, DURATION_POINTS, "duration scatter is capped at the last 200 trades");

// ---- risk of ruin
const alt: ClosedTrade[] = [];
for (let i = 0; i < 40; i++) alt.push(trade("2026-10-05T10:00:00", i % 2 ? -100 : 100));
alt.forEach((x, i) => { x.openTime += i * 3_600_000; x.closeTime += i * 3_600_000; });
const r = computeAdvanced(alt, [dep("2026-10-01T00:00:00", 10_000)], 10_000, 1, false).ruin;
ok(r !== null, "ruin computed for 40 trades");
eq(r?.rows.map((x) => x.lossPct), [10, 20, 30, 40, 50, 60, 70, 80, 90], "loss sizes 10..90");
eq([r?.rows[0].consecutiveAvgLosses, r?.rows[4].consecutiveAvgLosses, r?.rows[8].consecutiveAvgLosses], [10, 50, 90], "average losses in a row to lose X% of 10,000 when the average loss is 100");
ok(r!.rows.every((x) => x.probIndependent >= 0 && x.probIndependent <= 1 && x.probStreak >= 0 && x.probStreak <= 1), "probabilities are between 0 and 1");
ok(r!.rows.every((x, i, arr) => i === 0 || (x.probIndependent <= arr[i - 1].probIndependent + 1e-9 && x.probStreak <= arr[i - 1].probStreak + 1e-9)), "a deeper drawdown is never more likely than a shallower one");
eq(computeAdvanced(alt, [dep("2026-10-01T00:00:00", 10_000)], 10_000, 1, false).ruin, r, "seeded: same input gives the same table");
eq(computeAdvanced(alt.slice(0, 20), [dep("2026-10-01T00:00:00", 10_000)], 10_000, 1, false).ruin, null, "fewer than 30 trades -> no ruin table");
eq(computeAdvanced(alt, [], 0, 1, false).ruin, null, "no capital base -> no ruin table");
ok(!JSON.stringify(r).includes("USD"), "ruin table carries no money");

// ---- integrated into the public view, percent-only
const deals: DealWithMagic[] = [{ positionId: "b", timeMsc: at("2026-10-01T00:00:00"), symbol: "", type: "balance", entry: "none", volume: 0, price: 0, commission: 0, swap: 0, profit: 5000, fee: 0, comment: "", magic: "0" }];
for (let i = 0; i < 40; i++) {
  const o = at("2026-10-05T08:00:00") + i * 3_600_000;
  deals.push({ positionId: `p${i}`, timeMsc: o, symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 1, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302" });
  deals.push({ positionId: `p${i}`, timeMsc: o + 600_000, symbol: "US30", type: "sell", entry: "out", volume: 1.5, price: 1, commission: 0, swap: 0, profit: i % 3 ? 40 : -60, fee: 0, comment: "", magic: "33302" });
}
const v = buildPublicResults({
  page: { title: "T", description: "", showAmounts: false, positionDelayMin: 15, magicFilter: "33302" },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: at("2026-10-05T00:00:00"), lastSyncAt: at("2026-10-07T00:00:00"), batches: 3, chainHead: "a".repeat(64) },
  deals, snapshots: [], nowUtc: at("2026-10-07T01:00:00"),
});
eq(v.advanced.hourly.length, 24, "advanced is part of the public view model");
ok(v.advanced.ruin !== null && v.advanced.duration.length === 40, "ruin table and duration points present");
ok(!JSON.stringify(v.advanced).match(/"net"|USD/), "public percent-only advanced payload leaks no money");

console.log(`validate-live-results-advanced: ${checks} checks passed`);
