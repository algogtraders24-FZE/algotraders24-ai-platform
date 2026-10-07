// Validates the Live Sync -> Edge Analyzer mapping and the live-panel summary (pure, no DB).
import assert from "node:assert/strict";
import { dealsToHistory, type SyncedDeal } from "../services/live-sync/to-trades";
import { summarizeLive, STALE_MS, type SnapshotRow } from "../services/live-sync/live-summary";
import { analyzeTrades } from "../services/edge-analyzer";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
let ms = T0;
const deal = (p: Partial<SyncedDeal>): SyncedDeal => ({
  positionId: "1", timeMsc: (ms += 60_000), symbol: "EURUSD", type: "buy", entry: "in", volume: 0.1, price: 1.1,
  commission: 0, swap: 0, profit: 0, fee: 0, comment: "", ...p,
});

// 1) a simple closed buy and a closed sell, plus the opening deposit
const deals: SyncedDeal[] = [
  deal({ positionId: "0", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 1000 }),
  deal({ positionId: "1", type: "buy", entry: "in", price: 1.1, comment: "ea1" }),
  deal({ positionId: "1", type: "sell", entry: "out", price: 1.102, profit: 20, commission: -0.7, swap: -0.1 }),
  deal({ positionId: "2", type: "sell", entry: "in", price: 1.2, volume: 0.2 }),
  deal({ positionId: "2", type: "buy", entry: "out", price: 1.203, volume: 0.2, profit: -60, commission: -1.4 }),
];
const h = dealsToHistory(deals);
eq(h.trades.length, 2, "two closed trades");
eq(h.balanceOps.length, 1, "deposit is a balance op, not a trade");
const t1 = h.trades[0];
eq([t1.direction, t1.volume, t1.openPrice, t1.closePrice], ["buy", 0.1, 1.1, 1.102], "buy position fields");
ok(Math.abs(t1.net - 19.2) < 1e-9, "net = profit + commission + swap");
eq(t1.tag, "ea1", "comment becomes the tag");
eq(h.trades[1].direction, "sell", "direction follows the opening deal");

// 2) partial close stays open; missing opening deal is counted, not guessed
const partial = dealsToHistory([
  deal({ positionId: "3", type: "buy", entry: "in", volume: 0.3 }),
  deal({ positionId: "3", type: "sell", entry: "out", volume: 0.1, profit: 5 }),
  deal({ positionId: "4", type: "sell", entry: "out", volume: 0.1, profit: 5 }),
  deal({ positionId: "5", type: "buy", entry: "in" }),
]);
eq([partial.trades.length, partial.stillOpen, partial.missingOpen], [0, 2, 1], "partial/open/missing-open are not trades");

// 3) multi-fill position aggregates volume and weighted open price
const multi = dealsToHistory([
  deal({ positionId: "6", type: "buy", entry: "in", volume: 0.1, price: 1.0 }),
  deal({ positionId: "6", type: "buy", entry: "in", volume: 0.3, price: 2.0 }),
  deal({ positionId: "6", type: "sell", entry: "out", volume: 0.4, price: 2.5, profit: 10 }),
]);
ok(Math.abs(multi.trades[0].openPrice - 1.75) < 1e-9 && Math.abs(multi.trades[0].volume - 0.4) < 1e-9, "weighted open price, summed volume");

// 4) the shared engine runs on mapped data (no reported block -> no reconciliation)
const many: SyncedDeal[] = [deal({ positionId: "0", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 5000 })];
for (let i = 1; i <= 40; i++) {
  many.push(deal({ positionId: `p${i}`, type: "buy", entry: "in" }));
  many.push(deal({ positionId: `p${i}`, type: "sell", entry: "out", profit: i % 3 === 0 ? -30 : 20 }));
}
const mh = dealsToHistory(many);
const first = mh.balanceOps[0];
const report = analyzeTrades({
  meta: { platform: "MT5", currency: "USD", accountMode: "demo", hedging: true, reportDate: null, initialDeposit: first.amount },
  trades: mh.trades, balanceOps: mh.balanceOps, reported: null, warnings: [],
});
eq(report.core.tradeCount, 40, "engine counts mapped trades");
eq(report.reconciled, false, "synced data has no terminal summary to reconcile against");
ok(report.assumptions.length > 0, "assumptions still attached");

// 5) live summary
const now = T0 + 10 * 60_000;
const pos = (p: Partial<SnapshotRow["positions"][number]>) => ({ ticket: 1, symbol: "EURUSD", side: "buy" as const, volume: 0.1, priceOpen: 1, sl: 0, tp: 0, profit: 3, timeMsc: T0, ...p });
const snaps: SnapshotRow[] = [
  { time: now - 4 * 60_000, balance: 1000, equity: 1000, margin: 0, freeMargin: 1000, positions: [] },
  { time: now - 3 * 60_000, balance: 1000, equity: 1100, margin: 50, freeMargin: 1050, positions: [pos({})] },
  { time: now - 60_000, balance: 1000, equity: 990, margin: 100, freeMargin: 890, positions: [pos({ sl: 1.09, profit: -4 }), pos({ ticket: 2, side: "sell", volume: 0.3, profit: 1 })] },
];
const s = summarizeLive(snaps, now);
ok(s.hasData && !s.stale, "fresh data");
eq(s.latest?.floating, -10, "floating = equity - balance");
eq(s.latest?.marginLevelPct, 990, "margin level = equity / margin * 100");
eq([s.equityHigh, s.equityLow], [1100, 990], "equity range");
eq(s.windowDrawdownPct, 10, "window drawdown from the equity peak");
eq(s.exposure[0].netVolume, -0.2, "net exposure per symbol");
eq(s.withoutStopLoss, 1, "counts open positions with no stop loss");
ok(summarizeLive(snaps, now + STALE_MS + 120_000).stale, "old snapshot => stale (EA not running)");
const empty = summarizeLive([], now);
ok(!empty.hasData && empty.stale && empty.latest === null, "no snapshots => no data");
eq(summarizeLive(snaps, now, 2).series.length <= 3, true, "series is downsampled but keeps the last point");

// 6) tag grouping: broker auto comments fold together, long tail is capped
import { computePatterns, normalizeTag, BROKER_COMMENT_KEY, OTHER_TAGS_KEY, MAX_TAG_ROWS } from "../services/edge-analyzer/analysis/patterns";
eq(["[sl 4213.47]", "[tp 4870.58400]", "[p=1590140023]", "{1018195875}", " [SL 1] "].map(normalizeTag), Array(5).fill(BROKER_COMMENT_KEY), "broker comments normalize to one key");
eq([normalizeTag(""), normalizeTag("QuantumAI_BUY_XAUUSD"), normalizeTag("News C8 I7")], ["(none)", "QuantumAI_BUY_XAUUSD", "News C8 I7"], "real strategy tags are untouched");
const tagged: SyncedDeal[] = [];
for (let i = 1; i <= 60; i++) {
  const comment = i <= 30 ? `[sl ${4000 + i}]` : `Strat${i}`;
  tagged.push(deal({ positionId: `t${i}`, type: "buy", entry: "in", comment }));
  tagged.push(deal({ positionId: `t${i}`, type: "sell", entry: "out", profit: 5, comment }));
}
const tp = computePatterns(dealsToHistory(tagged).trades);
const keys = tp.byTag.map((b) => b.key);
ok(keys.length <= MAX_TAG_ROWS + 1, "tag rows are capped");
ok(keys.includes(BROKER_COMMENT_KEY) && keys.includes(OTHER_TAGS_KEY), "broker group and other-tags row exist");
eq(tp.byTag.reduce((n, b) => n + b.count, 0), 60, "no trade is lost by grouping");
eq(tp.byTag.find((b) => b.key === BROKER_COMMENT_KEY)?.count, 30, "all 30 broker-commented trades are in one row");

console.log(`validate-live-sync-analyze: ${checks} checks passed`);
