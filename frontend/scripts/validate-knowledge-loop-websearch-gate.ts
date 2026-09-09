// scripts/validate-knowledge-loop-websearch-gate.ts
// Sprint K3-B-2 — the web-search gate (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md
// §5 / K3_PREFLIGHT §6.1). Pure function over {classification × sufficiency}.
//
// Run: npm run validate:knowledge-loop-websearch-gate

import assert from "node:assert/strict";
import { webSearchGate } from "../services/knowledge-loop/orchestrator/web-search-gate";
import type {
  Classification,
  AssistantIntent,
  FreshnessNeed,
  PrivacyClass,
} from "../types/knowledge-loop";

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

function cls(
  intent: AssistantIntent,
  freshnessNeed: FreshnessNeed,
  privacyClass: PrivacyClass,
  explicitFreshnessRequest = false,
): Classification {
  return { intent, freshnessNeed, privacyClass, explicitFreshnessRequest };
}

function main(): void {
  console.log("\nK3-B-2 — web-search gate\n");

  // ── FORBIDDEN — always false regardless of sufficiency. ──
  test("sensitive privacyClass → forbidden (even when INSUFFICIENT)", () => {
    const r = webSearchGate(cls("other", "DYNAMIC", "sensitive", true), "INSUFFICIENT");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "forbidden-sensitive");
  });

  test("account-specific → forbidden (even with explicit freshness)", () => {
    const r = webSearchGate(cls("account-specific", "PERIODIC", "user-specific", true), "STALE");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "forbidden-account");
  });

  test("conceptual + SUFFICIENT retrieval → forbidden (web adds nothing)", () => {
    const r = webSearchGate(cls("conceptual", "STATIC", "public"), "SUFFICIENT");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "forbidden-conceptual-sufficient");
  });

  test("policy + SUFFICIENT retrieval → forbidden", () => {
    const r = webSearchGate(cls("policy", "PERIODIC", "public"), "SUFFICIENT");
    assert.equal(r.useWebSearch, false);
  });

  // ── REQUIRED. ──
  test("explicit freshness request → required", () => {
    const r = webSearchGate(cls("current-info", "PERIODIC", "public", true), "SUFFICIENT");
    assert.equal(r.useWebSearch, true);
    assert.equal(r.reason, "explicit-freshness");
  });

  test("DYNAMIC freshness need → required", () => {
    const r = webSearchGate(cls("current-info", "DYNAMIC", "public"), "SUFFICIENT");
    assert.equal(r.useWebSearch, true);
    assert.equal(r.reason, "dynamic-need");
  });

  test("retrieval INSUFFICIENT → required", () => {
    const r = webSearchGate(cls("how-to", "STATIC", "public"), "INSUFFICIENT");
    assert.equal(r.useWebSearch, true);
    assert.equal(r.reason, "insufficient");
  });

  test("retrieval STALE → required", () => {
    const r = webSearchGate(cls("product-static", "PERIODIC", "public"), "STALE");
    assert.equal(r.useWebSearch, true);
    assert.equal(r.reason, "stale");
  });

  // ── DEFAULT. ──
  test("conceptual + LOW retrieval, no freshness → not needed", () => {
    const r = webSearchGate(cls("conceptual", "STATIC", "public"), "LOW");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "not-needed");
  });

  test("product-static + SUFFICIENT, no freshness → not needed", () => {
    const r = webSearchGate(cls("product-static", "PERIODIC", "public"), "SUFFICIENT");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "not-needed");
  });

  test("forbidden beats required (sensitive + DYNAMIC)", () => {
    const r = webSearchGate(cls("current-info", "DYNAMIC", "sensitive"), "INSUFFICIENT");
    assert.equal(r.useWebSearch, false);
    assert.equal(r.reason, "forbidden-sensitive");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
