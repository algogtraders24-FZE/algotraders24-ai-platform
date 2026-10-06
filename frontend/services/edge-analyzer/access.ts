// services/edge-analyzer/access.ts
// AT24 Trader Edge Analyzer - plan gating, enforced on the SERVER.
//
//   free : the summary - verdict level + headline, key numbers, terminal
//          reconciliation, and 3 breakdowns (EA tag, symbol, weekday).
//   full : everything - skill-vs-luck details (95% range, p-value, trades
//          needed, dependence, per-lot), risk scenarios, hour / hold-time
//          breakdowns, direction, habits.
//
// "Paid" means an active paid subscription (the same rule every Quant Pro
// route uses). Locked data is REMOVED from the response, not merely hidden by
// the UI, so it cannot be read from the network tab.

import type { EdgeReportE1 } from "./index";
import type { EdgeEvidence } from "./analysis/edge-evidence";
import type { Patterns } from "./analysis/patterns";

export type EdgeAccess = "free" | "full";

export type LockedSection =
  | "Skill-vs-luck details"
  | "Risk scenarios"
  | "Hour and hold-time breakdowns"
  | "Direction breakdown"
  | "Habits worth a closer look"
  | "PDF download";

export const FREE_LOCKED_SECTIONS: readonly LockedSection[] = [
  "Skill-vs-luck details",
  "Risk scenarios",
  "Hour and hold-time breakdowns",
  "Direction breakdown",
  "Habits worth a closer look",
  "PDF download",
];

export interface FreeEdgeReport {
  meta: EdgeReportE1["meta"];
  core: EdgeReportE1["core"];
  edge: Pick<EdgeEvidence, "level" | "headline" | "n" | "caveats">;
  patterns: Pick<Patterns, "byTag" | "bySymbol" | "byWeekday">;
  reconciliation: EdgeReportE1["reconciliation"];
  reconciled: boolean;
  warnings: string[];
  assumptions: string[];
}

export type EdgeAccessResponse =
  | { access: "full"; report: EdgeReportE1 }
  | { access: "free"; report: FreeEdgeReport; locked: LockedSection[] };

/** The analyze endpoint's full response: the access-gated report plus the outcome of an opt-in save. */
export type EdgeAnalyzeResponse = EdgeAccessResponse & {
  /** Present when the user asked to save and it succeeded. */
  saved?: { id: string; createdAt: string };
  /** Present when the user asked to save and it did not happen; says why in plain words. */
  saveNote?: string;
};

/** Build the response for the caller's entitlement. Anything but `true` is free (fail closed). */
export function toAccessResponse(report: EdgeReportE1, hasFullAccess: boolean): EdgeAccessResponse {
  if (hasFullAccess === true) return { access: "full", report };
  return {
    access: "free",
    locked: [...FREE_LOCKED_SECTIONS],
    report: {
      meta: report.meta,
      core: report.core,
      edge: { level: report.edge.level, headline: report.edge.headline, n: report.edge.n, caveats: report.edge.caveats },
      patterns: { byTag: report.patterns.byTag, bySymbol: report.patterns.bySymbol, byWeekday: report.patterns.byWeekday },
      reconciliation: report.reconciliation,
      reconciled: report.reconciled,
      warnings: report.warnings,
      assumptions: report.assumptions,
    },
  };
}
