// services/edge-analyzer/index.ts
// AT24 Trader Edge Analyzer (E1) - the entry point: bytes in, typed report out.
// No DB, no network, no LLM. Edge-evidence (significance) and risk-of-ruin are
// E2 and intentionally NOT here yet.

import { computeCoreStats, type CoreStats } from "./analysis/core";
import { computePatterns, type Patterns } from "./analysis/patterns";
import { reconcile } from "./analysis/reconcile";
import { decodeReportBuffer, parseMt5HtmlReport } from "./parsers/mt5-html";
import type { ParseErrorCode, ReconciliationCheck, ReportMeta } from "./types";

export interface EdgeReportE1 {
  meta: ReportMeta;
  core: CoreStats;
  patterns: Patterns;
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
  "Descriptive only: past results do not predict future results and nothing here is investment advice.",
];

export function analyzeMt5ReportText(text: string): AnalyzeResult {
  const parsed = parseMt5HtmlReport(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, message: parsed.message };
  const warnings = [...parsed.warnings];
  let startBalance = parsed.meta.initialDeposit;
  if (startBalance === null) {
    startBalance = 0;
    warnings.push("No initial deposit was found in the report, so drawdown percentages may be unreliable.");
  }
  const core = computeCoreStats(parsed.trades, startBalance, parsed.balanceOps);
  const reconciliation = reconcile(parsed.trades, core, parsed.reported);
  const reconciled = reconciliation.length > 0 && reconciliation.every((c) => c.ok);
  if (reconciliation.length > 0 && !reconciled) {
    warnings.push("Some numbers do not match the terminal's own summary in the report. Treat results with caution.");
  }
  return {
    ok: true,
    report: {
      meta: parsed.meta,
      core,
      patterns: computePatterns(parsed.trades),
      reconciliation,
      reconciled,
      warnings,
      assumptions: [...REPORT_ASSUMPTIONS],
    },
  };
}

export function analyzeMt5ReportBuffer(buf: Uint8Array): AnalyzeResult {
  return analyzeMt5ReportText(decodeReportBuffer(buf));
}
