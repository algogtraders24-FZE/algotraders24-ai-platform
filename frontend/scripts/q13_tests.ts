/**
 * Q1.3 Part 9 - tests for the threshold confirmation, XAUUSD coverage
 * finding, and capability matrix freeze. No code logic changed this
 * sprint (the 365-day threshold was confirmed, not moved) - these tests
 * assert the confirmed evidence and the frozen capability contract stay
 * self-consistent, not new behavior.
 *
 * Run with: npx tsx frontend/scripts/q13_tests.ts
 */
import { assessCoverage } from "../services/quant-lite/backend/coveragePolicy";
import { classifyPerformance } from "../services/quant-lite/backend/performanceClassification";
import { DATA_COVERAGE_REGISTRY } from "../data/quant-lite-gap-registry";
import { QUANT_LITE_CAPABILITY } from "../data/quant-lite-capability";

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

// --- Performance threshold confirmation (18-month case) -----------------

{
  const at365 = classifyPerformance("1m", 365);
  const at547 = classifyPerformance("1m", 547); // 18 months - measured SLOW both runs
  check("perf.365d_stays_normal", at365.performanceClass === "NORMAL");
  check("perf.547d_18mo_is_slow", at547.performanceClass === "SLOW", at547);

  const at365_5m = classifyPerformance("5m", 365);
  const at547_5m = classifyPerformance("5m", 547);
  check("perf.5m_365d_normal", at365_5m.performanceClass === "NORMAL");
  check("perf.5m_547d_slow", at547_5m.performanceClass === "SLOW");
}

// --- XAUUSD coverage classification (Part 3 finding) ---------------------

{
  const xau1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "XAUUSD_EXNESS" && e.timeframe === "1h")!;
  const xau4h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "XAUUSD_EXNESS" && e.timeframe === "4h")!;
  check("xauusd.1h_has_session_breaks", xau1h.sessionBreakCount > 0, xau1h.sessionBreakCount);
  check("xauusd.4h_has_no_session_breaks", xau4h.sessionBreakCount === 0, xau4h.sessionBreakCount);

  const xauZs1h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "XAUUSD_ZS_EXNESS" && e.timeframe === "1h")!;
  const xauZs4h = DATA_COVERAGE_REGISTRY.find((e) => e.symbol === "XAUUSD_ZS_EXNESS" && e.timeframe === "4h")!;
  check("xauusd_zs.1h_has_session_breaks", xauZs1h.sessionBreakCount > 0, xauZs1h.sessionBreakCount);
  check("xauusd_zs.4h_has_no_session_breaks", xauZs4h.sessionBreakCount === 0, xauZs4h.sessionBreakCount);

  // the big structural gaps must be IDENTICAL across timeframes (confirms not smoothed/force-matched)
  const largeGaps1h = xau1h.gaps.filter((g) => g.durationDays > 10);
  const largeGaps4h = xau4h.gaps.filter((g) => g.durationDays > 10);
  check("xauusd.large_gaps_same_count", largeGaps1h.length === largeGaps4h.length, { "1h": largeGaps1h.length, "4h": largeGaps4h.length });
  const largestMatch = Math.abs(xau1h.largestGapDays - xau4h.largestGapDays) < 1;
  check("xauusd.largest_gap_matches_across_timeframes", largestMatch, { "1h": xau1h.largestGapDays, "4h": xau4h.largestGapDays });
}

// --- Capability matrix self-consistency (Part 4 freeze) -------------------

{
  check("capability.six_symbols", QUANT_LITE_CAPABILITY.length === 6, QUANT_LITE_CAPABILITY.length);
  for (const entry of QUANT_LITE_CAPABILITY) {
    const registryEntries = DATA_COVERAGE_REGISTRY.filter((e) => e.symbol === entry.symbol);
    check(`capability.${entry.symbol}_has_registry_data`, registryEntries.length === 7, registryEntries.length);
    for (const tf of entry.timeframes) {
      const found = registryEntries.some((e) => e.timeframe === tf);
      check(`capability.${entry.symbol}_${tf}_in_registry`, found);
    }
  }
  // no duplicated capability-status logic: QUANT_LITE_CAPABILITY and the
  // gap registry answer different questions (symbol/timeframe OFFERED at
  // all vs. per-request coverage quality) - assert they don't disagree
  // about the base fact of which symbols exist.
  const capabilitySymbols = new Set(QUANT_LITE_CAPABILITY.map((c) => c.symbol));
  const registrySymbols = new Set(DATA_COVERAGE_REGISTRY.map((e) => e.symbol));
  const overlap = [...capabilitySymbols].every((s) => registrySymbols.has(s));
  check("capability.every_offered_symbol_has_registry_data", overlap);
}

// --- API enforcement (server-authoritative, unchanged mechanism reused) --

{
  const a = assessCoverage("XAUUSD_EXNESS", "1m", "2024-01-01", "2026-05-31");
  check("api.performance_class_present", typeof a.performanceClass === "string");
  check("api.long_xauusd_1m_flagged_slow", a.performanceClass === "SLOW", a.performanceClass);
}

// --- Deterministic classification (repeat) --------------------------------

{
  const r1 = assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2024-12-31");
  const r2 = assessCoverage("XAUUSD_EXNESS", "1h", "2024-01-01", "2024-12-31");
  check("determinism.macd_baseline_identical", JSON.stringify(r1) === JSON.stringify(r2));
  check("determinism.macd_still_restricted", r1.policy === "RESTRICTED", r1.policy);

  const p1 = classifyPerformance("1m", 547);
  const p2 = classifyPerformance("1m", 547);
  check("determinism.performance_classification_identical", JSON.stringify(p1) === JSON.stringify(p2));
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
