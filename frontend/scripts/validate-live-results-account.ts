// Validates the account-page additions: header facts, per-trade gain, history table privacy, best/worst dates, profit series. Pure.
import assert from "node:assert/strict";
import { buildPublicResults, HISTORY_ROWS_MAX, type BuildInput, type DealWithMagic } from "../services/live-results/build";
import { perTradeGainPct } from "../services/live-results/stats";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const at = (iso: string) => Date.parse(iso + "Z");

// ---- per-trade gain, hand computed: deposit 1000, +100 (10%), then -55 on 1100 (-5%), a deposit of 900, then +200 on 1945 (10.28%)
const mk = (id: string, iso: string, net: number): ClosedTrade => ({ positionId: id, symbol: "US30", direction: "buy", volume: 1, openTime: at(iso) - 3_600_000, closeTime: at(iso), openPrice: 1, closePrice: 2, stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: net, net, tag: "" });
const trades = [mk("a", "2026-01-10T12:00:00", 100), mk("b", "2026-01-11T12:00:00", -55), mk("c", "2026-01-13T12:00:00", 200)];
const ops = [{ time: at("2026-01-05T09:00:00"), amount: 1000 }, { time: at("2026-01-12T09:00:00"), amount: 900 }];
const g = perTradeGainPct(trades, ops);
eq([g.get("a"), g.get("b"), g.get("c")], [10, -5, 10.28], "per-trade gain is net / balance just before the trade, deposits included");
eq(perTradeGainPct([mk("z", "2026-01-10T12:00:00", 50)], []).get("z"), null, "no balance before the trade -> null, not infinity");

// ---- a synthetic page
let ms = at("2026-10-01T06:00:00");
let id = 0;
const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 60_000), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40123.5, commission: -3, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...p });
const pair = (profit: number, symbol = "US30"): DealWithMagic[] => { const p = String(++id); return [deal({ positionId: p, symbol }), deal({ positionId: p, symbol, type: "sell", entry: "out", profit, comment: "", price: 40199.25 })]; };
const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0", commission: 0 })];
for (let i = 0; i < 330; i++) deals.push(...pair(i % 3 ? 40 : -60, i % 2 ? "US30" : "XAUUSD"));
const base: BuildInput = {
  page: { title: "T", description: "", showAmounts: false, positionDelayMin: 15, magicFilter: null },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 10_800, firstSyncAt: at("2026-10-02T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 4, chainHead: "c".repeat(64) },
  deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
};
const r = buildPublicResults(base);

eq([r.account.platform, r.account.leverage, r.account.utcOffsetHours, r.account.automated], ["MetaTrader 5", 500, 3, true], "account block: platform, leverage, GMT offset, automated (EA magic present)");
ok(r.account.startedAt !== null, "started date is the first event");
eq(buildPublicResults({ ...base, deals: deals.map((d) => ({ ...d, magic: "0" })) }).account.automated, false, "all-zero magic = manual trading");

eq([r.history.total, r.history.rows.length], [330, HISTORY_ROWS_MAX], "history is capped but reports the real total");
ok(r.history.rows[0]!.closeTime > r.history.rows[1]!.closeTime, "history is newest first");
ok(r.history.rows.every((h) => h.durationMs > 0 && h.gainPct !== null), "every row has a duration and a gain");
ok(r.history.rows.some((h) => h.symbol === "XAUUSD") && r.history.rows.every((h) => h.strategy.length > 0), "symbol and strategy are present");

// privacy: percent-only history carries no money, no size, no price
const keys = new Set(r.history.rows.flatMap((h) => Object.keys(h)));
for (const forbidden of ["volume", "openPrice", "closePrice", "stopLoss", "takeProfit", "net", "commission", "swap"]) ok(!keys.has(forbidden), `percent-only history has no ${forbidden}`);
ok(!JSON.stringify(r).includes("40123.5") && !JSON.stringify(r).includes("40199.25"), "percent-only: no price appears anywhere in the view model");
ok(r.amounts === undefined, "percent-only: no amounts block (so no cumProfit either)");

// with amounts
const a = buildPublicResults({ ...base, page: { ...base.page, showAmounts: true } });
const row = a.history.rows[0]!;
ok(row.volume === 1.5 && row.openPrice === 40123.5 && row.closePrice === 40199.25 && typeof row.net === "number", "with amounts: size, prices and net are in the history");
ok(a.amounts!.cumProfit.length === a.stats.growth.length, "cumProfit is aligned with the growth series");
const lastBal = a.amounts!.growthBalance.at(-1)!;
eq(a.amounts!.cumProfit.at(-1), Math.round((lastBal - 10_000) * 100) / 100, "cumProfit = balance minus net deposits");
eq(a.amounts!.cumProfit[0], 0, "cumProfit starts at 0 on the first deposit");

// best / worst trade carry a date and a percent
ok(r.stats.bestTrade !== null && r.stats.worstTrade !== null, "best and worst trade exist");
ok(r.stats.bestTrade!.gainPct! > 0 && r.stats.worstTrade!.gainPct! < 0, "best is a gain, worst is a loss");
ok(!("net" in (r.stats.bestTrade as object)), "percent-only best trade has no amount");

// ---- broker name: shown only when the owner switches it on AND the EA sent it
const withB = (showBroker: boolean | undefined, broker: string | null | undefined) => buildPublicResults({ ...base, page: { ...base.page, showBroker }, account: { ...base.account, broker } });
eq(withB(true, "Exness Technologies Ltd").account.broker, "Exness Technologies Ltd", "owner opted in + EA sent it -> shown");
ok(withB(false, "Exness Technologies Ltd").account.broker === undefined, "owner did not opt in -> never in the view model");
ok(withB(undefined, "Exness Technologies Ltd").account.broker === undefined, "default (unset) -> not shown");
ok(withB(true, null).account.broker === undefined && withB(true, undefined).account.broker === undefined, "EA did not send it -> nothing to show");
ok(!JSON.stringify(withB(false, "Exness Technologies Ltd")).includes("Exness"), "hidden broker name appears nowhere in the view model");

// ---- equity: balance + floating profit of the open positions shown (same delay), amounts only
const snap = (profit: number) => [{ time: at("2026-10-08T11:00:00"), positions: [{ ticket: 5, symbol: "US30", side: "buy" as const, volume: 1, priceOpen: 1, sl: 0, tp: 0, profit, timeMsc: 1 }] }];
const eqOn = buildPublicResults({ ...base, page: { ...base.page, showAmounts: true }, snapshots: snap(-20.5) });
eq(eqOn.amounts!.equity, Math.round((eqOn.amounts!.balance - 20.5) * 100) / 100, "equity = balance + floating profit of the delayed open positions");
eq(buildPublicResults({ ...base, page: { ...base.page, showAmounts: true } }).amounts!.equity, null, "no snapshot -> equity is null, not a guess");
ok(!JSON.stringify(buildPublicResults({ ...base, snapshots: snap(-20.5) })).includes("equity"), "percent-only: no equity anywhere in the view model");
const tooNew = buildPublicResults({ ...base, page: { ...base.page, showAmounts: true }, snapshots: [{ time: at("2026-10-08T11:55:00"), positions: snap(-99)[0]!.positions }] });
eq(tooNew.amounts!.equity, null, "a snapshot newer than the position delay is not used (equity would leak the current floating loss)");

// ---- platform label
eq(buildPublicResults(base).account.platform, "MetaTrader 5", "default platform label is MetaTrader 5");
eq(buildPublicResults({ ...base, account: { ...base.account, platform: "mt4" } }).account.platform, "MetaTrader 4", "an MT4 account is labelled MetaTrader 4");
eq(buildPublicResults({ ...base, account: { ...base.account, platform: "mt5" } }).account.platform, "MetaTrader 5", "an MT5 account is labelled MetaTrader 5");

console.log(`validate-live-results-account: ${checks} checks passed`);
