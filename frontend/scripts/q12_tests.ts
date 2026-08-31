/**
 * Q1.2 Part 10 - tests for the USOIL/closure classification refinement
 * and the large-run performance warning. Uses the real v2 gap registry
 * (quant-engine/scripts/q11_gap_registry.py, AUDIT_RULE_VERSION
 * "q1.2-gap-rules-v2") - no test depends on wall-clock time (every date
 * used is a fixed historical value, and the performance-warning tests
 * check a boolean/classification, never an actual elapsed duration).
 *
 * Run with: npx tsx frontend/scripts/q12_tests.ts
 */
import { assessCoverage } from "../services/quant-lite/backend/coveragePolicy";
import { classifyPerformance } from "../services/quant-lite/backend/performanceClassification";
import { DATA_COVERAGE_REGISTRY, GAP_REGISTRY_AUDIT_RULE_VERSION } from "../data/quant-lite-gap-registry";

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

// --- USOIL discrepancy classification ---------------------------------

{
  check("registry.on_v2_rules", GAP_REGISTRY_AUDIT_RULE_VERSION === "q1.2-gap-rules-v2", GAP_REGISTRY_AUDIT_RULE_VERSION);

  const usoil1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "USOIL_EXNESS" && e.timeframe === "1h")!;
  const usoil4h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "USOIL_EXNESS" && e.timeframe === "4h")!;
  check("usoil.session_breaks_found", usoil1h.sessionBreakCount > 400, usoil1h.sessionBreakCount);
  check("usoil.cross_timeframe_spread_reduced", Math.abs(usoil4h.coveragePct - usoil1h.coveragePct) < 2, { "1h": usoil1h.coveragePct, "4h": usoil4h.coveragePct });

  // EURUSD should show far fewer session breaks than USOIL - the rule is
  // time-pattern based, not a symbol allowlist, so this must emerge from
  // real data, not be hardcoded.
  const eur1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "EURUSD_EXNESS" && e.timeframe === "1h")!;
  check("eurusd.session_breaks_much_rarer_than_usoil", eur1h.sessionBreakCount < usoil1h.sessionBreakCount / 20, { eur: eur1h.sessionBreakCount, usoil: usoil1h.sessionBreakCount });
}

// --- Closure classification --------------------------------------------

{
  // EXPECTED_SESSION_BREAK gaps must never appear in the "problem" gaps list
  const usoil1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "USOIL_EXNESS" && e.timeframe === "1h")!;
  const hasSessionBreakInGapsList = usoil1h.gaps.some((g) => g.gapType === "EXPECTED_SESSION_BREAK");
  check("closure.session_break_excluded_from_gaps_list", !hasSessionBreakInGapsList);

  // A real, unexplained gap must still show up as a classified type
  const xau1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "XAUUSD_EXNESS" && e.timeframe === "1h")!;
  const hasLowFreq = xau1h.gaps.some((g) => g.gapType === "LOW_FREQUENCY_SEGMENT");
  check("closure.real_gap_still_classified", hasLowFreq);
}

// --- Coverage status determinism (four-way policy) ----------------------

{
  const supported = assessCoverage("EURUSD_EXNESS", "1h", "2024-02-01", "2024-03-01");
  const restricted = assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2024-12-31");
  const unavailable = assessCoverage("BTCUSD_EXNESS", "1h", "2024-09-01", "2024-10-01");

  check("status.supported_is_supported", supported.policy === "SUPPORTED" || supported.policy === "SUPPORTED_WITH_WARNING", supported.policy);
  check("status.restricted_stays_restricted_not_failed", restricted.policy === "RESTRICTED", restricted.policy);
  check("status.restricted_has_real_data_not_empty", restricted.coveragePct > 0 && restricted.coveredDurationDays > 0);
  check("status.data_unavailable_is_data_unavailable", unavailable.policy === "DATA_UNAVAILABLE", unavailable.policy);
  check("status.restricted_not_same_as_unavailable", restricted.policy !== unavailable.policy);
}

// --- Q0.9/Q1.1 flagship MACD baseline: metrics unaffected, still RESTRICTED ---

{
  const macd = assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2024-12-31");
  check("macd_baseline.still_restricted", macd.policy === "RESTRICTED", macd.policy);
  check("macd_baseline.largest_gap_still_28d", macd.largestGapDays === 28, macd.largestGapDays);
  check("macd_baseline.coverage_improved_but_still_restricted", macd.coveragePct > 83, macd.coveragePct);
}

// --- Large-run performance warning --------------------------------------

{
  const shortRun1m = classifyPerformance("1m", 30);
  const longRun1m = classifyPerformance("1m", 500);
  const longRun5m = classifyPerformance("5m", 500);
  const longRun1h = classifyPerformance("1h", 500);

  check("perf.short_1m_no_warning", shortRun1m.performanceClass === "NORMAL" && shortRun1m.performanceWarning === null);
  check("perf.long_1m_warns", longRun1m.performanceClass === "SLOW" && longRun1m.performanceWarning !== null);
  check("perf.long_5m_warns", longRun5m.performanceClass === "SLOW" && longRun5m.performanceWarning !== null);
  check("perf.long_other_timeframe_no_warning", longRun1h.performanceClass === "NORMAL" && longRun1h.performanceWarning === null, longRun1h);

  // Q1.2 Part 6 - warning text must not imply failure/unavailable/bad quality
  const msg = longRun1m.performanceWarning ?? "";
  check("perf.warning_not_alarming", !/fail|unavailable|error|bad|poor/i.test(msg), msg);
  check("perf.warning_no_promised_time", !/\d+\s*(second|minute|sec|min)/i.test(msg), msg);
  check("perf.warning_no_memory_figures", !/\d+\s*(mb|gb|memory)/i.test(msg), msg);
}

// --- Server-authoritative: embedded in every CoverageAssessment ---------

{
  const a = assessCoverage("XAUUSD_EXNESS", "1m", "2024-01-01", "2026-05-31");
  check("perf.embedded_in_assessment", typeof a.performanceClass === "string" && "performanceWarning" in a);
}

// --- Determinism (Q1.2 Part 9) - repeat, no wall-clock dependency -------

{
  const a1 = assessCoverage("USOIL_EXNESS", "1h", "2024-01-01", "2024-06-01");
  const a2 = assessCoverage("USOIL_EXNESS", "1h", "2024-01-01", "2024-06-01");
  check("determinism.usoil_identical", JSON.stringify(a1) === JSON.stringify(a2));

  const b1 = assessCoverage("XAUUSD_EXNESS", "1m", "2024-01-01", "2024-02-01");
  const b2 = assessCoverage("XAUUSD_EXNESS", "1m", "2024-01-01", "2024-02-01");
  check("determinism.1m_case_identical", JSON.stringify(b1) === JSON.stringify(b2));

  const c1 = assessCoverage("EURUSD_EXNESS", "5m", "2024-01-01", "2024-02-01");
  const c2 = assessCoverage("EURUSD_EXNESS", "5m", "2024-01-01", "2024-02-01");
  check("determinism.5m_case_identical", JSON.stringify(c1) === JSON.stringify(c2));
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
