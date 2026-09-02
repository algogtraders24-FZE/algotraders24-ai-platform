/**
 * Q1.1.1/2/3/5/6 - the canonical data-quality/coverage contract. Built
 * from the real gap registry (quant-engine/scripts/q11_gap_registry.py,
 * data/quant-lite-gap-registry.ts) - nothing here is invented; every
 * field is either read from that registry or computed deterministically
 * from it at request time (services/quant-lite/backend/coveragePolicy.ts).
 * Full rationale: quant-engine/reports/Q1.1_DATA_QUALITY_CONTRACT.md.
 */

/** Q1.1.2 - not all missing data is the same. */
export type GapType =
  | "EXPECTED_MARKET_CLOSURE" // a normal weekly/holiday-adjacent closure - not a real gap, excluded from "missing" time
  | "EXPECTED_SESSION_BREAK" // Q1.2 - a short (1-4h) daily rollover gap, evidenced empirically per symbol - not a real gap, excluded from "missing" time
  | "NO_DATA" // a large, unexplained span with zero rows
  | "TEMPORAL_GAP" // an isolated, moderate unexplained span (up to 14 days)
  | "LOW_FREQUENCY_SEGMENT" // rows exist but density collapsed far below expected (a run of near-weekly-only bars)
  | "PARTIAL_DATA" // a small (<3 day), irregular, non-closure-shaped gap
  | "OUTSIDE_COVERAGE"; // the requested date falls entirely outside this symbol/timeframe's recorded range

/** Q1.1.3 - deterministic, fixed before any per-symbol result was reverse-engineered to fit. */
export type DataQualityGrade = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface GapInterval {
  symbol: string;
  timeframe: string;
  start: string;
  end: string;
  durationDays: number;
  gapType: GapType;
  severity: DataQualityGrade;
}

/** Q1.1.5 - never conflate "90% coverage, evenly spread" with "90% coverage, one huge central hole". */
export type ContiguousCoverage = "FULL_CONTIGUOUS" | "PARTIAL_CONTIGUOUS" | "FRAGMENTED" | "NO_OVERLAP";

/** Q1.1.6 - the only four outcomes a coverage check may return. */
export type DateRangePolicy = "SUPPORTED" | "SUPPORTED_WITH_WARNING" | "RESTRICTED" | "DATA_UNAVAILABLE";

/** Q1.2.25 (Q1.1's own scale, reused) - defined from Q1.1's measured benchmark, not guessed. */
export type PerformanceClass = "FAST" | "NORMAL" | "SLOW" | "LIMITED";

/** Per-symbol/timeframe registry entry (Q1.1.1 DataCoverage). */
export interface DataCoverage {
  symbol: string;
  timeframe: string;
  sessionModel: "CONTINUOUS" | "WEEKLY_CLOSURE";
  minTs: string;
  maxTs: string;
  rows: number;
  /** Coverage over the FULL recorded range - see CoverageAssessment for a specific request's coverage. */
  coveragePct: number;
  gapCount: number;
  largestGapDays: number;
  /** Q1.2 - count/total-duration of real EXPECTED_SESSION_BREAK gaps excluded from coveragePct, shown for transparency (not itself a "problem" figure). */
  sessionBreakCount: number;
  sessionBreakDays: number;
  gaps: GapInterval[];
}

/** Q1.1.4/21 - the result of assessing one specific requested date range against the registry. */
export interface CoverageAssessment {
  symbol: string;
  timeframe: string;
  requested: { start: string; end: string };
  /** The actual usable period - equal to `requested` when fully covered, otherwise the real overlap with the symbol's recorded range. */
  actual: { start: string; end: string };
  requestedDurationDays: number;
  coveredDurationDays: number;
  missingDurationDays: number;
  coveragePct: number;
  largestGapDays: number;
  gapCountInRange: number;
  contiguousCoverage: ContiguousCoverage;
  policy: DateRangePolicy;
  /** Highest severity of any gap overlapping the requested range. */
  worstSeverity: DataQualityGrade;
  message: string;
  /** Deterministic - see Q1.1.22. Same market.db state + same audit rules => same value. */
  registryVersion: string;
  auditRuleVersion: string;
  /** Q1.2 Part 5/6/7 - server-computed, evidence-gated (Q1.1's real benchmark). Never client-influenced. */
  performanceClass: PerformanceClass;
  performanceWarning: string | null;
}
