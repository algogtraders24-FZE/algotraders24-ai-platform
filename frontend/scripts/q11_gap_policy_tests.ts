/**
 * Q1.1.29/30/31 - gap policy scenario tests, date-boundary tests, and
 * result-status mutual-exclusivity tests. Uses the REAL gap registry
 * (built from market.db by quant-engine/scripts/q11_gap_registry.py) -
 * every test case below targets a real, located gap or clean stretch
 * found in Q1.0/Q1.1's own audits, not synthetic data. No test framework
 * exists in this repo (Q0.9's own finding) - same plain-assertion
 * convention as every other q0x/q1x test script.
 *
 * Run with: npx tsx frontend/scripts/q11_gap_policy_tests.ts
 */
import { assessCoverage } from "../services/quant-lite/backend/coveragePolicy";

let passCount = 0;
let failCount = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passCount++;
    console.log(`PASS  ${name}`);
  } else {
    failCount++;
    console.log(`FAIL  ${name}  ${detail !== undefined ? JSON.stringify(detail) : ""}`);
  }
}

// --- Q1.1.29 gap policy scenarios ------------------------------------------

{
  // FULL_COVERAGE: EURUSD_EXNESS, a clean 2-month stretch with no known gaps.
  const a = assessCoverage("EURUSD_EXNESS", "1h", "2024-02-01", "2024-03-01");
  check("full_coverage.policy_supported", a.policy === "SUPPORTED", a.policy);
  check("full_coverage.high_pct", a.coveragePct >= 98, a.coveragePct);
  check("full_coverage.contiguous", a.contiguousCoverage === "FULL_CONTIGUOUS", a.contiguousCoverage);
}

{
  // NO_DATA: BTCUSD_EXNESS entirely inside its 155-day gap (2024-07-29 -> 2025-01-01).
  const a = assessCoverage("BTCUSD_EXNESS", "1h", "2024-09-01", "2024-10-01");
  check("no_data.policy_unavailable", a.policy === "DATA_UNAVAILABLE", a.policy);
  check("no_data.zero_coverage", a.coveragePct === 0, a.coveragePct);
}

{
  // SMALL_GAP: EURUSD_EXNESS full year - contains only its one ~13-day gap.
  const a = assessCoverage("EURUSD_EXNESS", "1h", "2024-01-01", "2024-12-31");
  check("small_gap.not_unavailable", a.policy !== "DATA_UNAVAILABLE", a.policy);
  check("small_gap.high_coverage", a.coveragePct > 90, a.coveragePct);
}

{
  // LARGE_GAP / CENTRAL_GAP: XAUUSD_EXNESS full range - the 169-day gap dominates.
  const a = assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2026-05-31");
  check("large_gap.restricted_or_unavailable", a.policy === "RESTRICTED" || a.policy === "DATA_UNAVAILABLE", a.policy);
  check("large_gap.fragmented", a.contiguousCoverage === "FRAGMENTED" || a.contiguousCoverage === "NO_OVERLAP", a.contiguousCoverage);
  check("large_gap.largest_gap_over_100d", a.largestGapDays > 100, a.largestGapDays);
}

{
  // MULTIPLE_GAPS: XAUUSD_ZS_EXNESS full range - 38-40 real gaps.
  const a = assessCoverage("XAUUSD_ZS_EXNESS", "1h", "2024-01-01", "2026-08-02");
  check("multiple_gaps.gap_count_high", a.gapCountInRange > 10, a.gapCountInRange);
  check("multiple_gaps.not_supported", a.policy !== "SUPPORTED", a.policy);
}

{
  // LOW_FREQUENCY_SEGMENT: XAUUSD_EXNESS's weekly-only stretch, Nov 2024 - Jan 2025.
  const a = assessCoverage("XAUUSD_EXNESS", "1h", "2024-11-01", "2025-01-15");
  check("low_freq.not_supported_clean", a.policy !== "SUPPORTED", a.policy);
  check("low_freq.reduced_coverage", a.coveragePct < 90, a.coveragePct);
}

{
  // EXPECTED_WEEKEND: a single normal week for a clean symbol - the weekly
  // closure must NOT count against coverage (expect near-100%, not ~71%
  // which is what a naive 5-of-7-days model would wrongly show).
  const a = assessCoverage("GBPUSD_EXNESS", "1h", "2024-03-04", "2024-03-11");
  check("expected_weekend.not_penalized", a.coveragePct > 95, a.coveragePct);
}

{
  // PARTIAL_OVERLAP: request starts well before data begins, ends inside real coverage.
  const a = assessCoverage("XAUUSD_EXNESS", "1h", "2020-01-01", "2024-06-01");
  check("partial_overlap.actual_clipped_to_real_start", a.actual.start >= "2024-01-01", a.actual.start);
  check("partial_overlap.requested_preserved", a.requested.start === "2020-01-01", a.requested.start);
}

{
  // NO_OVERLAP: request entirely before any real data exists.
  const a = assessCoverage("XAUUSD_EXNESS", "1h", "2019-01-01", "2019-06-01");
  check("no_overlap.policy_unavailable", a.policy === "DATA_UNAVAILABLE", a.policy);
  check("no_overlap.contiguous_no_overlap", a.contiguousCoverage === "NO_OVERLAP", a.contiguousCoverage);
}

// --- Q1.1.30 date boundary tests -------------------------------------------

{
  // request starts before data, ends after data (spans the whole real range and more)
  const a = assessCoverage("EURUSD_EXNESS", "1h", "2015-01-01", "2030-01-01");
  check("boundary.spans_beyond_both_ends", a.actual.start >= "2024-01-01" && a.actual.end <= "2026-08-22", a.actual);
}

{
  // request exactly matches the recorded min/max range
  const a = assessCoverage("EURUSD_EXNESS", "1h", "2024-01-01", "2026-08-21");
  check("boundary.exact_full_range_not_unavailable", a.policy !== "DATA_UNAVAILABLE", a.policy);
}

{
  // single-day request inside a clean stretch
  const a = assessCoverage("GBPUSD_EXNESS", "1h", "2024-05-01", "2024-05-02");
  check("boundary.single_day_supported", a.policy === "SUPPORTED" || a.policy === "SUPPORTED_WITH_WARNING", a.policy);
}

// --- Q1.1.31 result status mutual exclusivity -------------------------------

{
  const policies = ["SUPPORTED", "SUPPORTED_WITH_WARNING", "RESTRICTED", "DATA_UNAVAILABLE"];
  const cases = [
    assessCoverage("EURUSD_EXNESS", "1h", "2024-02-01", "2024-03-01"),
    assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2026-05-31"),
    assessCoverage("BTCUSD_EXNESS", "1h", "2024-09-01", "2024-10-01"),
  ];
  for (const c of cases) {
    check(`status_exclusivity.${c.symbol}_is_exactly_one_policy`, policies.includes(c.policy) && policies.filter((p) => p === c.policy).length === 1, c.policy);
  }
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
