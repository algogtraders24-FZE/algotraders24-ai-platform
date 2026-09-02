/**
 * Q0.9 automated tests for the pure backend modules - request validation,
 * deterministic hashing, the data coverage gate, and jobId security. No
 * test framework exists in this repo (confirmed in the Q0.9.1 audit), so
 * this follows the same plain-assertion convention as
 * quant-engine/scripts/q09_regression_test.py: PASS/FAIL prints, exits 1
 * on any failure. These test pure functions directly - they do not
 * require a running dev server (see quant-engine/reports/Q0.9_REAL_EXECUTION_VALIDATION.md
 * for the live-server E2E tests that were run manually against these
 * same modules through the real HTTP API).
 *
 * Run with: npx tsx frontend/scripts/q09_backend_tests.ts
 */
import { computeRequestHash } from "../services/quant-lite/backend/requestHash";
import { checkDataCoverage, REAL_EXECUTION_SYMBOLS } from "../services/quant-lite/backend/dataCoverage";
import { validateBacktestRequest } from "../services/quant-lite/backend/validateBacktestRequest";
import { isValidJobId } from "../services/quant-lite/backend/jobStore";
import type { BacktestRequest } from "../types/quant-lite";

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

const VALID_STRATEGY: BacktestRequest["strategy"] = {
  name: "Test", symbol: "XAUUSD_EXNESS", timeframe: "1h",
  indicators: [
    { id: "macd1", type: "MACD", fast: 12, slow: 26, signal: 9 },
    { id: "atr14", type: "ATR", period: 14 },
  ],
  entry_long: [{ left: "macd1.line", op: "cross_above", right: "macd1.signal" }],
  entry_short: [{ left: "macd1.line", op: "cross_below", right: "macd1.signal" }],
  risk: { sl_mode: "ATR", sl_atr_mult: 2.0, tp_mode: "ATR", tp_atr_mult: 3.0, atr_id: "atr14" },
};

const VALID_REQUEST: BacktestRequest = {
  strategy: VALID_STRATEGY,
  symbol: "XAUUSD_EXNESS",
  timeframe: "1h",
  dateRange: { start: "2024-01-01", end: "2024-12-31" },
  initialCapital: 10000,
  riskPct: 1.0,
};

// --- requestHash: determinism ---------------------------------------------
{
  const h1 = computeRequestHash(VALID_REQUEST);
  const h2 = computeRequestHash(JSON.parse(JSON.stringify(VALID_REQUEST)));
  check("hash.deterministic_across_clones", h1 === h2, { h1, h2 });

  const reordered: BacktestRequest = {
    ...VALID_REQUEST,
    dateRange: { end: VALID_REQUEST.dateRange.end, start: VALID_REQUEST.dateRange.start },
  };
  check("hash.key_order_independent", computeRequestHash(reordered) === h1);

  const renamed: BacktestRequest = { ...VALID_REQUEST, strategy: { ...VALID_STRATEGY, name: "Different Name" } };
  check("hash.ignores_cosmetic_name", computeRequestHash(renamed) === h1);

  const differentCapital: BacktestRequest = { ...VALID_REQUEST, initialCapital: 5000 };
  check("hash.changes_on_semantic_field", computeRequestHash(differentCapital) !== h1);
}

// --- dataCoverage: symbol/timeframe/date gate ------------------------------
{
  check("coverage.accepts_supported_symbol", checkDataCoverage("XAUUSD_EXNESS", "1h", "2024-06-01", "2024-07-01").ok);
  check("coverage.rejects_legacy_symbol_no_1m_data", !checkDataCoverage("XAUUSD", "1h", "2024-06-01", "2024-07-01").ok);
  // "5m" became a verified-supported timeframe in Q1.0 (quant-engine/reports/Q1.0_CAPABILITY_MATRIX.md) -
  // "2h" was never a real option in any sprint, so it stays a valid negative case.
  check("coverage.rejects_unsupported_timeframe", !checkDataCoverage("XAUUSD_EXNESS", "2h", "2024-06-01", "2024-07-01").ok);
  check("coverage.rejects_out_of_range_dates", !checkDataCoverage("XAUUSD_EXNESS", "1h", "2019-01-01", "2019-06-01").ok);
  check("coverage.rejects_start_after_end", !checkDataCoverage("XAUUSD_EXNESS", "1h", "2024-06-01", "2024-01-01").ok);
  check("coverage.symbol_list_has_six_entries", REAL_EXECUTION_SYMBOLS.size === 6, REAL_EXECUTION_SYMBOLS.size);
}

// --- validateBacktestRequest: authoritative server-side validation --------
{
  check("validate.accepts_valid_request", validateBacktestRequest(VALID_REQUEST).valid);
  check("validate.rejects_non_object_body", !validateBacktestRequest("not an object").valid);
  check("validate.rejects_null_body", !validateBacktestRequest(null).valid);
  check("validate.rejects_missing_strategy", !validateBacktestRequest({ ...VALID_REQUEST, strategy: undefined }).valid);
  check("validate.rejects_capital_below_min", !validateBacktestRequest({ ...VALID_REQUEST, initialCapital: 1 }).valid);
  check("validate.rejects_capital_above_max", !validateBacktestRequest({ ...VALID_REQUEST, initialCapital: 999_999_999 }).valid);
  check("validate.rejects_risk_pct_out_of_range", !validateBacktestRequest({ ...VALID_REQUEST, riskPct: 50 }).valid);
  check(
    "validate.rejects_unknown_indicator_type",
    !validateBacktestRequest({
      ...VALID_REQUEST,
      strategy: { ...VALID_STRATEGY, indicators: [{ id: "x", type: "NOT_REAL" }] },
    }).valid,
  );
  check(
    "validate.rejects_no_entry_conditions",
    !validateBacktestRequest({ ...VALID_REQUEST, strategy: { ...VALID_STRATEGY, entry_long: [], entry_short: [] } }).valid,
  );
  check(
    "validate.rejects_atr_mode_without_atr_id",
    !validateBacktestRequest({
      ...VALID_REQUEST,
      strategy: { ...VALID_STRATEGY, risk: { sl_mode: "ATR", tp_mode: "ATR" } },
    }).valid,
  );
  check(
    "validate.rejects_unsupported_symbol_via_coverage_gate",
    !validateBacktestRequest({ ...VALID_REQUEST, symbol: "XAUUSD", strategy: { ...VALID_STRATEGY, symbol: "XAUUSD" } }).valid,
  );
}

// --- jobStore.isValidJobId: security boundary ------------------------------
{
  check("jobid.accepts_real_uuid", isValidJobId("1b9c2b58-eec7-40b8-9bd7-2b9e55d6d2cb"));
  check("jobid.rejects_path_traversal", !isValidJobId("../../../etc/passwd"));
  check("jobid.rejects_shell_injection", !isValidJobId("$(rm -rf /)"));
  check("jobid.rejects_sql_injection", !isValidJobId("1' OR '1'='1"));
  check("jobid.rejects_empty_string", !isValidJobId(""));
  check("jobid.rejects_null_byte", !isValidJobId("abc\0def"));
  check("jobid.rejects_non_uuid_alnum", !isValidJobId("not-a-uuid-at-all"));
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
