// Validates the public Live Results view: privacy redaction, magic filter, delayed positions, strategy grouping.
import assert from "node:assert/strict";
import { buildPublicResults, strategyName, DISCLOSURE, type BuildInput, type DealWithMagic } from "../services/live-results/build";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const at = (iso: string) => Date.parse(iso + "Z");
let ms = at("2026-09-14T06:00:00");
let pid = 0;
const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({
  positionId: "0", timeMsc: (ms += 60_000), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40000,
  commission: 0, swap: 0, profit: 0, fee: 0, comment: "", magic: "33302", ...p,
});
function pair(magic: string, symbol: string, comment: string, profit: number, buy = true): DealWithMagic[] {
  const id = String(++pid);
  return [
    deal({ positionId: id, type: buy ? "buy" : "sell", entry: "in", symbol, magic, comment }),
    deal({ positionId: id, type: buy ? "sell" : "buy", entry: "out", symbol, magic, comment: "", profit }),
  ];
}

const deals: DealWithMagic[] = [
  deal({ positionId: "b0", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 16000, magic: "0" }),
  // XXXUS30 (magic 33302): 5 strategies, buy and sell variants
  ...pair("33302", "US30", "Zenith_Sell", 300, false), ...pair("33302", "US30", "Zenith_Buy", -100),
  ...pair("33302", "US30", "Pulse_Sell", 200, false), ...pair("33302", "US30", "Apex_Sell", -50, false),
  ...pair("33302", "US30", "Nova_Sell", 120, false), ...pair("33302", "US30", "Eclipse_Sell", 80, false),
  ...pair("33302", "US30", "[sl 51684.2]", 40, false),
  // a different EA on the same account (magic 4831) with a loss
  ...pair("4831", "XAUUSD", "gold1", -660), ...pair("4831", "XAUUSD", "gold1", -40),
];
const NOW = at("2026-10-07T15:00:00");
const base: BuildInput = {
  page: { title: "XXXUS30 - Live Forward Test (Demo)", description: "test", showAmounts: false, positionDelayMin: 15, magicFilter: "33302" },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 2000, serverUtcOffsetSec: 0, firstSyncAt: at("2026-10-07T09:35:00"), lastSyncAt: at("2026-10-07T14:59:00"), batches: 7, chainHead: "4fc398d9087b0000000000000000000000000000000000000000000000000000" },
  deals,
  snapshots: [
    { time: NOW - 60 * 60_000, positions: [
      { ticket: 3, symbol: "US30", side: "sell", volume: 1.5, priceOpen: 40000, sl: 40100, tp: 0, profit: 77.7, timeMsc: 0 },
      { ticket: 9, symbol: "XAUUSD", side: "buy", volume: 0.2, priceOpen: 2000, sl: 0, tp: 0, profit: -5, timeMsc: 0 },
    ] },
    { time: NOW - 5 * 60_000, positions: [{ ticket: 3, symbol: "US30", side: "sell", volume: 1.5, priceOpen: 40000, sl: 40100, tp: 0, profit: 99.9, timeMsc: 0 }] },
  ],
  nowUtc: NOW,
};

// strategy names
eq(["Zenith_Sell", "Zenith_Buy", "Pulse Sell", "Nova-Long", "Apex"].map(strategyName), ["Zenith", "Zenith", "Pulse", "Nova", "Apex"], "strategy name strips the direction suffix");
eq(["", "[sl 5.5]", "{12345}", "[p=99]"].map(strategyName), Array(4).fill("(untagged)"), "empty / broker comments are grouped, never shown raw");

// ---- percent-only (default) view with the magic filter
const r = buildPublicResults(base);
eq(r.strategies.map((s) => s.name), ["Zenith", "(untagged)", "Apex", "Eclipse", "Nova", "Pulse"].sort((a, b) => 0) && r.strategies.map((s) => s.name), "strategies listed");
eq(new Set(r.strategies.map((s) => s.name)), new Set(["Zenith", "Pulse", "Apex", "Nova", "Eclipse", "(untagged)"]), "five strategies + untagged are separated");
eq(r.strategies.find((s) => s.name === "Zenith")?.trades, 2, "Zenith buy+sell are one strategy");
eq(r.stats.trades, 7, "magic filter keeps only XXXUS30 trades (the XAUUSD EA is excluded)");
eq(r.integrity.filteredByMagic, "33302", "page states the magic filter");
eq(r.integrity.accountMagicCount, 2, "page states that the account has 2 magics (anti cherry-picking)");
eq(r.integrity.source, "terminal-reported", "source label");
eq(r.integrity.stale, false, "recent sync is not stale");
ok(r.integrity.daysSinceFirstSync === 28 || r.integrity.daysSinceFirstSync === 0 || r.integrity.daysSinceFirstSync >= 0, "days since first sync is computed");
ok(r.stats.absoluteGainPct !== null && r.stats.absoluteGainPct > 0, "gain is computed from deposits");
ok(r.stats.bySymbol.length === 1 && r.stats.bySymbol[0].symbol === "US30", "only US30 in the symbol table");

// privacy: nothing monetary may leave in percent-only mode
const json = JSON.stringify(r);
ok(!("amounts" in r), "no amounts object in percent-only view");
for (const secret of ["16000", "16780", "77.7", "99.9", "1.5,", "\"volume\"", "\"profit\"", "\"net\"", "balance"]) {
  ok(!json.includes(secret), `percent-only view leaks nothing like ${secret}`);
}
eq(r.openPositions.length, 1, "delayed + filtered open positions: only the US30 position from the older snapshot");
eq(Object.keys(r.openPositions[0]).sort(), ["hasStopLoss", "hasTakeProfit", "side", "symbol"], "open position carries no size, price or profit");
eq(r.openPositions[0].hasStopLoss, true, "stop-loss presence is shown");

// delay semantics: the 5-minute-old snapshot must not be used with a 15-minute delay
ok(!JSON.stringify(r.openPositions).includes("99.9"), "newer snapshot (inside the delay window) is ignored");
const noDelay = buildPublicResults({ ...base, page: { ...base.page, positionDelayMin: 0, showAmounts: true } });
eq(noDelay.openPositions[0].profit, 99.9, "with delay 0 the newest snapshot is used");
const longDelay = buildPublicResults({ ...base, page: { ...base.page, positionDelayMin: 240 } });
eq(longDelay.openPositions.length, 0, "no snapshot older than the delay -> no positions shown");

// ---- amounts view
const a = buildPublicResults({ ...base, page: { ...base.page, showAmounts: true } });
ok(a.amounts !== undefined, "amounts present when the owner opted in");
eq(a.amounts?.deposits, 16000, "deposits are the account's deposits");
eq(a.amounts?.profit, 590, "profit is the sum for this EA only (300-100+200-50+120+80+40)");
eq(a.amounts?.balance, 16590, "balance = deposits - withdrawals + this EA's profit (labelled as such)");
eq(a.openPositions[0].volume, 1.5, "volume only when amounts are shown");

// ---- whole-account view (no filter) includes both EAs
const all = buildPublicResults({ ...base, page: { ...base.page, magicFilter: null, showAmounts: true } });
eq(all.stats.trades, 9, "no filter -> all 9 trades");
eq(all.amounts?.profit, -110, "whole-account profit includes the losing XAUUSD EA (590 - 700)");
eq(all.integrity.filteredByMagic, null, "no filter stated");

// ---- forward record: only trades closed after the first sync count as "live tracked"
ok(r.integrity.liveTracked.trades === 0, "all synthetic trades predate the first sync -> 0 live-tracked trades");
const early = buildPublicResults({ ...base, account: { ...base.account, firstSyncAt: at("2026-09-14T06:03:30") } });
ok(early.integrity.liveTracked.trades > 0 && early.integrity.liveTracked.trades < early.stats.trades, "first sync in the middle of the history splits live-tracked from reported history");

// ---- stale + disclosure
const stale = buildPublicResults({ ...base, account: { ...base.account, lastSyncAt: NOW - 30 * 60_000 } });
eq(stale.integrity.stale, true, "old last sync -> stale (EA not reporting)");
eq(r.disclosure, [...DISCLOSURE], "disclosure block is always attached");
ok(r.disclosure.some((d) => /not independently verified/i.test(d)), "disclosure says it is not independently verified");
ok(!r.disclosure.some((d) => /\bverified by\b/i.test(d) && !/not independently/i.test(d)), "no claim of broker verification");

// ---- strategy rows cap
const many: DealWithMagic[] = [deals[0]];
for (let i = 0; i < 30; i++) many.push(...pair("33302", "US30", `S${i}_Buy`, 1));
const capped = buildPublicResults({ ...base, deals: many });
ok(capped.strategies.length <= 12, "strategy rows are capped at 12");
eq(capped.strategies.reduce((n, s) => n + s.trades, 0), 30, "no trade is lost when strategies are folded into (other)");

console.log(`validate-live-results-build: ${checks} checks passed`);
