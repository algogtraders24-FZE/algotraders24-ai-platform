// services/edge-analyzer/pdf/report-blocks.ts
// AT24 Trader Edge Analyzer - the CONTENT of the downloadable PDF as plain data
// blocks. Pure and renderer-independent (the renderer draws these), so what the
// PDF says is unit-tested without touching a PDF library.
//
// Privacy: the document never includes the uploaded file name (it often carries
// the account number), the account number, holder name, company or server - the
// report object itself never contains them. Only the FULL report can be turned
// into a PDF (it is a paid-plan feature and only full reports carry the data).

import type { EdgeReportE1 } from "../index";
import type { BucketStat } from "../analysis/patterns";
import type { EdgeLevel } from "../analysis/edge-evidence";

export type Block =
  | { t: "title"; text: string; sub?: string }
  | { t: "h2"; text: string }
  | { t: "p"; text: string; muted?: boolean }
  | { t: "bullets"; items: string[]; muted?: boolean }
  | { t: "table"; head: string[]; rows: string[][]; align: ("l" | "r")[]; widths: number[]; signColumns?: number[] }
  | { t: "spacer"; h: number };

export const LEVEL_LABEL: Record<EdgeLevel, string> = {
  insufficient: "Not enough data",
  negative: "Negative evidence",
  none: "No evidence of edge",
  weak: "Weak evidence",
  moderate: "Moderate evidence",
  strong: "Strong evidence",
};

export const PDF_DISCLAIMER = "Informational analysis only. Not investment advice. Past results do not predict future results.";

export function money(n: number | null | undefined, cur: string | null): string {
  if (n === null || n === undefined) return "-";
  const s = `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return cur ? `${s} ${cur}` : s;
}
const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "-" : `${n.toFixed(d)}%`);
const prob = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
function minutes(ms: number | null): string {
  if (ms === null) return "-";
  const m = ms / 60000;
  return m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(0)} min`;
}
/** Bucket keys carry a sort prefix ("3 Wed", "2 1-5 min"); keep only the label. */
const label = (k: string) => k.replace(/^\d\s/, "");

function bucketTable(rows: BucketStat[], cur: string | null, sortByNet: boolean): Block {
  const list = sortByNet ? [...rows].sort((a, b) => b.net - a.net) : rows;
  return {
    t: "table",
    head: ["Group", "Trades", "Win rate", "Net result", "Avg / trade"],
    rows: list.map((r) => [`${label(r.key)}${r.lowSample ? " *" : ""}`, String(r.count), pct(r.winRatePct, 0), money(r.net, cur), money(r.expectancy, cur)]),
    align: ["l", "r", "r", "r", "r"],
    widths: [3, 1.2, 1.4, 2.2, 2.2],
    signColumns: [3, 4],
  };
}

/** @param generatedOn a display date string supplied by the caller (keeps this pure/deterministic). */
export function buildReportBlocks(report: EdgeReportE1, opts: { generatedOn: string }): Block[] {
  const cur = report.meta.currency;
  const c = report.core;
  const e = report.edge;
  const b: Block[] = [];

  const subParts = [`Generated ${opts.generatedOn}`, "MetaTrader 5 trade history"];
  if (report.meta.accountMode) subParts.push(`${report.meta.accountMode} account`);
  if (cur) subParts.push(cur);
  b.push({ t: "title", text: "Edge Analyzer Report", sub: subParts.join("  |  ") });

  b.push({ t: "h2", text: "Verdict" });
  b.push({ t: "p", text: LEVEL_LABEL[e.level] });
  b.push({ t: "p", text: e.headline });
  if (report.reconciliation.length > 0) {
    const ok = report.reconciliation.filter((x) => x.ok).length;
    b.push({
      t: "p",
      muted: true,
      text: report.reconciled
        ? `Matches the terminal's own summary (${ok}/${report.reconciliation.length} checks).`
        : `Does not fully match the terminal's own summary (${ok}/${report.reconciliation.length} checks passed). Treat results with caution.`,
    });
  }
  if (e.caveats.length > 0) b.push({ t: "bullets", items: e.caveats, muted: true });
  if (report.warnings.length > 0) b.push({ t: "bullets", items: report.warnings, muted: true });

  b.push({ t: "h2", text: "Key numbers" });
  const kv: [string, string][] = [
    ["Net profit", money(c.netProfit, cur)],
    ["Closed trades", String(c.tradeCount)],
    ["Win rate", pct(c.winRatePct)],
    ["Profit factor", c.profitFactor === null ? "-" : c.profitFactor.toFixed(2)],
    ["Average result / trade", money(c.expectancy, cur)],
    ["Payoff ratio", c.payoffRatio === null ? "-" : c.payoffRatio.toFixed(2)],
    ["Max drawdown", `${pct(c.maxDrawdownPct)} (${money(c.maxDrawdownAbs, cur)})`],
    ["Longest losing streak", String(c.maxConsecutiveLosses)],
    ["Start balance", money(c.startBalance, cur)],
    ["End balance", money(c.endBalance, cur)],
  ];
  const kvRows: string[][] = [];
  for (let i = 0; i < kv.length; i += 2) kvRows.push([kv[i]![0], kv[i]![1], kv[i + 1]?.[0] ?? "", kv[i + 1]?.[1] ?? ""]);
  b.push({ t: "table", head: ["Metric", "Value", "Metric", "Value"], rows: kvRows, align: ["l", "r", "l", "r"], widths: [2.4, 2, 2.4, 2] });

  b.push({ t: "h2", text: "Is it skill or luck?" });
  const luck = [
    `Average result per trade: ${money(e.mean, cur)}, 95% range ${money(e.ci95[0], cur)} to ${money(e.ci95[1], cur)}.`,
    `Chance of a result this far from zero by luck alone (p-value): ${e.pValue}.`,
    `Trades needed to tell this average from zero at the current variance: ${e.tradesNeeded ?? "n/a"} (you have ${e.n}).`,
    `Trades overlapping in time: ${pct(e.overlapPct)}; lag-1 autocorrelation: ${e.lag1Autocorrelation ?? "-"}.`,
  ];
  if (e.perLot) {
    luck.push(`Result per lot (position-size check): ${LEVEL_LABEL[e.perLot.level]} (average ${money(e.perLot.mean, cur)}, range ${money(e.perLot.ci95[0], cur)} to ${money(e.perLot.ci95[1], cur)}).`);
  }
  b.push({ t: "bullets", items: luck });
  b.push({ t: "p", muted: true, text: "A level of evidence from past trades, not proof and not a validation of any strategy." });

  if (report.ruin && report.ruin.scenarios.length > 0) {
    const h = report.ruin.scenarios[0]!.horizonTrades;
    b.push({ t: "h2", text: `What could the next ${h} trades look like?` });
    b.push({
      t: "table",
      head: ["Scenario", "DD >= 20%", "DD >= 30%", "DD >= 50%", "Ends below start", "Balance 5% / median / 95%"],
      rows: report.ruin.scenarios.map((s) => [
        s.name === "independent" ? "Trades independent" : "Keeps streaks",
        ...s.probDrawdownReaches.map((p) => prob(p.probability)),
        prob(s.probFinishBelowStart),
        `${money(s.finalBalancePercentiles.p5, null)} / ${money(s.finalBalancePercentiles.p50, null)} / ${money(s.finalBalancePercentiles.p95, null)}`,
      ]),
      align: ["l", "r", "r", "r", "r", "r"],
      widths: [2.2, 1.2, 1.2, 1.2, 2.1, 3.4],
    });
    b.push({ t: "p", muted: true, text: "Your own past trades were resampled thousands of times. The streak scenario is the more cautious reading. This illustrates risk; it is not a forecast." });
    b.push({ t: "bullets", items: report.ruin.assumptions, muted: true });
  }

  const p = report.patterns;
  if (p.byTag.length > 1) {
    b.push({ t: "h2", text: "By strategy / EA tag (trade comment)" });
    b.push(bucketTable(p.byTag, cur, true));
  }
  b.push({ t: "h2", text: "By symbol" });
  b.push(bucketTable(p.bySymbol, cur, true));
  b.push({ t: "h2", text: "By direction" });
  b.push(bucketTable(p.byDirection, cur, false));
  b.push({ t: "h2", text: "By day of week (broker time)" });
  b.push(bucketTable(p.byWeekday, cur, false));
  b.push({ t: "h2", text: "By hour of day (broker time)" });
  b.push(bucketTable(p.byHour, cur, false));
  b.push({ t: "h2", text: "By how long trades were held" });
  b.push(bucketTable(p.byHoldTime, cur, false));
  b.push({ t: "p", muted: true, text: "* few trades: too small a group to read into." });

  b.push({ t: "h2", text: "Habits worth a closer look" });
  const habits: string[] = [];
  const s = p.sizeAfterOutcome;
  if (s.ratio !== null) {
    habits.push(
      `Average lot size after a loss: ${s.avgVolumeAfterLoss} vs after a win: ${s.avgVolumeAfterWin} (x${s.ratio}). ` +
        (s.ratio >= 1.2 ? "Position size tends to increase after losses." : s.ratio <= 0.83 ? "Position size tends to decrease after losses." : "Sizing is similar after wins and losses."),
    );
  }
  habits.push(`Average time held: winners ${minutes(c.avgHoldMsWinners)}, losers ${minutes(c.avgHoldMsLosers)}.`);
  habits.push(`Longest run: ${c.maxConsecutiveWins} wins in a row, ${c.maxConsecutiveLosses} losses in a row.`);
  b.push({ t: "bullets", items: habits });
  b.push({ t: "p", muted: true, text: "Observations to investigate, not instructions." });

  b.push({ t: "h2", text: "How to read this report" });
  b.push({ t: "bullets", items: report.assumptions, muted: true });
  b.push({ t: "p", muted: true, text: `${PDF_DISCLAIMER} MetaTrader is a trademark of MetaQuotes Ltd.; AT24 is not affiliated with MetaQuotes.` });
  return b;
}
