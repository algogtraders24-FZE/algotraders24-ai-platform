// Validates the Live Results downloads: CSV safety, sections, privacy (percent-only), owner trades CSV, PDF. Pure.
import assert from "node:assert/strict";
import { csvCell, csvRow, resultsCsv, resultsPdfBlocks, renderResultsPdf, tradesCsv } from "../services/live-results/export";
import { buildPublicResults, type BuildInput, type DealWithMagic } from "../services/live-results/build";
import { computeLiveResults } from "../services/live-results/stats";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

// ---- cell rules
eq(csvCell(null), "", "null is empty");
eq(csvCell(12.5), "12.5", "numbers are plain (negative numbers are not text, so no guard)");
eq(csvCell(-3.2), "-3.2", "a negative number stays a number");
eq(csvCell(NaN), "", "NaN is empty");
eq(csvCell(true), "true", "booleans");
eq(csvCell('say "hi", ok'), '"say ""hi"", ok"', "quotes and commas are escaped");
eq(csvCell("a\nb"), '"a\nb"', "newlines are quoted");
for (const evil of ["=SUM(A1)", "+cmd", "-2+3", "@HYPERLINK(\"x\")", "\tTAB", "\rCR"]) ok(csvCell(evil).startsWith("'") || csvCell(evil).startsWith("\"'"), `text starting with ${JSON.stringify(evil[0])} is neutralised against spreadsheet formulas`);
eq(csvRow(["a", 1, null, "b,c"]), 'a,1,,"b,c"', "row");

// ---- a synthetic page
const at = (iso: string) => Date.parse(iso + "Z");
let ms = at("2026-10-01T06:00:00");
let id = 0;
const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 60_000), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40000, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...p });
const pair = (profit: number, comment: string): DealWithMagic[] => { const p = String(++id); return [deal({ positionId: p, comment }), deal({ positionId: p, type: "sell", entry: "out", profit, comment: "" })]; };
const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0" })];
for (let i = 0; i < 40; i++) deals.push(...pair(i % 3 ? 40 : -60, i % 5 === 0 ? "=EVIL()_Sell" : "Zenith_Buy"));
const base: BuildInput = {
  page: { title: '=HYPERLINK("http://x","click"), pwn', description: "", showAmounts: false, positionDelayMin: 15, magicFilter: "33302" },
  account: { mode: "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: at("2026-10-02T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 4, chainHead: "c".repeat(64) },
  deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
};
const r = buildPublicResults(base);
const csv = resultsCsv(r, "2026-10-08");

ok(csv.startsWith("﻿"), "UTF-8 BOM so spreadsheets read it correctly");
ok(csv.includes("\r\n") && !/[^\r]\n(?![^"]*"[^"]*(?:"[^"]*"[^"]*)*$)/.test("x"), "CRLF row endings");
for (const section of ["# AT24 Live Results", "# Summary", "# Periods", "# Monthly", "# Daily", "# Strategies", "# By symbol", "# Hourly entries", "# Weekday entries", "# Risk of ruin", "# Growth", "# Disclosure"]) ok(csv.includes(section), `CSV has the section ${section}`);
ok(csv.includes("terminal-reported (not independently verified)"), "CSV states the source and that it is not independently verified");
ok(csv.includes(`'=HYPERLINK`), "a hostile page title is neutralised in the CSV");
ok(csv.includes("'=EVIL()"), "a hostile strategy name is neutralised in the CSV");
ok(!/\b(USD)\b/.test(csv) && !/^# Money/m.test(csv), "percent-only CSV has no Money section and no currency");
ok(!/,(profit|net)(,|\r)/i.test(csv.split("# Strategies")[1]!.split("# By symbol")[0]!), "percent-only strategy table has no money column");

// daily history is part of the CSV and the view
ok(r.stats.dailyHistory.length > 0 && r.stats.dailyHistory.length <= 120, "daily history is present and capped at 120 days");
ok(r.stats.dailyHistory.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)), "daily rows are dated days");
ok(!JSON.stringify(r.stats.dailyHistory).includes('"profit"'), "percent-only daily rows carry no profit");

// with amounts
const withAmounts = buildPublicResults({ ...base, page: { ...base.page, showAmounts: true } });
const csvMoney = resultsCsv(withAmounts, "2026-10-08");
ok(/^# Money \(USD;/m.test(csvMoney), "with amounts: a Money section with the currency");
ok(/profit/.test(csvMoney.split("# Monthly")[1]!.split("# Daily")[0]!), "with amounts: monthly profit column");
eq([withAmounts.amounts?.initialDeposit, withAmounts.amounts?.cashflows.length, withAmounts.amounts?.cashflows[0]?.amount], [10000, 1, 10000], "with amounts: the initial deposit and the deposits history are shown");
ok(csvMoney.includes("initial_deposit,10000") && csvMoney.includes("# Deposits and withdrawals (USD") && csvMoney.includes(",initial_deposit,10000"), "with amounts: CSV carries the initial deposit and the deposits history");
ok(!("initialDeposit" in (r as unknown as Record<string, unknown>)) && r.amounts === undefined && !JSON.stringify(r).includes("cashflows"), "percent-only: no initial deposit, no deposits history anywhere in the view model");
ok(resultsPdfBlocks(withAmounts, "2026-10-08").some((b) => b.t === "table" && JSON.stringify(b).includes("Initial deposit")), "with amounts: the PDF shows the initial deposit");

// ---- prop rule check in the downloads (percent-only, no currency)
const propR = buildPublicResults({ ...base, page: { ...base.page, prop: { profitTargetPct: 10, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 4 } } });
const propCsv = resultsCsv(propR, "2026-10-08");
ok(propCsv.includes("# Prop rule check") && propCsv.includes("daily_loss_pct"), "CSV has the prop rule check section");
ok(!/\bUSD\b/.test(propCsv.split("# Prop rule check")[1]!.split("\r\n\r\n")[0]!), "the prop section is percent-only (no currency)");
ok(!resultsCsv(r, "2026-10-08").includes("# Prop rule check"), "no prop section when Prop Mode is off or hidden");
ok(resultsPdfBlocks(propR, "2026-10-08").some((b) => b.t === "h2" && b.text === "Prop rule check"), "PDF has the prop rule check");
ok(!resultsPdfBlocks(r, "2026-10-08").some((b) => b.t === "h2" && b.text === "Prop rule check"), "PDF has no prop section when off");

// ---- the owner's own trades
const trades: ClosedTrade[] = [
  { positionId: "2", symbol: "US30", direction: "sell", volume: 1.5, openTime: at("2026-10-03T10:00:00"), closeTime: at("2026-10-03T11:00:00"), openPrice: 40000.5, closePrice: 39990.25, stopLoss: null, takeProfit: null, commission: -3, swap: -0.5, profit: 15.375, net: 11.875, tag: "=boom, \"x\"" },
  { positionId: "1", symbol: "US30", direction: "buy", volume: 1, openTime: at("2026-10-02T10:00:00"), closeTime: at("2026-10-02T11:00:00"), openPrice: 1, closePrice: 2, stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: -20, net: -20, tag: "" },
];
const tcsv = tradesCsv(trades);
const lines = tcsv.replace("﻿", "").trim().split("\r\n");
eq(lines[0], "position_id,symbol,direction,volume,open_time_broker,close_time_broker,open_price,close_price,profit,commission,swap,net,comment", "trades CSV header");
ok(lines[1]!.startsWith("1,US30,buy,1,") && lines[2]!.startsWith("2,US30,sell,1.5,"), "trades are ordered by close time");
ok(lines[2]!.includes("11.875") && lines[2]!.includes("-3"), "the owner's trades CSV includes amounts (their own data)");
ok(lines[2]!.endsWith(`"'=boom, ""x"""`), "trade comments are quoted and neutralised");

// ---- PDF
const blocks = resultsPdfBlocks(r, "2026-10-08");
const blockText = JSON.stringify(blocks);
ok(blocks[0]!.t === "title" && /Live Results/.test(JSON.stringify(blocks[0])), "PDF starts with a title");
ok(/not independently verified/i.test(blockText), "PDF repeats that the data is not independently verified");
ok(!/USD/.test(blockText) && !blocks.some((b) => b.t === "h2" && /^Money/.test(b.text)), "percent-only PDF has no money");
ok(resultsPdfBlocks(withAmounts, "2026-10-08").some((b) => b.t === "h2" && /^Money/.test(b.text)), "PDF with amounts has a Money section");
const when = new Date("2026-10-08T10:00:00Z");
async function pdfChecks(): Promise<void> {
const pdf = await renderResultsPdf(r, when);
ok(Buffer.from(pdf.slice(0, 5)).toString("latin1") === "%PDF-" && pdf.length > 2000, "a real PDF is produced");
const pdf2 = await renderResultsPdf(r, when);
ok(Buffer.compare(Buffer.from(pdf), Buffer.from(pdf2)) === 0, "the same input renders to identical bytes");
const weird = buildPublicResults({ ...base, page: { ...base.page, title: "XXX \u{1F680} éè 中文 Test" } });
ok((await renderResultsPdf(weird, when)).length > 2000, "emoji / accents / CJK in a title never break the PDF");
}

// ---- stats: the daily series itself (hand-computed)
const t0 = at("2026-01-05T09:00:00");
const mk = (iso: string, net: number, dir: "buy" | "sell" = "buy"): ClosedTrade => ({ positionId: iso, symbol: "US30", direction: dir, volume: 1, openTime: at(iso) - 3_600_000, closeTime: at(iso), openPrice: 1, closePrice: 1, stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: net, net, tag: "" });
const c = computeLiveResults([mk("2026-01-10T12:00:00", 100), mk("2026-02-03T12:00:00", -55, "sell")], [{ time: t0, amount: 1000 }], at("2026-02-03T18:00:00"));
const row = (d: string) => c.dailyHistory.find((x) => x.date === d);
eq([row("2026-01-10")?.gainPct, row("2026-01-10")?.trades], [10, 1], "daily gain on the day of the +100 trade is +10%");
eq([row("2026-02-03")?.gainPct, row("2026-02-03")?.trades], [-5, 1], "daily gain on the -55 day is -5%");
eq([row("2026-01-20")?.gainPct, row("2026-01-20")?.trades], [0, 0], "a quiet day is a zero row, so a chart is continuous");
ok(c.dailyHistory[0]!.date === "2026-01-05" && c.dailyHistory.at(-1)!.date === "2026-02-03", "daily rows run from the first event to the last");

void pdfChecks().then(() => {
  console.log(`validate-live-results-export: ${checks} checks passed`);
});
