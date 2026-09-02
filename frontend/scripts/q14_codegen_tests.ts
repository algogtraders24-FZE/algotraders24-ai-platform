/**
 * Q1.4 Part 23 - live tests against the real running codegen API (not
 * mocked). Requires the dev server to be running on localhost:3000.
 * Covers: determinism (spec hash / result hash reproducibility),
 * negative tests (unsupported language, invalid strategy, injection
 * attempts), and provenance shape.
 *
 * Run with: npx tsx frontend/scripts/q14_codegen_tests.ts
 * (server must already be running - same pattern as manual curl
 * verification used throughout this program, not a self-contained unit
 * test, since it exercises the real subprocess boundary.)
 */
const BASE = process.env.QUANT_LITE_TEST_BASE_URL || "http://localhost:3000";

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

const VALID_STRATEGY = {
  name: "Q1.4 Test Strategy",
  symbol: "XAUUSD_EXNESS",
  timeframe: "1h",
  indicators: [
    { id: "macd1", type: "MACD", fast: 12, slow: 26, signal: 9 },
    { id: "atr14", type: "ATR", period: 14 },
  ],
  entry_long: [{ left: "macd1.line", op: "cross_above", right: "macd1.signal" }],
  entry_short: [{ left: "macd1.line", op: "cross_below", right: "macd1.signal" }],
  risk: { sl_mode: "ATR", sl_atr_mult: 2.0, tp_mode: "ATR", tp_atr_mult: 3.0, atr_id: "atr14" },
};

async function codegen(strategy: unknown, targetLanguage: unknown) {
  const res = await fetch(`${BASE}/api/quant-lite/codegen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy, targetLanguage }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  // --- Determinism (Part 16) ------------------------------------------
  for (const lang of ["mql4", "mql5", "pine"]) {
    const r1 = await codegen(VALID_STRATEGY, lang);
    const r2 = await codegen(VALID_STRATEGY, lang);
    check(`determinism.${lang}_status_ok`, r1.status === 200 && r2.status === 200, { s1: r1.status, s2: r2.status });
    check(`determinism.${lang}_code_identical`, r1.body?.data?.code === r2.body?.data?.code);
    check(`determinism.${lang}_specHash_identical`, r1.body?.data?.provenance?.strategySpecHash === r2.body?.data?.provenance?.strategySpecHash);
    check(`determinism.${lang}_resultHash_identical`, r1.body?.data?.provenance?.resultHash === r2.body?.data?.provenance?.resultHash);
  }

  // --- Provenance shape (Part 14) ---------------------------------------
  {
    const r = await codegen(VALID_STRATEGY, "mql5");
    const prov = r.body?.data?.provenance ?? {};
    check("provenance.has_strategySpecHash", typeof prov.strategySpecHash === "string" && prov.strategySpecHash.length === 64);
    check("provenance.has_resultHash", typeof prov.resultHash === "string" && prov.resultHash.length === 64);
    check("provenance.has_generatorVersion", typeof prov.generatorVersion === "string");
    check("provenance.has_targetLanguage", prov.targetLanguage === "mql5");
    check("provenance.has_generatedAt", typeof prov.generatedAt === "string");
    check("provenance.no_secrets", !JSON.stringify(prov).match(/api[_-]?key|token|password|secret/i));
  }

  // --- Negative tests (Part 15) ------------------------------------------
  {
    const r = await codegen(VALID_STRATEGY, "python");
    check("negative.unsupported_language_rejected", r.status === 400 && r.body.status === "error", r);
  }
  {
    const badStrategy = { ...VALID_STRATEGY, indicators: [{ id: "i1", type: "NOT_REAL" }] };
    const r = await codegen(badStrategy, "mql5");
    check("negative.unsupported_indicator_rejected", r.status === 400 && r.body.status === "error", r);
  }
  {
    // schema has no OR-logic field - a client attempting to smuggle OR
    // semantics via a custom field must be silently ignored, not honored.
    const orAttempt = { ...VALID_STRATEGY, entry_long_or: [{ left: "close", op: ">", right: 0 }] };
    const r = await codegen(orAttempt, "mql5");
    check("negative.or_field_ignored_not_honored", r.status === 200, r);
    check("negative.generated_code_has_no_or_logic", !r.body?.data?.code?.includes(" || "), r.body?.data?.code);
  }

  // --- Security: template injection (Part 18) -----------------------------
  {
    const maliciousId = { ...VALID_STRATEGY, indicators: [{ id: 'i1"; Print(1); //', type: "RSI", period: 14 }], entry_long: [{ left: 'i1"; Print(1); //', op: "<", right: 30 }] };
    const r = await codegen(maliciousId, "mql5");
    check("security.malicious_indicator_id_rejected", r.status === 400 && r.body.status === "error", r);
  }
  {
    const maliciousName = { ...VALID_STRATEGY, name: 'Evil"; Print("INJECTED"); //' };
    const r = await codegen(maliciousName, "mql5");
    check("security.malicious_name_generates_but_sanitized", r.status === 200);
    const code = r.body?.data?.code ?? "";
    check("security.no_injected_print_statement", !code.includes('Print("INJECTED")'), code.slice(0, 300));
    check("security.no_unescaped_quote_breakout", !code.includes('req.comment="Evil";'), code.slice(0, 300));
  }
  {
    const r = await codegen("not an object", "mql5");
    check("security.non_object_strategy_rejected", r.status === 400, r);
  }
  {
    const res = await fetch(`${BASE}/api/quant-lite/codegen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not valid json" });
    check("security.malformed_json_rejected", res.status === 400, res.status);
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test run failed:", e);
  process.exit(1);
});
