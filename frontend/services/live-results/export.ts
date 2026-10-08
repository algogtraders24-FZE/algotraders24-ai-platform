// services/live-results/export.ts
// Downloadable reports for a Live Results page. Pure (plus the PDF drawing call).
//   - resultsCsv / resultsPdf: built ONLY from the already-redacted public view model, so whatever a visitor may
//     see on the page is all a visitor can download (percent-only unless the owner chose to show amounts).
//   - tradesCsv: the OWNER's own closed trades (with amounts); used only by the session-authenticated owner route.
// CSV cells that start with = + - @ (text only) are prefixed with an apostrophe so a spreadsheet never runs them
// as a formula; titles and strategy names are user-controlled text.

import type { PublicResults } from "./build";
import type { ClosedTrade } from "../edge-analyzer/types";
import type { Block } from "../edge-analyzer/pdf/report-blocks";
import { PDF_DISCLAIMER } from "../edge-analyzer/pdf/report-blocks";
import { renderBlocksPdf } from "../edge-analyzer/pdf/render";

export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: readonly Cell[]): string {
  return cells.map(csvCell).join(",");
}

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

export function resultsCsv(r: PublicResults, generatedOn: string): string {
  const s = r.stats, i = r.integrity;
  const out: string[] = [];
  const sec = (name: string, head: readonly Cell[], rows: readonly (readonly Cell[])[]) => {
    out.push("", csvRow([`# ${name}`]), csvRow(head), ...rows.map(csvRow));
  };
  out.push(csvRow(["# AT24 Live Results"]));
  out.push(csvRow(["title", r.title]), csvRow(["generated_on", generatedOn]), csvRow(["account_mode", r.mode]), csvRow(["margin_mode", r.marginMode]));
  out.push(csvRow(["source", "terminal-reported (not independently verified)"]));
  out.push(csvRow(["live_tracking_started_utc", iso(i.firstSyncAt)]), csvRow(["history_reported_from_broker_time", i.historyStart === null ? "" : iso(i.historyStart)]));
  out.push(csvRow(["last_update_utc", iso(i.lastSyncAt)]), csvRow(["reporting_now", !i.stale]), csvRow(["chain_batches", i.batches]), csvRow(["chain_head", i.chainHeadShort]));
  out.push(csvRow(["filtered_by_magic", i.filteredByMagic ?? ""]), csvRow(["account_magic_count", i.accountMagicCount]));

  sec("Summary", ["metric", "value"], [
    ["absolute_gain_pct", s.absoluteGainPct], ["time_weighted_gain_pct", s.timeWeightedGainPct], ["max_drawdown_pct", s.maxDrawdownPct],
    ["trades", s.trades], ["win_rate_pct", s.winRatePct], ["profit_factor", s.profitFactor], ["payoff_ratio", s.payoffRatio],
    ["max_consecutive_losses", s.maxConsecutiveLosses], ["avg_trade_length_minutes", s.avgTradeLengthMs === null ? null : Math.round(s.avgTradeLengthMs / 60000)],
    ["longs_won_pct", s.longsWonPct], ["shorts_won_pct", s.shortsWonPct], ["per_trade_sharpe", s.sharpePerTrade],
    ["runs_test_z", s.zScore], ["ahpr_pct", s.ahprPct], ["ghpr_pct", s.ghprPct],
    ["live_forward_trades", i.liveTracked.trades], ["live_forward_gain_pct", i.liveTracked.gainPct], ["live_forward_win_rate_pct", i.liveTracked.winRatePct],
    ["edge_evidence_level", r.edge ? r.edge.level : ""],
  ]);
  const withProfit = s.daily.profit !== undefined;
  sec("Periods", ["period", "gain_pct", "trades", "win_rate_pct", ...(withProfit ? ["profit"] : [])], (
    [["today", s.daily], ["this_week", s.weekly], ["this_month", s.monthly], ["this_year", s.yearly]] as const
  ).map(([n, p]) => [n, p.gainPct, p.trades, p.winRatePct, ...(withProfit ? [p.profit] : [])]));
  sec("Monthly", ["month", "gain_pct", "trades", "win_rate_pct", ...(withProfit ? ["profit"] : [])], s.monthlyHistory.map((m) => [m.month, m.gainPct, m.trades, m.winRatePct, ...(withProfit ? [m.profit] : [])]));
  sec("Daily (broker days, last 120)", ["date", "gain_pct", "trades", "win_rate_pct", ...(withProfit ? ["profit"] : [])], s.dailyHistory.map((d) => [d.date, d.gainPct, d.trades, d.winRatePct, ...(withProfit ? [d.profit] : [])]));
  const withNet = r.strategies[0]?.net !== undefined;
  sec("Strategies", ["strategy", "trades", "win_rate_pct", "profit_factor", "share_of_trades_pct", ...(withNet ? ["net"] : [])], r.strategies.map((x) => [x.name, x.trades, x.winRatePct, x.profitFactor, x.sharePct, ...(withNet ? [x.net] : [])]));
  const symNet = s.bySymbol[0]?.net !== undefined;
  sec("By symbol", ["symbol", "trades", "won_pct", "longs", "shorts", ...(symNet ? ["net"] : [])], s.bySymbol.map((x) => [x.symbol, x.trades, x.wonPct, x.longs, x.shorts, ...(symNet ? [x.net] : [])]));
  sec("Hourly entries (broker time)", ["hour", "winners", "losers"], r.advanced.hourly.map((h) => [h.hour, h.wins, h.losses]));
  const wdNet = r.advanced.weekday[0]?.net !== undefined;
  sec("Weekday entries (broker time)", ["day", "trades", "win_rate_pct", ...(wdNet ? ["net"] : [])], r.advanced.weekday.map((d) => [d.day, d.trades, d.winRatePct, ...(wdNet ? [d.net] : [])]));
  if (r.advanced.ruin) {
    sec(`Risk of ruin (next ${r.advanced.ruin.horizonTrades} trades, seeded resampling; longest losing streak ${r.advanced.ruin.longestLosingStreak})`, ["loss_size_pct", "chance_trades_independent", "chance_streaks_kept", "average_losses_in_a_row"], r.advanced.ruin.rows.map((x) => [x.lossPct, x.probIndependent, x.probStreak, x.consecutiveAvgLosses]));
  }
  sec("Growth (percent since the first event; time is broker time)", ["time_broker", "growth_pct", "event"], s.growth.map((g) => [iso(g.t), g.growthPct, g.flow ?? ""]));
  if (r.amounts) {
    const a = r.amounts;
    sec(`Money (${r.currency}; shown because the page owner chose to show amounts)`, ["metric", "value"], [
      ["initial_deposit", a.initialDeposit], ["balance", a.balance], ["deposits", a.deposits], ["withdrawals", a.withdrawals], ["profit", a.profit], ["highest_balance", a.highestBalance],
      ["best_trade", a.bestTrade], ["worst_trade", a.worstTrade], ["std_dev", a.stdDev], ["expectancy", a.expectancy], ["avg_win", a.avgWin], ["avg_loss", a.avgLoss],
      ["commissions", a.commissions], ["swap", a.swap], ["lots", a.lots],
    ]);
  }
  if (r.amounts && r.amounts.cashflows.length > 0) {
    sec(`Deposits and withdrawals (${r.currency}; broker time)`, ["time_broker", "type", "amount"], r.amounts.cashflows.map((c, idx) => [iso(c.time), c.amount >= 0 ? (idx === 0 ? "initial_deposit" : "deposit") : "withdrawal", c.amount]));
  }
  sec("Disclosure", ["note"], r.disclosure.map((d) => [d]));
  return "﻿" + out.join("\r\n") + "\r\n";
}

export function tradesCsv(trades: readonly ClosedTrade[]): string {
  const head = ["position_id", "symbol", "direction", "volume", "open_time_broker", "close_time_broker", "open_price", "close_price", "profit", "commission", "swap", "net", "comment"];
  const rows = [...trades].sort((a, b) => a.closeTime - b.closeTime).map((t) => [t.positionId, t.symbol, t.direction, t.volume, iso(t.openTime), iso(t.closeTime), t.openPrice, t.closePrice, t.profit, t.commission, t.swap, t.net, t.tag]);
  return "﻿" + [csvRow(head), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const num = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "-" : n.toFixed(d));
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function resultsPdfBlocks(r: PublicResults, generatedOn: string): Block[] {
  const s = r.stats, i = r.integrity, lt = i.liveTracked;
  const b: Block[] = [];
  b.push({ t: "title", text: `${r.title} - Live Results`, sub: `${r.mode.toUpperCase()} account  |  terminal-reported, not independently verified  |  generated ${generatedOn}` });
  const pre = i.historyStart !== null ? Math.round((i.firstSyncAt - i.historyStart) / 86_400_000) : 0;
  b.push({
    t: "p",
    text: `Live tracking started ${day(i.firstSyncAt)}. ${pre > 0 ? `The ${pre} days before it (from ${day(i.historyStart as number)}) were reported by the terminal when it first connected. ` : ""}${lt.trades > 0 ? `Since live tracking started: ${lt.trades} closed trades, gain ${pct(lt.gainPct)}.` : "No trade has closed since live tracking started."}`,
  });
  if (i.filteredByMagic !== null) b.push({ t: "p", muted: true, text: `Showing one Expert Advisor (magic ${i.filteredByMagic}); the account has ${i.accountMagicCount} magic number(s).` });
  b.push({ t: "h2", text: "Summary" });
  b.push({
    t: "table", head: ["Metric", "Value"], align: ["l", "r"], widths: [0.6, 0.4], signColumns: [1],
    rows: [
      ["Absolute gain", pct(s.absoluteGainPct)], ["Time-weighted gain", pct(s.timeWeightedGainPct)], ["Max drawdown", `${num(s.maxDrawdownPct)}%`],
      ["Trades", String(s.trades)], ["Win rate", `${num(s.winRatePct)}%`], ["Profit factor", num(s.profitFactor)], ["Payoff ratio", num(s.payoffRatio)],
      ["Max consecutive losses", String(s.maxConsecutiveLosses)], ["Longs / shorts won", `${num(s.longsWonPct)}% / ${num(s.shortsWonPct)}%`],
      ["Skill or luck", r.edge ? `${r.edge.level} evidence of edge` : "not enough trades"],
    ],
  });
  b.push({ t: "h2", text: "Periods" });
  b.push({ t: "table", head: ["Period", "Gain", "Trades", "Win %"], align: ["l", "r", "r", "r"], widths: [0.34, 0.22, 0.2, 0.24], signColumns: [1], rows: ([["Today", s.daily], ["This week", s.weekly], ["This month", s.monthly], ["This year", s.yearly]] as const).map(([n, p]) => [n, pct(p.gainPct), String(p.trades), p.winRatePct === null ? "-" : `${num(p.winRatePct)}%`]) });
  if (s.monthlyHistory.length > 0) {
    b.push({ t: "h2", text: "Monthly gain" });
    b.push({ t: "table", head: ["Month", "Gain", "Trades", "Win %"], align: ["l", "r", "r", "r"], widths: [0.34, 0.22, 0.2, 0.24], signColumns: [1], rows: s.monthlyHistory.map((m) => [m.month, pct(m.gainPct), String(m.trades), m.winRatePct === null ? "-" : `${num(m.winRatePct)}%`]) });
  }
  if (r.strategies.length > 0) {
    b.push({ t: "h2", text: `Strategies inside ${r.title}` });
    b.push({ t: "table", head: ["Strategy", "Trades", "Win %", "Profit factor"], align: ["l", "r", "r", "r"], widths: [0.4, 0.18, 0.2, 0.22], rows: r.strategies.map((x) => [x.name, String(x.trades), `${num(x.winRatePct)}%`, num(x.profitFactor)]) });
  }
  if (r.advanced.ruin) {
    b.push({ t: "h2", text: "Risk of ruin" });
    b.push({ t: "table", head: ["Loss size", "Chance (independent)", "Chance (streaks kept)", "Avg losses in a row"], align: ["l", "r", "r", "r"], widths: [0.25, 0.25, 0.25, 0.25], rows: r.advanced.ruin.rows.map((x) => [`${x.lossPct}%`, `${(x.probIndependent * 100).toFixed(1)}%`, `${(x.probStreak * 100).toFixed(1)}%`, x.consecutiveAvgLosses === null ? "-" : String(x.consecutiveAvgLosses)]) });
    b.push({ t: "p", muted: true, text: `Chance that the account falls this far from a peak at some point in the next ${r.advanced.ruin.horizonTrades} trades, from a seeded resampling of this page's own results. "Streaks kept" is the more cautious reading. An illustration of risk, not a forecast. Longest losing streak so far: ${r.advanced.ruin.longestLosingStreak}.` });
  }
  if (r.amounts) {
    const a = r.amounts, cur = r.currency;
    const m = (n: number | null) => (n === null ? "-" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`);
    b.push({ t: "h2", text: "Money (shown by the page owner)" });
    b.push({ t: "table", head: ["Metric", "Value"], align: ["l", "r"], widths: [0.6, 0.4], rows: [["Initial deposit", m(a.initialDeposit)], ["Profit", m(a.profit)], ["Balance", m(a.balance)], ["Deposits", m(a.deposits)], ["Withdrawals", m(a.withdrawals)], ["Best trade", m(a.bestTrade)], ["Worst trade", m(a.worstTrade)]] });
    if (a.cashflows.length > 0) {
      b.push({ t: "h2", text: "Deposits and withdrawals" });
      b.push({ t: "table", head: ["Date", "Type", "Amount"], align: ["l", "l", "r"], widths: [0.3, 0.3, 0.4], rows: a.cashflows.map((c, idx) => [day(c.time), c.amount >= 0 ? (idx === 0 ? "Initial deposit" : "Deposit") : "Withdrawal", m(c.amount)]) });
    }
  }
  b.push({ t: "h2", text: "Notes" });
  b.push({ t: "bullets", muted: true, items: r.disclosure });
  return b;
}

export async function renderResultsPdf(r: PublicResults, generatedAt: Date = new Date()): Promise<Uint8Array> {
  return renderBlocksPdf(resultsPdfBlocks(r, generatedAt.toISOString().slice(0, 10)), {
    title: `${r.title} - AT24 Live Results`,
    producer: "AT24 Live Results",
    footerLabel: `AT24 Live Results  |  ${PDF_DISCLAIMER}`,
    generatedAt,
  });
}
