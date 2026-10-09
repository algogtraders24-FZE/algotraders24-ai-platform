// Validates netting-account support: one position per symbol, built from a per-symbol ledger. Hand-computed. Pure.
import assert from "node:assert/strict";
import { dealsToHistory, netDealsToHistory, type SyncedDeal } from "../services/live-sync/to-trades";
import { buildPublicResults, NETTING_NOTE, type BuildInput, type DealWithMagic } from "../services/live-results/build";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const near = (a: number | undefined, b: number, m: string) => { assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); checks++; };
const at = (iso: string) => Date.parse(iso + "Z");

let ms = at("2026-10-01T06:00:00");
const d = (p: Partial<SyncedDeal> & Pick<SyncedDeal, "type" | "entry" | "volume" | "price">): SyncedDeal => ({ positionId: "1", timeMsc: (ms += 60_000), symbol: "US30", commission: 0, swap: 0, profit: 0, fee: 0, comment: "", ...p });

// ---- A: scale in twice, close everything: ONE trade, volume-weighted open price
const A = netDealsToHistory([
  d({ type: "buy", entry: "in", volume: 1, price: 100, comment: "Zenith_Buy" }),
  d({ type: "buy", entry: "in", volume: 1, price: 102, commission: -1 }),
  d({ type: "sell", entry: "out", volume: 2, price: 105, profit: 8, commission: -2, swap: -0.5 }),
]);
eq(A.trades.length, 1, "A: scaling in and closing is one trade");
const a = A.trades[0]!;
eq([a.direction, a.volume, a.openPrice, a.closePrice], ["buy", 2, 101, 105], "A: buy, 2 lots, weighted open 101, close 105");
eq([a.profit, a.commission, a.swap, a.net, a.tag], [8, -3, -0.5, 4.5, "Zenith_Buy"], "A: profit 8, commission -1 + -2, swap -0.5, net 4.5, tag from the first deal");

// ---- B: reversal. buy 1 @100, then ONE deal sells 3 @110 (closes 1 with +10, opens short 2), then buy 2 @105 closes the short (+10)
const B = netDealsToHistory([
  d({ type: "buy", entry: "in", volume: 1, price: 100 }),
  d({ type: "sell", entry: "inout", volume: 3, price: 110, profit: 10, commission: -3, swap: -0.3 }),
  d({ type: "buy", entry: "out", volume: 2, price: 105, profit: 10, commission: -1 }),
]);
eq(B.trades.length, 2, "B: a reversal ends one trade and starts the next");
const [b1, b2] = B.trades as [typeof B.trades[number], typeof B.trades[number]];
eq([b1.direction, b1.volume, b1.openPrice, b1.closePrice, b1.profit], ["buy", 1, 100, 110, 10], "B: first trade is the long that was reversed");
near(b1.commission, -1, "B: the reversal's commission is split by volume (1 of 3 lots closes the long)");
near(b1.swap, -0.1, "B: swap split the same way");
eq([b2.direction, b2.volume, b2.openPrice, b2.closePrice, b2.profit], ["sell", 2, 110, 105, 10], "B: second trade is the short opened by the remainder");
near(b2.commission, -2 + -1, "B: the short carries the other 2/3 of the reversal commission plus its own closing commission");
near(B.trades.reduce((s, t) => s + t.net, 0), 10 + 10 - 3 - 1 - 0.3, "B: the two trades add up to every deal's profit + commission + swap (nothing lost, nothing counted twice)");
eq([B.missingOpen, B.stillOpen], [0, 0], "B: nothing skipped, nothing left open");

// ---- C: partial reductions keep ONE trade open until flat
const C = netDealsToHistory([
  d({ type: "buy", entry: "in", volume: 2, price: 100 }),
  d({ type: "sell", entry: "out", volume: 1, price: 103, profit: 5 }),
  d({ type: "sell", entry: "out", volume: 1, price: 104, profit: 7 }),
]);
eq(C.trades.length, 1, "C: two partial closes of one position are one trade");
eq([C.trades[0]!.profit, C.trades[0]!.volume, C.trades[0]!.closePrice], [12, 2, 104], "C: profit 12, volume 2, close price of the last closing deal");

// ---- D: history cut: the opening deal was never synced
const D = netDealsToHistory([
  d({ type: "sell", entry: "out", volume: 1, price: 100, profit: 3 }),
  d({ type: "buy", entry: "in", volume: 1, price: 101 }),
]);
eq([D.trades.length, D.missingOpen, D.stillOpen], [0, 1, 1], "D: a reduce with no known opening is counted as skipped, the next open stays open");

// ---- E: symbols are independent; short-first trade; ordering by time not by input order
const E = netDealsToHistory([
  d({ type: "sell", entry: "out", volume: 1, price: 4400, symbol: "XAUUSD", profit: 25, timeMsc: at("2026-10-02T11:00:00") }),
  d({ type: "sell", entry: "in", volume: 1, price: 4410, symbol: "XAUUSD", timeMsc: at("2026-10-02T10:00:00") }),
  d({ type: "buy", entry: "in", volume: 1, price: 100, symbol: "US30", timeMsc: at("2026-10-02T10:30:00") }),
]);
eq(E.trades.length, 0, "E: deals are sorted by time and judged by their side, not their label: a later SELL on an open short adds to it, so nothing closes");
const E2 = netDealsToHistory([
  d({ type: "buy", entry: "out", volume: 1, price: 4400, symbol: "XAUUSD", profit: 25, timeMsc: at("2026-10-02T11:00:00") }),
  d({ type: "sell", entry: "in", volume: 1, price: 4410, symbol: "XAUUSD", timeMsc: at("2026-10-02T10:00:00") }),
  d({ type: "buy", entry: "in", volume: 1, price: 100, symbol: "US30", timeMsc: at("2026-10-02T10:30:00") }),
]);
eq([E2.trades.length, E2.trades[0]!.direction, E2.trades[0]!.symbol, E2.stillOpen], [1, "sell", "XAUUSD", 1], "E2: input order does not matter (sorted by time); a short is a short; the other symbol stays open");

// ---- F: balance operations and zero-volume deals
const F = netDealsToHistory([
  d({ type: "balance", entry: "none", volume: 0, price: 0, profit: 10_000, symbol: "" }),
  d({ type: "buy", entry: "in", volume: 0, price: 1 }),
  d({ type: "buy", entry: "in", volume: 1, price: 100 }),
  d({ type: "sell", entry: "out", volume: 1, price: 101, profit: 1 }),
]);
eq([F.balanceOps.length, F.balanceOps[0]!.amount, F.trades.length], [1, 10_000, 1], "F: balance deals become balance operations, a zero-volume deal is ignored");

// ---- hedging is untouched and the margin mode switches the mapper
const hedgingDeals: SyncedDeal[] = [
  d({ positionId: "7", type: "buy", entry: "in", volume: 1, price: 100 }),
  d({ positionId: "7", type: "sell", entry: "out", volume: 1, price: 101, profit: 1 }),
];
eq(dealsToHistory(hedgingDeals).trades.length, 1, "hedging (the default) still pairs by position id");
eq(dealsToHistory(hedgingDeals, "netting").trades.length, 1, "the same simple deals give one trade in either mode");
const sameSymbolTwoIds: SyncedDeal[] = [
  d({ positionId: "7", type: "buy", entry: "in", volume: 1, price: 100 }),
  d({ positionId: "8", type: "buy", entry: "in", volume: 1, price: 102 }),
  d({ positionId: "7", type: "sell", entry: "out", volume: 1, price: 103, profit: 3 }),
  d({ positionId: "8", type: "sell", entry: "out", volume: 1, price: 104, profit: 2 }),
];
eq([dealsToHistory(sameSymbolTwoIds, "hedging").trades.length, dealsToHistory(sameSymbolTwoIds, "netting").trades.length], [2, 1], "two simultaneous positions on one symbol are 2 trades when hedging and 1 position when netting");

// ---- through the public view model
let pid = 0;
const bd = (p: Partial<DealWithMagic>): DealWithMagic => ({ ...d({ type: "buy", entry: "in", volume: 1, price: 40000 }), magic: "33302", ...p });
const deals: DealWithMagic[] = [bd({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0" })];
for (let i = 0; i < 6; i++) {
  const id = String(++pid);
  deals.push(bd({ positionId: id, type: "buy", entry: "in" }), bd({ positionId: id, type: "sell", entry: "out", profit: i % 2 ? -20 : 30 }));
}
const base: BuildInput = {
  page: { title: "N", description: "", showAmounts: false, positionDelayMin: 15, magicFilter: null },
  account: { mode: "demo", currency: "USD", marginMode: "netting", leverage: 100, serverUtcOffsetSec: 0, firstSyncAt: at("2026-10-01T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 2, chainHead: "c".repeat(64) },
  deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
};
const net = buildPublicResults(base);
eq(net.stats.trades, 6, "a netting page builds 6 trades from 6 flat-to-flat round trips");
ok(net.disclosure.includes(NETTING_NOTE), "a netting page says how its trades are built and that the EA filter is approximate");
const hed = buildPublicResults({ ...base, account: { ...base.account, marginMode: "hedging" } });
ok(!hed.disclosure.includes(NETTING_NOTE), "a hedging page does not carry the netting note");
eq(hed.stats.trades, 6, "hedging page: same 6 trades");

console.log(`validate-live-sync-netting: ${checks} checks passed`);
