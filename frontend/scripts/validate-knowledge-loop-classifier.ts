// scripts/validate-knowledge-loop-classifier.ts
// Sprint K3-B-2 — the heuristic query classifier (AI_ASSISTANT_ORCHESTRATION_
// CONTRACT.md §3 / K3_PREFLIGHT §6.1). Pure function, ZERO I/O, ZERO LLM.
//
// Run: npm run validate:knowledge-loop-classifier
//
// Proves intent / freshnessNeed / privacyClass / explicitFreshnessRequest over
// a fixture table, plus the conservative defaults on ambiguity.

import assert from "node:assert/strict";
import { classify } from "../services/knowledge-loop/classifier/classify";
import type { Classification } from "../types/knowledge-loop";

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

type Expect = Partial<Classification>;
function check(message: string, expect: Expect): void {
  const c = classify(message);
  for (const [k, v] of Object.entries(expect)) {
    assert.equal(
      (c as unknown as Record<string, unknown>)[k],
      v,
      `${k} for ${JSON.stringify(message)} → got ${JSON.stringify(c)}`,
    );
  }
}

function main(): void {
  console.log("\nK3-B-2 — knowledge-loop query classifier\n");

  test("conceptual 'what is' → conceptual / STATIC / public", () => {
    check("What is a moving average?", {
      intent: "conceptual",
      freshnessNeed: "STATIC",
      privacyClass: "public",
      explicitFreshnessRequest: false,
    });
  });

  test("how-to → how-to / STATIC", () => {
    check("How do I connect my broker account?", {
      intent: "how-to",
      freshnessNeed: "STATIC",
    });
  });

  test("policy question → policy / PERIODIC", () => {
    check("What is your refund policy?", {
      intent: "policy",
      freshnessNeed: "PERIODIC",
    });
  });

  test("support/troubleshoot → support-troubleshoot", () => {
    check("The chart isn't working and shows a blank screen", {
      intent: "support-troubleshoot",
    });
  });

  test("explicit freshness → current-info + explicitFreshnessRequest", () => {
    check("What is the latest news on the platform?", {
      intent: "current-info",
      explicitFreshnessRequest: true,
    });
  });

  test("dynamic value question → current-info / DYNAMIC", () => {
    check("What is the price of gold right now?", {
      intent: "current-info",
      freshnessNeed: "DYNAMIC",
      explicitFreshnessRequest: true,
    });
  });

  test("dynamic value without freshness word still → DYNAMIC", () => {
    check("How much does the Pro plan cost?", {
      freshnessNeed: "DYNAMIC",
    });
  });

  test("account-specific → account-specific / user-specific", () => {
    check("When does my subscription renew?", {
      intent: "account-specific",
      privacyClass: "user-specific",
    });
  });

  test("account-specific outranks current-info", () => {
    check("Show me my last invoice and the latest charge on my card", {
      intent: "account-specific",
      privacyClass: "user-specific",
    });
  });

  test("secret in the message → sensitive privacyClass", () => {
    check("my key sk-ant1234567890abcdef stopped working", {
      privacyClass: "sensitive",
    });
  });

  test("email address in the message → sensitive", () => {
    check("please update my address to john.doe@example.com", {
      privacyClass: "sensitive",
    });
  });

  test("product-static question → product-static / PERIODIC", () => {
    check("Which EA supports the MT5 platform?", {
      intent: "product-static",
      freshnessNeed: "PERIODIC",
    });
  });

  test("unclassifiable → other / PERIODIC / public (conservative default)", () => {
    check("hello there", {
      intent: "other",
      freshnessNeed: "PERIODIC",
      privacyClass: "public",
      explicitFreshnessRequest: false,
    });
  });

  test("empty message → other, no crash", () => {
    const c = classify("");
    assert.equal(c.intent, "other");
    assert.equal(c.privacyClass, "public");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
