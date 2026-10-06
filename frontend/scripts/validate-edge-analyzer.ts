// scripts/validate-edge-analyzer.ts
// AT24 Trader Edge Analyzer (E1): MT5 HTML parser + core stats + patterns +
// reconciliation. House style (node:assert/strict, tsx). Run:
//   npm run validate:edge-analyzer
// Optional REAL-FILE oracle (never committed; the file holds account data):
//   EDGE_REPORT_PATH="C:\path\ReportHistory-123.html" npm run validate:edge-analyzer
// It asserts every number reconciles with the terminal's own Results block.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { analyzeMt5ReportBuffer, analyzeMt5ReportText } from "../services/edge-analyzer";
import { decodeReportBuffer, parseMt5Number, parseMt5Time, parseMt5HtmlReport, MAX_REPORT_CHARS } from "../services/edge-analyzer/parsers/mt5-html";
import { computeCoreStats } from "../services/edge-analyzer/analysis/core";
import { bucketBy, sizeAfterOutcome, LOW_SAMPLE_THRESHOLD } from "../services/edge-analyzer/analysis/patterns";
import type { ClosedTrade } from "../services/edge-analyzer/types";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

// ---- synthetic MT5-style report (mirrors the REAL layout, incl. the 14-cell rows) ----
const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const th = (cells: string[]) => `<tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr>`;

interface FixTrade { id: string; sym: string; type: "buy" | "sell"; vol: string; open: string; close: string; profit: string; tag?: string; commission?: string; swap?: string }

function report(trades: FixTrade[], opts: { results?: string[][]; withTag?: boolean; deposit?: string; extraRow?: string[] } = {}): string {
  const withTag = opts.withTag ?? true;
  const posHeader = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
  const posRows = trades.map((t) => {
    const base = [t.open, t.id, t.sym, t.type];
    const rest = [t.vol, "100.0", "0.00", "0.00", t.close, "101.0", t.commission ?? "0.00", t.swap ?? "0.00", t.profit];
    return tr(withTag ? [...base, t.tag ?? "TagA", ...rest] : [...base, ...rest]);
  });
  const extra = opts.extraRow ? [tr(opts.extraRow)] : [];
  const dealsHeader = ["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Order", "Cost", "Commission", "Fee", "Swap", "Profit", "Balance", "Comment"];
  const deposit = opts.deposit ?? "1 000.00";
  const dealRows = [tr(["2026.09.14 08:00:00", "1", "", "balance", "", "", "", "", "", "0.00", "0.00", "0.00", deposit, deposit, "D-trial"])];
  const resultsRows = (opts.results ?? []).map((r) => tr(r));
  return [
    "<html><head><title>999: X - Trade History Report</title></head><body><table>",
    tr(["Trade History Report"]),
    tr(["Name:", "SECRET NAME"]),
    tr(["Account:", "123456789&nbsp;(USD,&nbsp;Secret-Server-9,&nbsp;demo,&nbsp;Hedge)"]),
    tr(["Company:", "Secret Brokers Ltd"]),
    tr(["Date:", "2026.10.06 18:47"]),
    tr(["Positions"]),
    th(posHeader),
    ...posRows,
    ...extra,
    tr([""]),
    tr(["Orders"]),
    th(["Open Time", "Order", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "State", "Comment"]),
    tr(["Deals"]),
    th(dealsHeader),
    ...dealRows,
    tr(["Results"]),
    ...resultsRows,
    "</table></body></html>",
  ].join("\n");
}

// Close-time order differs from open-time order on purpose (see core.ts).
const T3: FixTrade[] = [
  { id: "1", sym: "US30", type: "sell", vol: "1", open: "2026.09.14 10:00:00", close: "2026.09.14 10:30:00", profit: "-300.00", tag: "Alpha" },
  { id: "2", sym: "US30", type: "sell", vol: "1", open: "2026.09.14 09:00:00", close: "2026.09.14 12:00:00", profit: "500.00", tag: "Beta" },
  { id: "3", sym: "XAUUSD", type: "buy", vol: "2", open: "2026.09.14 11:00:00", close: "2026.09.14 11:30:00", profit: "-100.00", tag: "Alpha" },
];
const RESULTS_OK = [
  ["Total Net Profit:", "100.00", "Gross Profit:", "500.00", "Gross Loss:", "-400.00"],
  ["Balance Drawdown Absolute:", "400.00", "Balance Drawdown Maximal:", "400.00 (40.00%)", "Balance Drawdown Relative:", "40.00% (400.00)"],
  ["Total Trades:", "3", "Short Trades (won %):", "2 (50.00%)", "Long Trades (won %):", "1 (0.00%)"],
  ["", "Profit Trades (% of total):", "1 (33.33%)", "Loss Trades (% of total):", "2 (66.67%)"],
];

function utf16le(s: string): Uint8Array {
  const out = Buffer.alloc(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  out.write(s, 2, "utf16le");
  return out;
}

function ct(over: Partial<ClosedTrade> & { closeTime: number }): ClosedTrade {
  return {
    positionId: String(Math.random()), symbol: "X", direction: "buy", volume: 1, openTime: over.closeTime - 1000, openPrice: 1, closePrice: 1,
    stopLoss: null, takeProfit: null, commission: 0, swap: 0, profit: 0, net: over.profit ?? 0, tag: "", ...over,
  };
}

console.log("primitives + decoding");
check("parseMt5Number: space thousands ok; comma-decimal / junk rejected (never guessed)", () => {
  assert.equal(parseMt5Number("5 000.00"), 5000);
  assert.equal(parseMt5Number("-12.50"), -12.5);
  assert.equal(parseMt5Number("1"), 1);
  for (const bad of ["5 000,00", "1,000.00", "abc", "", "1.2.3", "12%", "Infinity"]) assert.equal(parseMt5Number(bad), null, bad);
});
check("parseMt5Time: naive broker time; bad formats null", () => {
  assert.equal(parseMt5Time("2026.09.14 12:30:11"), Date.UTC(2026, 8, 14, 12, 30, 11));
  for (const bad of ["2026-09-14 12:30:11", "2026.09.14", "", "garbage"]) assert.equal(parseMt5Time(bad), null, bad);
});
check("decodeReportBuffer: UTF-16LE BOM, UTF-8, UTF-8 BOM", () => {
  assert.equal(decodeReportBuffer(utf16le("héllo")), "héllo");
  assert.equal(decodeReportBuffer(Buffer.from("plain", "utf8")), "plain");
  assert.equal(decodeReportBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("bom", "utf8")])), "bom");
});

console.log("parser");
check("14-cell rows (comment column between Type and Volume) are aligned correctly", () => {
  const p = parseMt5HtmlReport(report(T3));
  assert.ok(p.ok);
  if (!p.ok) return;
  const t1 = p.trades.find((t) => t.positionId === "1")!;
  assert.equal(t1.tag, "Alpha");
  assert.equal(t1.volume, 1);
  assert.equal(t1.openPrice, 100);
  assert.equal(t1.closePrice, 101);
  assert.equal(t1.profit, -300);
  assert.equal(t1.openTime, Date.UTC(2026, 8, 14, 10, 0, 0));
  assert.equal(t1.closeTime, Date.UTC(2026, 8, 14, 10, 30, 0));
  assert.equal(p.trades.find((t) => t.positionId === "3")!.volume, 2);
});
check("a clean report produces NO warnings (the blank row after Positions is not an error)", () => {
  const p = parseMt5HtmlReport(report(T3, { results: RESULTS_OK }));
  assert.ok(p.ok);
  if (p.ok) assert.deepEqual(p.warnings, []);
});
check("13-cell rows (no comment column) also parse", () => {
  const p = parseMt5HtmlReport(report(T3, { withTag: false }));
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.trades.length, 3);
    assert.equal(p.trades[0]!.tag, "");
    assert.equal(p.trades[0]!.profit, -300);
  }
});
check("commission and swap flow into net; stop/target 0 -> null", () => {
  const p = parseMt5HtmlReport(report([{ ...T3[0]!, commission: "-7.00", swap: "-1.50" }]));
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.trades[0]!.net, -308.5);
    assert.equal(p.trades[0]!.stopLoss, null);
    assert.equal(p.trades[0]!.takeProfit, null);
  }
});
check("malformed rows are skipped with a warning, not fatal", () => {
  const bad = ["2026.09.14 10:00:00", "9", "X", "sell", "T", "1", "100", "0", "0", "NOT A DATE", "101", "0", "0", "5"];
  const p = parseMt5HtmlReport(report(T3, { extraRow: bad }));
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.trades.length, 3);
    assert.ok(p.warnings.some((w) => /could not be read/.test(w)));
  }
});
check("rejects: not MT5, unsupported layout, no trades, too large", () => {
  const notReport = parseMt5HtmlReport("<html><table><tr><td>hello</td></tr></table></html>");
  assert.ok(!notReport.ok && notReport.error === "not_mt5_report");
  const wrongLayout = parseMt5HtmlReport(report(T3).replace("<th>Swap</th>", "<th>Zwap</th>"));
  assert.ok(!wrongLayout.ok && wrongLayout.error === "unsupported_layout");
  const empty = parseMt5HtmlReport(report([]));
  assert.ok(!empty.ok && empty.error === "no_trades");
  const huge = parseMt5HtmlReport(`<table>Trade History Report${"x".repeat(MAX_REPORT_CHARS)}`);
  assert.ok(!huge.ok && huge.error === "too_large");
});
check("meta: currency/mode/hedging read; NO account number, name, company or server anywhere", () => {
  const r = analyzeMt5ReportText(report(T3, { results: RESULTS_OK }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.report.meta.currency, "USD");
  assert.equal(r.report.meta.accountMode, "demo");
  assert.equal(r.report.meta.hedging, true);
  assert.equal(r.report.meta.initialDeposit, 1000);
  const json = JSON.stringify(r.report);
  for (const secret of ["123456789", "SECRET NAME", "Secret Brokers", "Secret-Server"]) assert.equal(json.includes(secret), false, secret);
});
check("hostile HTML (script/onerror) is inert text, never executed or kept as markup", () => {
  const evil = report([{ ...T3[0]!, tag: "<img src=x onerror=alert(1)>" }]);
  const r = analyzeMt5ReportText(evil);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.report.patterns.byTag.some((b) => /<|onerror/i.test(b.key) && b.key.includes("<")), false);
});

console.log("core stats");
check("balance curve uses CLOSE-time order (open-time order would give 26.67%, not 40%)", () => {
  const r = analyzeMt5ReportText(report(T3, { results: RESULTS_OK }));
  assert.ok(r.ok);
  if (!r.ok) return;
  const c = r.report.core;
  assert.equal(c.maxDrawdownAbs, 400);
  assert.equal(c.maxDrawdownPct, 40);
  assert.equal(c.absoluteDrawdown, 400);
  assert.equal(c.endBalance, 1100);
  assert.equal(c.netProfit, 100);
});
check("counts, profit factor, expectancy, payoff, streaks", () => {
  const r = analyzeMt5ReportText(report(T3));
  assert.ok(r.ok);
  if (!r.ok) return;
  const c = r.report.core;
  assert.deepEqual([c.tradeCount, c.wins, c.losses, c.breakeven], [3, 1, 2, 0]);
  assert.equal(c.grossProfit, 500);
  assert.equal(c.grossLoss, -400);
  assert.equal(c.profitFactor, 1.25);
  assert.equal(c.expectancy, 33.33);
  assert.equal(c.avgWin, 500);
  assert.equal(c.avgLoss, -200);
  assert.equal(c.payoffRatio, 2.5);
  assert.equal(c.maxConsecutiveLosses, 2);
  assert.equal(c.maxConsecutiveWins, 1);
  assert.equal(c.largestWin, 500);
  assert.equal(c.largestLoss, -300);
});
check("no losers -> profitFactor null (never Infinity); breakeven is not a win", () => {
  const c = computeCoreStats([ct({ closeTime: 1, profit: 10 }), ct({ closeTime: 2, profit: 0 })], 100);
  assert.equal(c.profitFactor, null);
  assert.equal(c.wins, 1);
  assert.equal(c.breakeven, 1);
  assert.equal(c.winRatePct, 50);
  assert.ok(Number.isFinite(c.expectancy));
});
check("deposits/withdrawals after the first are applied at their own time", () => {
  const c = computeCoreStats([ct({ closeTime: 10, profit: -50 })], 1000, [{ time: 1, amount: 1000 }, { time: 5, amount: 500 }]);
  assert.equal(c.endBalance, 1450);
});

console.log("reconciliation vs the terminal's own summary");
check("matching Results block -> every check ok and reconciled", () => {
  const r = analyzeMt5ReportText(report(T3, { results: RESULTS_OK }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.report.reconciliation.length >= 10);
  assert.equal(r.report.reconciled, true);
  assert.ok(r.report.reconciliation.every((c) => c.ok));
});
check("a wrong number in the terminal summary is flagged, with a user-facing warning", () => {
  const wrong = RESULTS_OK.map((row) => [...row]);
  wrong[0]![1] = "999.00";
  const r = analyzeMt5ReportText(report(T3, { results: wrong }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.report.reconciled, false);
  assert.ok(r.report.reconciliation.some((c) => !c.ok && c.check === "Total net profit"));
  assert.ok(r.report.warnings.some((w) => /do not match/.test(w)));
});
check("no Results block -> no checks, reconciled=false (not falsely 'verified')", () => {
  const r = analyzeMt5ReportText(report(T3));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.report.reconciliation, []);
    assert.equal(r.report.reconciled, false);
  }
});

console.log("patterns");
check("bucketBy: per-bucket count/net/winrate/expectancy; low-sample flagged", () => {
  const trades = [ct({ closeTime: 1, symbol: "A", profit: 10 }), ct({ closeTime: 2, symbol: "A", profit: -4 }), ct({ closeTime: 3, symbol: "B", profit: 7 })];
  const b = bucketBy(trades, (t) => t.symbol);
  const a = b.find((x) => x.key === "A")!;
  assert.deepEqual([a.count, a.net, a.winRatePct, a.expectancy], [2, 6, 50, 3]);
  assert.equal(a.lowSample, 2 < LOW_SAMPLE_THRESHOLD);
  assert.equal(b.find((x) => x.key === "B")!.lowSample, true);
});
check("sizeAfterOutcome: bigger lots after a loss show up as ratio > 1", () => {
  const T = (open: number, close: number, vol: number, profit: number) => ct({ openTime: open, closeTime: close, volume: vol, profit });
  const trades = [T(0, 10, 1, -5), T(11, 20, 3, 4), T(21, 30, 1, 6), T(31, 40, 1, -2), T(41, 50, 3, 1)];
  const s = sizeAfterOutcome(trades);
  assert.equal(s.countAfterLoss, 2);
  assert.equal(s.countAfterWin, 2); // T3 opens after T2 (win), T4 opens after T3 (win)
  assert.equal(s.avgVolumeAfterLoss, 3);
  assert.equal(s.avgVolumeAfterWin, 1);
  assert.equal(s.ratio, 3);
});
check("report patterns present for hour/weekday/symbol/direction/tag/hold", () => {
  const r = analyzeMt5ReportText(report(T3));
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = r.report.patterns;
  assert.deepEqual(p.bySymbol.map((b) => b.key).sort(), ["US30", "XAUUSD"]);
  assert.deepEqual(p.byDirection.map((b) => b.key).sort(), ["buy", "sell"]);
  assert.deepEqual(p.byTag.map((b) => b.key).sort(), ["Alpha", "Beta"]);
  assert.ok(p.byHour.length >= 1 && p.byWeekday.length >= 1 && p.byHoldTime.length >= 1);
});

console.log("buffer entry point");
check("UTF-16LE buffer round-trips through analyzeMt5ReportBuffer", () => {
  const r = analyzeMt5ReportBuffer(utf16le(report(T3, { results: RESULTS_OK })));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.report.reconciled, true);
});

const realPath = process.env.EDGE_REPORT_PATH;
if (realPath) {
  console.log(`real-file oracle (${realPath.split(/[\\/]/).pop()})`);
  check("REAL terminal report: every figure reconciles with MT5's own Results block", () => {
    const r = analyzeMt5ReportBuffer(readFileSync(realPath));
    assert.ok(r.ok, "real report must parse");
    if (!r.ok) return;
    for (const c of r.report.reconciliation) console.log(`      ${c.ok ? "match" : "MISMATCH"}  ${c.check}: reported ${c.reported}, computed ${c.computed}`);
    assert.ok(r.report.reconciliation.length >= 9, "expected the full set of checks");
    assert.equal(r.report.reconciled, true, "all checks must match the terminal summary");
    console.log(`      trades=${r.report.core.tradeCount} net=${r.report.core.netProfit} pf=${r.report.core.profitFactor} maxDD=${r.report.core.maxDrawdownPct}% warnings=${r.report.warnings.length}`);
  });
}

console.log(`\nvalidate-edge-analyzer: ${passed} checks passed`);
