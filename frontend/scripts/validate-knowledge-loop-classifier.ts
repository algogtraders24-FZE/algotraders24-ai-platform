// scripts/validate-knowledge-loop-classifier.ts
// Sprint K3-B-2 — the heuristic query classifier (AI_ASSISTANT_ORCHESTRATION_
// CONTRACT.md §3 / K3_PREFLIGHT §6.1). Pure function, ZERO I/O, ZERO LLM.
// Sprint K3-C (C2) — §12.1 LOCKED precedence + `historical` intent.
//
// Run: npm run validate:knowledge-loop-classifier
//
// Proves intent / freshnessNeed / privacyClass / explicitFreshnessRequest over
// a fixture table, plus the conservative defaults on ambiguity.
// C2 adds: the exact §12.1 precedence order (a message matching several rules
// resolves to the highest), the `historical` intent (STATIC, never web-forced),
// and that classify() is deterministic + synchronous (no LLM).

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

  // ── K3-C C2 — §12.1 LOCKED precedence + `historical` intent ────────────
  console.log("\n  K3-C C2 — precedence + historical\n");

  test("C2: historical — 'back in 2021 …' → historical / STATIC", () => {
    check("Back in 2021 the platform used to have a different dashboard", {
      intent: "historical",
      freshnessNeed: "STATIC",
      explicitFreshnessRequest: false,
    });
  });

  test("C2: historical — 'what happened to the old charting tool' → historical", () => {
    check("What happened to the old charting tool", { intent: "historical", freshnessNeed: "STATIC" });
  });

  test("C2: historical — 'the platform used to support MT4' → historical", () => {
    check("Did the platform used to support MT4", { intent: "historical" });
  });

  test("C2: current-info OUTRANKS historical (rule 2 before rule 6)", () => {
    // "latest" → explicitFreshnessRequest → current-info wins even with 'historically'
    check("What is the latest version, and historically what was it", {
      intent: "current-info",
      explicitFreshnessRequest: true,
    });
  });

  test("C2: precedence — account-specific beats how-to + support", () => {
    check("How do I fix the login error on my account", {
      intent: "account-specific",
      privacyClass: "user-specific",
    });
  });

  test("C2: precedence — policy beats how-to", () => {
    check("What is your refund policy and how do I request one", { intent: "policy" });
  });

  test("C2: precedence — current-info (price) beats product-static", () => {
    check("What is the current price of the Pro plan", { intent: "current-info", freshnessNeed: "DYNAMIC" });
  });

  test("C2: precedence — historical beats product-static (rule 6 before rule 7)", () => {
    check("Back in 2020 what features did the EA have", { intent: "historical", freshnessNeed: "STATIC" });
  });

  test("C2: precedence — support-troubleshoot beats how-to", () => {
    check("The export button is broken, how do I get my data out", { intent: "support-troubleshoot" });
  });

  test("C2: classify() is deterministic and synchronous (no LLM)", () => {
    const msg = "What is the latest price of gold and how do I trade it back in 2019";
    const a = classify(msg);
    const b = classify(msg);
    assert.deepEqual(a, b, "same input → identical output");
    // synchronous: the return value is a plain object, not a Promise
    assert.equal(typeof (a as unknown as { then?: unknown }).then, "undefined");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
