// scripts/validate-csrf-origin.ts
// AT24 Security Hardening P2.1 - validates proxy.ts's CSRF Origin
// validation logic (no test framework in this project - see
// package.json), matching the existing validate-login-rate-limit.ts
// convention. Run via `npm run validate:csrf-origin`.
//
// Tests the REAL exported functions (hasDisallowedOrigin,
// STATE_CHANGING_METHODS) against REAL NextRequest instances - not a
// reimplementation of the logic that could drift out of sync with what
// proxy() actually runs.
//
// Covers the owner's exact locked test matrix:
//   POST/PUT/PATCH/DELETE + matching Origin      -> allow
//   POST + mismatched Origin                     -> block (403 in proxy)
//   state-changing + absent Origin                -> allow (fail-open)
//   GET + mismatched Origin                       -> unaffected (method gate)
//   cron-exempt path                              -> unaffected (structural)
//   Stripe/NOWPayments webhooks                   -> unaffected (structural)
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasDisallowedOrigin, STATE_CHANGING_METHODS } from "../proxy";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";
const API_PATH = "/api/private/billing/checkout"; // any real /api/private/* path - only used to construct a valid request URL

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

function makeRequest(method: string, origin: string | null): NextRequest {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest(`${SITE_URL}${API_PATH}`, { method, headers });
}

// The real decision proxy() makes for a given (pathname-is-protected-api,
// method, origin) combination - pathname is fixed true here since every
// case below targets an /api/private/* path.
function wouldBlock(method: string, origin: string | null): boolean {
  const req = makeRequest(method, origin);
  return STATE_CHANGING_METHODS.has(req.method) && hasDisallowedOrigin(req);
}

function main() {
  test("POST + matching Origin -> allowed", () => {
    assert.equal(wouldBlock("POST", SITE_URL), false);
  });

  test("PUT + matching Origin -> allowed", () => {
    assert.equal(wouldBlock("PUT", SITE_URL), false);
  });

  test("PATCH + matching Origin -> allowed", () => {
    assert.equal(wouldBlock("PATCH", SITE_URL), false);
  });

  test("DELETE + matching Origin -> allowed", () => {
    assert.equal(wouldBlock("DELETE", SITE_URL), false);
  });

  test("POST + mismatched Origin -> blocked (403)", () => {
    assert.equal(wouldBlock("POST", "https://evil.example"), true);
  });

  test("PUT + mismatched Origin -> blocked (403)", () => {
    assert.equal(wouldBlock("PUT", "https://evil.example"), true);
  });

  test("state-changing (POST) + absent Origin -> allowed (documented fail-open)", () => {
    assert.equal(wouldBlock("POST", null), false);
  });

  test("GET + mismatched Origin -> unaffected (method gate gate excludes GET entirely)", () => {
    assert.equal(STATE_CHANGING_METHODS.has("GET"), false);
    assert.equal(wouldBlock("GET", "https://evil.example"), false);
  });

  test("a same-origin-but-different-path URL used as Origin is still treated as matching (origin comparison, not full URL)", () => {
    // e.g. a request Origin header is always just scheme+host+port, never a path -
    // confirms hasDisallowedOrigin compares .origin, not the full URL string.
    assert.equal(wouldBlock("POST", `${SITE_URL}/some/other/path`), false);
  });

  test("a malformed (unparseable) but PRESENT Origin header is treated as a mismatch, not an absence", () => {
    assert.equal(wouldBlock("POST", "not a url"), true);
  });

  test(
    "structural: the cron-secret exemption check appears BEFORE the Origin check in proxy() - cron requests never reach the Origin gate at all",
    () => {
      const source = readFileSync(join(__dirname, "..", "proxy.ts"), "utf-8");
      const cronCheckIndex = source.indexOf("CRON_SECRET_EXEMPT_PATHS.has(");
      const originCheckIndex = source.indexOf("hasDisallowedOrigin(request)");
      assert.ok(cronCheckIndex > 0, "cron-secret exemption check not found in proxy.ts");
      assert.ok(originCheckIndex > 0, "Origin check call not found in proxy.ts");
      assert.ok(cronCheckIndex < originCheckIndex, "cron-secret exemption must be checked before the Origin gate");
    },
  );

  test(
    "structural: proxy.ts's matcher does not include /api/webhooks/* - Stripe/NOWPayments callbacks never reach this file at all",
    () => {
      const source = readFileSync(join(__dirname, "..", "proxy.ts"), "utf-8");
      assert.ok(!source.includes("api/webhooks"), "proxy.ts's matcher must not reference /api/webhooks - webhook routes must stay outside proxy's jurisdiction");
    },
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
