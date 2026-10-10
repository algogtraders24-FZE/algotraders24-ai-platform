// Validates "My portfolio": per-account rows, honest pooled totals (demo/real/currency never mixed), stale flag, netting, growth cap. Hand-computed. Pure.
import assert from "node:assert/strict";
import { buildPortfolio, GROWTH_POINTS, STALE_AFTER_MS, type PortfolioAccountInput } from "../services/live-sync/portfolio";
import type { SyncedDeal } from "../services/live-sync/to-trades";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const near = (a: number | null | undefined, b: number, m: string, tol = 0.011) => { assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const at = (iso: string) => Date.parse(iso + "Z");
const NOW = at("2026-10-10T12:00:00");

let tick = 0;
const bal = (iso: string, amount: number): SyncedDeal => ({ positionId: "0", timeMsc: at(iso), symbol: "", type: "balance", entry: "none", volume: 0, price: 0, commission: 0, swap: 0, profit: amount, fee: 0, comment: "" });
function trade(id: string, openIso: string, closeIso: string, profit: number, symbol = "US30"): SyncedDeal[] {
  tick++;
  return [
    { positionId: id, timeMsc: at(openIso), symbol, type: "buy", entry: "in", volume: 1, price: 100, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy" },
    { positionId: id, timeMsc: at(closeIso), symbol, type: "sell", entry: "out", volume: 1, price: 100 + profit, commission: 0, swap: 0, profit, fee: 0, comment: "" },
  ];
}
const acct = (id: string, p: Partial<PortfolioAccountInput> & { deals: SyncedDeal[] }): PortfolioAccountInput => ({
  id, label: `Account ${id}`, mode: "demo", platform: "MT5", broker: null, currency: "USD", marginMode: "hedging", serverUtcOffsetSec: 0,
  firstSyncAt: at("2026-10-01T00:00:00"), lastSyncAt: NOW - 60_000, lastBalance: null, lastEquity: null, ...p,
});

// ---- A (demo USD): deposit 1000, +100 today. B (demo USD): deposit 2000, -100 today.
const A = acct("a", { lastBalance: 1100, lastEquity: 1090, deals: [bal("2026-10-01T08:00:00", 1000), ...trade("1", "2026-10-10T09:00:00", "2026-10-10T10:00:00", 100)] });
const B = acct("b", { lastBalance: 1900, lastEquity: 1880, deals: [bal("2026-10-01T08:00:00", 2000), ...trade("2", "2026-10-10T09:30:00", "2026-10-10T10:30:00", -100)] });
const p = buildPortfolio([A, B], NOW);

const rowA = p.rows.find((r) => r.id === "a")!;
const rowB = p.rows.find((r) => r.id === "b")!;
near(rowA.gainPct, 10, "A time-weighted gain 100 / 1000 = 10%");
near(rowB.gainPct, -5, "B time-weighted gain -100 / 2000 = -5%");
eq([rowA.absoluteGainPct, rowB.absoluteGainPct], [10, -5], "absolute gain = profit / deposits");
eq([rowA.profit, rowB.profit, rowA.deposits, rowB.deposits], [100, -100, 1000, 2000], "profit and deposits");
eq([rowA.balance, rowA.equity, rowB.balance, rowB.equity], [1100, 1090, 1900, 1880], "balance and equity are the terminal's own last-sync figures");
eq([rowA.trades, rowB.trades, rowA.winRatePct, rowB.winRatePct], [1, 1, 100, 0], "trades and win rate");
near(rowA.dailyPct, 10, "today (broker day) gain of A");
ok(rowA.maxDrawdownPct === 0 && rowB.maxDrawdownPct !== null && rowB.maxDrawdownPct > 0, "A never fell, B fell");
ok(!rowA.stale && !rowB.stale, "both synced a minute ago = not stale");
ok(rowA.growth.length >= 2 && rowA.growth.length <= GROWTH_POINTS, "a growth series within the cap");

// ---- pooled group: balance 3000 -> +100 -100 -> 0% (not the average of 10 and -5, which would be 2.5)
eq(p.groups.length, 1, "two demo USD accounts form one group");
const g = p.groups[0]!;
eq([g.key, g.mode, g.currency, g.accounts, g.title], ["demo|USD", "demo", "USD", 2, "Demo accounts (USD)"], "group identity");
eq([g.deposits, g.profit, g.trades], [3000, 0, 2], "pooled deposits, profit and trades");
eq([g.absoluteGainPct, g.gainPct], [0, 0], "the pooled gain is 0% (money-weighted), NOT the average of the two percentages");
eq([g.balance, g.equity], [3000, 2970], "balance and equity are summed");
eq([g.periods.today.trades, g.periods.today.profit], [2, 0], "pooled today: 2 trades netting 0");
eq(g.winRatePct, 50, "pooled win rate 1 of 2");

// ---- real and demo are never pooled; currencies are never added
const R = acct("r", { mode: "real", currency: "USD", lastBalance: 500, lastEquity: 500, deals: [bal("2026-10-01T08:00:00", 500)] });
const E = acct("e", { mode: "demo", currency: "EUR", lastBalance: 800, lastEquity: 800, deals: [bal("2026-10-01T08:00:00", 800)] });
const mixed = buildPortfolio([A, B, R, E], NOW);
eq(mixed.groups.map((x) => x.key), ["real|USD", "demo|EUR", "demo|USD"], "real first, then demo by currency");
eq(mixed.groups.find((x) => x.key === "demo|USD")!.balance, 3000, "the demo USD total does not include the real account or the EUR account");
eq([mixed.groups.find((x) => x.key === "real|USD")!.balance, mixed.groups.find((x) => x.key === "demo|EUR")!.balance], [500, 800], "each group has only its own money");
eq(mixed.groups.find((x) => x.key === "real|USD")!.trades, 0, "an account with no trades yet is a group with 0 trades");
ok(mixed.rows.find((r) => r.id === "r")!.gainPct === 0 || mixed.rows.find((r) => r.id === "r")!.gainPct === null, "no trades = 0% or unknown, never NaN");
eq(mixed.rows.find((r) => r.id === "r")!.maxDrawdownPct, null, "no trades = no drawdown figure");
eq(mixed.rows.find((r) => r.id === "r")!.winRatePct, null, "no trades = no win rate");
eq(mixed.groups.find((x) => x.key === "demo|USD")!.equity, 2970, "equity pooled for demo USD");
{
  const noEq = buildPortfolio([acct("x", { lastBalance: 100, lastEquity: null, deals: [bal("2026-10-01T08:00:00", 100)] }), A], NOW);
  eq(noEq.groups[0]!.equity, null, "if one account has no equity yet, the group equity is unknown (not a wrong sum)");
}

// ---- stale
const quiet = acct("q", { lastSyncAt: NOW - STALE_AFTER_MS - 1000, deals: [bal("2026-10-01T08:00:00", 100)] });
eq(buildPortfolio([quiet], NOW).rows[0]!.stale, true, "no sync for over 10 minutes = stale");

// ---- balance falls back to the closed-trade balance when there is no snapshot
const noSnap = buildPortfolio([acct("n", { lastBalance: null, lastEquity: null, deals: [bal("2026-10-01T08:00:00", 1000), ...trade("9", "2026-10-09T09:00:00", "2026-10-09T10:00:00", 50)] })], NOW).rows[0]!;
eq([noSnap.balance, noSnap.equity], [1050, null], "without a snapshot the balance is deposits + closed profit, equity unknown");

// ---- today is the BROKER day: a trade closed 22:30 UTC is already tomorrow on a +3h broker clock
{
  const late = acct("l", { serverUtcOffsetSec: 3 * 3600, deals: [bal("2026-10-01T08:00:00", 1000), ...trade("7", "2026-10-10T22:00:00", "2026-10-10T22:30:00", 100)] });
  const early = buildPortfolio([late], at("2026-10-10T23:00:00")).rows[0]!;
  // broker now = 02:00 on 2026-10-11; the trade (broker time 22:30 on the 10th, stored as naive) belongs to yesterday
  eq(early.dailyPct, 0, "a trade of the previous broker day is not 'today': today shows 0%, not the +10% of yesterday");
}

// ---- netting accounts use the netting mapper
{
  const net: SyncedDeal[] = [
    bal("2026-10-01T08:00:00", 1000),
    { positionId: "1", timeMsc: at("2026-10-09T09:00:00"), symbol: "US30", type: "buy", entry: "in", volume: 1, price: 100, commission: 0, swap: 0, profit: 0, fee: 0, comment: "" },
    { positionId: "1", timeMsc: at("2026-10-09T10:00:00"), symbol: "US30", type: "sell", entry: "inout", volume: 3, price: 110, commission: 0, swap: 0, profit: 10, fee: 0, comment: "" },
    { positionId: "2", timeMsc: at("2026-10-09T11:00:00"), symbol: "US30", type: "buy", entry: "out", volume: 2, price: 105, commission: 0, swap: 0, profit: 10, fee: 0, comment: "" },
  ];
  const asHedging = buildPortfolio([acct("h", { marginMode: "hedging", deals: net })], NOW).rows[0]!;
  eq([asHedging.trades, asHedging.profit], [1, 10], "precondition: read as hedging, the short's profit is lost (its opening deal has another position id)");
  const row = buildPortfolio([acct("n", { marginMode: "netting", deals: net })], NOW).rows[0]!;
  eq([row.trades, row.profit], [2, 20], "a netting account is built per symbol: the reversal is two trades and both profits are counted");
}

// ---- growth cap on a long history
{
  const many: SyncedDeal[] = [bal("2026-01-01T08:00:00", 1000)];
  for (let i = 0; i < 300; i++) many.push(...trade(String(100 + i), "2026-02-01T08:00:00", new Date(Date.UTC(2026, 1, 1, 9) + i * 3_600_000).toISOString().slice(0, 19), i % 2 ? -5 : 10));
  const row = buildPortfolio([acct("m", { deals: many })], NOW).rows[0]!;
  ok(row.growth.length <= GROWTH_POINTS && row.growth.length > 10, "a long history is cut to the growth point cap");
  ok(row.growth.every((pt, i) => i === 0 || pt.t >= row.growth[i - 1]!.t), "growth points stay in time order");
}

// ---- empty and a single account
eq(buildPortfolio([], NOW), { generatedAt: NOW, rows: [], groups: [] }, "no accounts = an empty portfolio");
eq(buildPortfolio([A], NOW).groups[0]!.accounts, 1, "a single account is a group of one");

console.log(`validate-live-sync-portfolio: ${checks} checks passed`);
