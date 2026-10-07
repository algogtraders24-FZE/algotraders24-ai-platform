// Validates the Live Results stats engine (pure, hand-computed expectations).
import assert from "node:assert/strict";
import { computeLiveResults } from "../services/live-results/stats";
import type { BalanceOp, ClosedTrade } from "../services/edge-analyzer/types";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const near = (a: number | null | undefined, b: number, m: string, tol = 0.011) => { assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b}`); checks++; };

const at = (iso: string) => Date.parse(iso + "Z");
let id = 0;
const trade = (p: Partial<ClosedTrade> & { net: number; closeTime: number }): ClosedTrade => ({
  positionId: String(++id), symbol: "US30", direction: "buy", volume: 0.1,
  openTime: p.closeTime - 3_600_000, openPrice: 1, closePrice: 1, stopLoss: null, takeProfit: null,
  commission: 0, swap: 0, profit: p.net, tag: "", ...p,
});

// ---- Scenario C: deposit 1000, Jan +100 (buy US30), Feb -55 (sell XAUUSD)
const ops: BalanceOp[] = [{ time: at("2026-01-05T09:00:00"), amount: 1000 }];
const trades = [
  trade({ closeTime: at("2026-01-10T12:00:00"), net: 100, direction: "buy", symbol: "US30" }),
  trade({ closeTime: at("2026-02-03T12:00:00"), net: -55, direction: "sell", symbol: "XAUUSD" }),
];
const now = at("2026-02-03T18:00:00"); // a Tuesday
const r = computeLiveResults(trades, ops, now);

eq([r.deposits, r.withdrawals, r.balance], [1000, 0, 1045], "deposits / withdrawals / balance = deposits - withdrawals + profit");
near(r.absoluteGainPct, -(-45) / 10, "absolute gain = profit / deposits", 0.001);
near(r.timeWeightedGainPct, 4.5, "time-weighted gain over the whole history");
eq(r.gainsDiverge, false, "gains agree -> no divergence flag");
eq(r.highestBalance, { balance: 1100, time: at("2026-01-10T12:00:00") }, "highest balance with its date");
near(r.core.maxDrawdownPct, 5, "drawdown from the 1100 peak");
eq(r.monthlyHistory.map((m) => [m.month, m.gainPct, m.profit, m.trades]), [["2026-01", 10, 100, 1], ["2026-02", -5, -55, 1]], "monthly history");
eq([r.daily.gainPct, r.weekly.gainPct, r.monthly.gainPct], [-5, -5, -5], "today / this week (Mon start) / this month");
near(r.yearly.gainPct, 4.5, "this year");
eq([r.daily.trades, r.daily.profit, r.daily.winRatePct], [1, -55, 0], "daily row counts");

// trade stats
eq(r.trade.bestTrade, { net: 100, time: at("2026-01-10T12:00:00") }, "best trade with date");
eq(r.trade.worstTrade, { net: -55, time: at("2026-02-03T12:00:00") }, "worst trade with date");
eq([r.trade.longs.won, r.trade.longs.total, r.trade.shorts.won, r.trade.shorts.total], [1, 1, 0, 1], "longs/shorts won");
near(r.trade.ahprPct, 2.5, "AHPR = mean of net / balance before", 0.0001);
near(r.trade.ghprPct, 2.2252, "GHPR = geometric mean", 0.0001);
eq(r.trade.avgTradeLengthMs, 3_600_000, "average trade length");
eq(r.bySymbol.map((s) => [s.symbol, s.total.trades, s.total.profit, s.total.wonPct]), [["US30", 1, 100, 100], ["XAUUSD", 1, -55, 0]], "per-symbol summary");
eq(r.bySymbol[0].longs, { trades: 1, profit: 100 }, "per-symbol longs split");

// growth series: deposit marker present, last point balance matches
const dep = r.growth.find((g) => g.flow === 1000);
ok(dep !== undefined, "deposit marker in the growth series");
eq(r.growth[r.growth.length - 1].balance, 1045, "growth series ends at the balance");

// ---- Scenario B: tiny first deposit, then a huge one. The two gains must visibly diverge and be flagged.
const opsB: BalanceOp[] = [{ time: at("2026-03-01T00:00:00"), amount: 100 }, { time: at("2026-03-05T00:00:00"), amount: 10_000 }];
const tradesB = [
  trade({ closeTime: at("2026-03-02T00:00:00"), net: 50 }),
  trade({ closeTime: at("2026-03-10T00:00:00"), net: -100 }),
];
const b = computeLiveResults(tradesB, opsB, at("2026-03-10T12:00:00"));
near(b.absoluteGainPct, -50 / 10100 * 100, "tiny-deposit case: absolute gain is about -0.50%");
near(b.timeWeightedGainPct, ((150 / 100) * (10050 / 10150) - 1) * 100, "tiny-deposit case: time-weighted gain counts the early tiny period");
eq(b.gainsDiverge, true, "gains differ by 10+ points -> flagged");

// withdrawals count separately and never as losses
const w = computeLiveResults([trade({ closeTime: at("2026-04-02T00:00:00"), net: 100 })], [{ time: at("2026-04-01T00:00:00"), amount: 1000 }, { time: at("2026-04-03T00:00:00"), amount: -600 }], at("2026-04-04T00:00:00"));
eq([w.deposits, w.withdrawals, w.balance], [1000, 600, 500], "withdrawal reduces balance but is not profit");
near(w.timeWeightedGainPct, 10, "withdrawal does not change time-weighted gain");

// ---- empty / degenerate inputs never throw and never invent numbers
const e = computeLiveResults([], [], now);
ok(e.timeWeightedGainPct === null && e.absoluteGainPct === null && e.highestBalance === null && e.growth.length === 0 && e.monthlyHistory.length === 0, "empty input gives nulls, not zeros");
const noDeposit = computeLiveResults([trade({ closeTime: at("2026-05-01T00:00:00"), net: 10 })], [], at("2026-05-01T00:00:00"));
ok(noDeposit.absoluteGainPct === null, "no deposit known -> absolute gain is null");

// ---- runs test (Z-score): alternating sequence is strongly positive; one long streak is strongly negative
const alt: ClosedTrade[] = [];
for (let i = 0; i < 20; i++) alt.push(trade({ closeTime: at("2026-06-01T00:00:00") + i * 60_000, net: i % 2 ? -10 : 10 }));
const za = computeLiveResults(alt, [{ time: at("2026-05-30T00:00:00"), amount: 1000 }]);
ok((za.trade.zScore ?? 0) > 4 && (za.trade.zConfidencePct ?? 0) > 99.9, "alternating wins/losses -> large positive Z");
const streak: ClosedTrade[] = [];
for (let i = 0; i < 20; i++) streak.push(trade({ closeTime: at("2026-06-01T00:00:00") + i * 60_000, net: i < 10 ? 10 : -10 }));
const zs = computeLiveResults(streak, [{ time: at("2026-05-30T00:00:00"), amount: 1000 }]);
ok((zs.trade.zScore ?? 0) < -3, "two long streaks -> large negative Z");
ok(computeLiveResults(alt.slice(0, 5), [{ time: at("2026-05-30T00:00:00"), amount: 1000 }]).trade.zScore === null, "fewer than 10 decided trades -> no Z");

// ---- growth series is capped but keeps every deposit/withdrawal marker
const many: ClosedTrade[] = [];
for (let i = 0; i < 2000; i++) many.push(trade({ closeTime: at("2026-07-01T00:00:00") + i * 60_000, net: i % 3 ? 1 : -1 }));
const big = computeLiveResults(many, [{ time: at("2026-06-30T00:00:00"), amount: 1000 }, { time: at("2026-07-01T10:00:00"), amount: 500 }]);
ok(big.growth.length <= 410, "growth series is downsampled");
ok(big.growth.filter((g) => g.flow !== undefined).length === 2, "all flow markers survive downsampling");

// ---- assumptions are attached and say there is no custom start
ok(r.assumptions.some((a) => /no custom start/i.test(a)), "assumptions state there is no custom start date");

console.log(`validate-live-results: ${checks} checks passed`);
