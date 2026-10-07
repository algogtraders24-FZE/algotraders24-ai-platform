// services/edge-analyzer/index.ts
// AT24 Trader Edge Analyzer (E1) - the entry point: bytes in, typed report out.
// No DB, no network, no LLM. Includes E2: edge-evidence (significance) and the
// Monte-Carlo risk view, both seeded so the same file always gives the same report.

import { computeCoreStats, type CoreStats } from "./analysis/core";
import { computePatterns, type Patterns } from "./analysis/patterns";
import { computeEdgeEvidence, type EdgeEvidence } from "./analysis/edge-evidence";
import { computeRuinAnalysis, type RuinAnalysis } from "./analysis/ruin";
import { reconcile } from "./analysis/reconcile";
import { decodeReportBuffer, parseMt5HtmlReport } from "./parsers/mt5-html";
import type { BalanceOp, ClosedTrade, ParseErrorCode, ReconciliationCheck, ReportedResults, ReportMeta } from "./types";

export interface EdgeReportE1 {
  meta: ReportMeta;
  core: CoreStats;
  patterns: Patterns;
  /** Is the result distinguishable from luck? (evidence LEVEL, never "validated"). */
  edge: EdgeEvidence;
  /** Monte-Carlo risk view; null when there are too few trades. */
  ruin: RuinAnalysis | null;
  /** Our numbers vs the terminal's own Results block (empty if the report has none). */
  reconciliation: ReconciliationCheck[];
  /** True only if there is at least one check and every check passed. */
  reconciled: boolean;
  warnings: string[];
  /** Plain statements the report must show next to the numbers. */
  assumptions: string[];
}

export type AnalyzeResult = { ok: true; report: EdgeReportE1 } | { ok: false; error: ParseErrorCode; message: string };

export const REPORT_ASSUMPTIONS: readonly string[] = [
  "Closed positions only; floating (open) profit/loss is excluded.",
  "Times are the broker's server time, not UTC; hour/day breakdowns use that clock.",
  "Net per trade = profit + commission + swap. Win/loss classification follows the Profit column.",
  "Drawdown is measured on the closed-trade balance curve in close-time order, including deposits/withdrawals at their own time.",
  "Edge evidence is a statistical reading of your past trades under an independence assumption; it is a level of evidence, not proof, and never a validation of a strategy.",
  "Risk view resamples your own past results with fixed amounts (no compounding); it illustrates the spread of outcomes and is not a forecast.",
  "Descriptive only: past results do not predict future results and nothing here is investment advice.",
];

/** Everything the analysis needs, independent of where the trades came from (a report file or Live Sync). */
export interface TradesInput {
  meta: ReportMeta;
  trades: ClosedTrade[];
  balanceOps: BalanceOp[];
  /** The terminal's own printed summary, when there is one (report files); null for synced data. */
  reported: ReportedResults | null;
  warnings: string[];
}

/** The shared analysis pipeline: closed trades in, typed report out. Pure and deterministic. */
export function analyzeTrades(input: TradesInput): EdgeReportE1 {
  const warnings = [...input.warnings];
  let startBalance = input.meta.initialDeposit;
  if (startBalance === null) {
    startBalance = 0;
    warnings.push("No initial deposit was found, so drawdown percentages may be unreliable.");
  }
  const core = computeCoreStats(input.trades, startBalance, input.balanceOps);
  const reconciliation = reconcile(input.trades, core, input.reported);
  const reconciled = reconciliation.length > 0 && reconciliation.every((c) => c.ok);
  if (reconciliation.length > 0 && !reconciled) {
    warnings.push("Some numbers do not match the terminal's own summary in the report. Treat results with caution.");
  }
  return {
    meta: input.meta,
    core,
    patterns: computePatterns(input.trades),
    edge: computeEdgeEvidence(input.trades, { currency: input.meta.currency }),
    ruin: computeRuinAnalysis(input.trades, core.endBalance),
    reconciliation,
    reconciled,
    warnings,
    assumptions: [...REPORT_ASSUMPTIONS],
  };
}

export function analyzeMt5ReportText(text: string): AnalyzeResult {
  const parsed = parseMt5HtmlReport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, message: parsed.message };
  return {
    ok: true,
    report: analyzeTrades({ meta: parsed.meta, trades: parsed.trades, balanceOps: parsed.balanceOps, reported: parsed.reported, warnings: parsed.warnings }),
  };
}

export function analyzeMt5ReportBuffer(buf: Uint8Array): AnalyzeResult {
  return analyzeMt5ReportText(decodeReportBuffer(buf));
}
