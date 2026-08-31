/**
 * Q1.1.4/5/6/7/8/21/41 - the coverage policy engine. Server-only (imports
 * the full generated gap registry, ~2.9MB of real gap intervals - never
 * import this module, or data/quant-lite-gap-registry.ts directly, from
 * a "use client" component; the client only ever sees the small
 * CoverageAssessment this returns via the coverage API route, never the
 * raw registry - this is what makes coverage status genuinely
 * server-authoritative (Q1.1.41), not just a convention).
 *
 * assessCoverage() is the single function that turns a real gap registry
 * entry plus a specific requested date range into the four-way
 * SUPPORTED / SUPPORTED_WITH_WARNING / RESTRICTED / DATA_UNAVAILABLE
 * policy outcome (Q1.1.6) - full threshold rationale in
 * quant-engine/reports/Q1.1_GAP_POLICY.md.
 */
import { DATA_COVERAGE_REGISTRY, GAP_REGISTRY_AUDIT_RULE_VERSION, GAP_REGISTRY_VERSION } from "@/data/quant-lite-gap-registry";
import { classifyPerformance } from "./performanceClassification";
import type { CoverageAssessment, ContiguousCoverage, DataQualityGrade, DateRangePolicy } from "@/types/quant-lite-coverage";

const SEVERITY_RANK: Record<DataQualityGrade, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

// Q1.1.6/Q1.1_GAP_POLICY.md "Threshold Rationale" - fixed before any
// per-symbol result was inspected against them.
const SUPPORTED_MIN_COVERAGE = 98.0;
const SUPPORTED_MAX_GAP_DAYS = 3.0;
const WARNING_MIN_COVERAGE = 80.0;
const WARNING_MAX_GAP_DAYS = 14.0;
const RESTRICTED_MIN_COVERAGE = 40.0;
// Below RESTRICTED_MIN_COVERAGE, or zero overlap -> DATA_UNAVAILABLE.

// Q1.1.5 - a single gap covering more than this fraction of the
// requested range makes the period FRAGMENTED regardless of overall %.
const DOMINATING_GAP_FRACTION = 0.2;
const DOMINATING_GAP_ABS_DAYS = 30;

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

function overlapDays(gapStart: Date, gapEnd: Date, reqStart: Date, reqEnd: Date): number {
  const start = Math.max(gapStart.getTime(), reqStart.getTime());
  const end = Math.min(gapEnd.getTime(), reqEnd.getTime());
  return end > start ? (end - start) / 86_400_000 : 0;
}

export function assessCoverage(symbol: string, timeframe: string, start: string, end: string): CoverageAssessment {
  const reqStart = new Date(start);
  const reqEnd = new Date(end);
  const requestedDurationDays = Math.round(daysBetween(reqStart, reqEnd) * 100) / 100;

  const entry = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === symbol && e.timeframe === timeframe);
  const { performanceClass, performanceWarning } = classifyPerformance(timeframe, requestedDurationDays);
  const base = {
    symbol,
    timeframe,
    requested: { start, end },
    requestedDurationDays,
    registryVersion: GAP_REGISTRY_VERSION,
    auditRuleVersion: GAP_REGISTRY_AUDIT_RULE_VERSION,
    performanceClass,
    performanceWarning,
  };

  if (!entry) {
    return {
      ...base,
      actual: { start, end },
      coveredDurationDays: 0,
      missingDurationDays: requestedDurationDays,
      coveragePct: 0,
      largestGapDays: requestedDurationDays,
      gapCountInRange: 0,
      contiguousCoverage: "NO_OVERLAP",
      policy: "DATA_UNAVAILABLE",
      worstSeverity: "CRITICAL",
      message: `'${symbol}' / '${timeframe}' is not a verified real-execution combination.`,
    };
  }

  const minTs = new Date(entry.minTs);
  const maxTs = new Date(entry.maxTs);
  const actualStart = new Date(Math.max(reqStart.getTime(), minTs.getTime()));
  const actualEnd = new Date(Math.min(reqEnd.getTime(), maxTs.getTime()));

  if (actualEnd <= actualStart) {
    return {
      ...base,
      actual: { start, end },
      coveredDurationDays: 0,
      missingDurationDays: requestedDurationDays,
      coveragePct: 0,
      largestGapDays: requestedDurationDays,
      gapCountInRange: 0,
      contiguousCoverage: "NO_OVERLAP",
      policy: "DATA_UNAVAILABLE",
      worstSeverity: "CRITICAL",
      message: `Requested range ${start} to ${end} does not overlap this symbol's recorded data (${entry.minTs.slice(0, 10)} to ${entry.maxTs.slice(0, 10)}).`,
    };
  }

  const missing = entry.gaps.reduce((sum, g) => sum + overlapDays(new Date(g.start), new Date(g.end), actualStart, actualEnd), 0);
  const actualRangeDays = daysBetween(actualStart, actualEnd);
  const coveredDurationDays = Math.max(actualRangeDays - missing, 0);
  const coveragePct = actualRangeDays > 0 ? Math.round((coveredDurationDays / actualRangeDays) * 10000) / 100 : 0;

  const relevantGaps = entry.gaps.filter((g) => overlapDays(new Date(g.start), new Date(g.end), actualStart, actualEnd) > 0);
  const largestGapDays = relevantGaps.length ? Math.max(...relevantGaps.map((g) => overlapDays(new Date(g.start), new Date(g.end), actualStart, actualEnd))) : 0;
  const worstSeverity = relevantGaps.reduce<DataQualityGrade>((worst, g) => (SEVERITY_RANK[g.severity] > SEVERITY_RANK[worst] ? g.severity : worst), "NONE");

  let contiguousCoverage: ContiguousCoverage;
  if (coveragePct <= 0) {
    contiguousCoverage = "NO_OVERLAP";
  } else if (coveragePct >= SUPPORTED_MIN_COVERAGE && largestGapDays <= SUPPORTED_MAX_GAP_DAYS) {
    contiguousCoverage = "FULL_CONTIGUOUS";
  } else if (largestGapDays > DOMINATING_GAP_ABS_DAYS || largestGapDays > requestedDurationDays * DOMINATING_GAP_FRACTION) {
    contiguousCoverage = "FRAGMENTED";
  } else {
    contiguousCoverage = "PARTIAL_CONTIGUOUS";
  }

  let policy: DateRangePolicy;
  let message: string;
  if (coveragePct < RESTRICTED_MIN_COVERAGE || contiguousCoverage === "NO_OVERLAP") {
    policy = "DATA_UNAVAILABLE";
    message = `Only ${coveragePct}% of the requested period has real data (largest gap: ${largestGapDays.toFixed(1)} days) - too fragmented for a meaningful backtest.`;
  } else if (contiguousCoverage === "FRAGMENTED" || coveragePct < WARNING_MIN_COVERAGE || largestGapDays > WARNING_MAX_GAP_DAYS) {
    policy = "RESTRICTED";
    message = `This period is only ${coveragePct}% covered with a dominating gap of ${largestGapDays.toFixed(1)} days - the result will not represent continuous market conditions. Proceed only if you understand this limitation.`;
  } else if (contiguousCoverage === "FULL_CONTIGUOUS" && coveragePct >= SUPPORTED_MIN_COVERAGE) {
    policy = "SUPPORTED";
    message = `${coveragePct}% of the requested period has real, continuous data.`;
  } else {
    policy = "SUPPORTED_WITH_WARNING";
    message = `Historical data contains gaps (${coveragePct}% covered, largest gap ${largestGapDays.toFixed(1)} days). Results may not represent continuous market conditions.`;
  }

  return {
    ...base,
    actual: { start: actualStart.toISOString().slice(0, 10), end: actualEnd.toISOString().slice(0, 10) },
    coveredDurationDays: Math.round(coveredDurationDays * 100) / 100,
    missingDurationDays: Math.round(missing * 100) / 100,
    coveragePct,
    largestGapDays: Math.round(largestGapDays * 100) / 100,
    gapCountInRange: relevantGaps.length,
    contiguousCoverage,
    policy,
    worstSeverity,
    message,
  };
}
