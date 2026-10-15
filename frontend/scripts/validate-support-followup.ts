// scripts/validate-support-followup.ts
// AT24 Copilot Phase 3 (W3 + account scope): follow-up retrieval and "own account only" context.
// Pure + structural (no DB, no network). Run: npm run validate:support-followup
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { looksLikeFollowUp, buildRetrievalQuery } from "../services/support/follow-up-query";
import { wantsAccountContext } from "../services/agent-framework/supervisor/specialists/support.specialist";

const ROOT = join(__dirname, "..");
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL - ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\nAT24 Copilot Phase 3 - follow-ups and account scope\n");

test("follow-up detection: short openers and dependent pronouns are follow-ups", () => {
  for (const q of ["and what about the Pro plan?", "what about Elite?", "How about for businesses", "ok and does it work on MT4?", "is that included in free?", "why?"]) {
    assert.equal(looksLikeFollowUp(q), true, q);
  }
});

test("follow-up detection: full standalone questions and long messages are NOT follow-ups", () => {
  for (const q of [
    "What is Live Sync?",
    "How do I turn on two factor authentication?",
    "Where do I put my license key in the EA?",
    "and what about the Pro plan and the Elite plan and the Enterprise plan and how do they all compare on credits",
  ]) {
    assert.equal(looksLikeFollowUp(q), false, q);
  }
});

test("retrieval query: a follow-up is anchored on the previous question; the user's own text is untouched", () => {
  const q = buildRetrievalQuery("and what about the Pro plan?", ["Does Quant Pro come with the free plan?"]);
  assert.equal(q, "Does Quant Pro come with the free plan? and what about the Pro plan?");
});

test("retrieval query: uses only the LAST previous question, bounded in length", () => {
  const long = "x".repeat(500);
  const q = buildRetrievalQuery("and what about it?", ["old question", long]);
  assert.ok(q.startsWith("x".repeat(200)) && q.length <= 200 + 1 + "and what about it?".length);
  assert.ok(!q.includes("old question"));
});

test("retrieval query: no previous turn, or not a follow-up, leaves the question as typed", () => {
  assert.equal(buildRetrievalQuery("and what about the Pro plan?", []), "and what about the Pro plan?");
  assert.equal(buildRetrievalQuery("What is Live Sync?", ["How do credits work?"]), "What is Live Sync?");
});

test("account scope: product questions that merely contain 'plan'/'credits'/'license' do NOT pull the account in", () => {
  for (const q of [
    "Does Quant Pro come with the free plan?",
    "How many AI credits does the Pro plan have?",
    "Which plans include Quant Pro?",
    "How does a license work?",
    "What is the refund policy?",
  ]) {
    assert.equal(wantsAccountContext(q), false, q);
  }
});

test("account scope: first-person questions about account state DO", () => {
  for (const q of [
    "What is my plan?",
    "Why was I charged twice?",
    "Do I have an active license?",
    "How do I upgrade my plan?",
    "What is the status of my subscription",
    "when does my subscription renew",
  ]) {
    assert.equal(wantsAccountContext(q), true, q);
  }
});

test("account scope: a question with no account noun never does, even in first person", () => {
  assert.equal(wantsAccountContext("How do I turn on two factor authentication?"), false);
  assert.equal(wantsAccountContext("What is Live Sync?"), false);
});

test("wiring: the specialist uses wantsAccountContext and the retrievalQuestion; the run start adds it", () => {
  const spec = readFileSync(join(ROOT, "services", "agent-framework", "supervisor", "specialists", "support.specialist.ts"), "utf8");
  assert.match(spec, /wantsAccountContext\(goal\.question\)/);
  assert.match(spec, /retrievalQuestion/);
  const svc = readFileSync(join(ROOT, "services", "agent-framework", "api", "agent-run-service.ts"), "utf8");
  assert.match(svc, /withFollowUpRetrievalQuery\(input\)/);
});

test("isolation: the follow-up module only ever sees questions (no answers, no account text)", () => {
  const src = readFileSync(join(ROOT, "services", "support", "follow-up-query.ts"), "utf8");
  assert.doesNotMatch(src, /import[^;]*(prisma|account|evidence)/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
