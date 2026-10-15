// scripts/validate-support-quickreplies.ts
// AT24 Copilot Phase 4: the starter quick-reply chips. Run: npm run validate:support-quickreplies
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COPILOT_QUICK_REPLIES } from "../components/support/QuickReplies";

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

console.log("\nAT24 Copilot Phase 4 - quick replies\n");

test("five chips, each with a label and a real question, including a way to reach a person", () => {
  assert.equal(COPILOT_QUICK_REPLIES.length, 5);
  for (const c of COPILOT_QUICK_REPLIES) assert.ok(c.label.length > 0 && c.question.length > 10);
  assert.ok(COPILOT_QUICK_REPLIES.some((c) => /person/i.test(c.label)));
});

test("wiring: chips appear in both the page and the widget", () => {
  for (const f of [join("app", "dashboard", "support", "page.tsx"), join("components", "support", "SupportWidget.tsx")]) {
    assert.match(readFileSync(join(ROOT, f), "utf8"), /<QuickReplies/, `${f} must render QuickReplies`);
  }
});

test("the thumbs feedback feature is gone (owner decision): no route, no component, no UI reference", () => {
  for (const f of [join("components", "support", "AnswerFeedback.tsx"), join("services", "support", "feedback.ts"), join("app", "api", "private", "support", "feedback", "route.ts")]) {
    assert.throws(() => readFileSync(join(ROOT, f), "utf8"), `${f} must not exist`);
  }
  for (const f of [join("app", "dashboard", "support", "page.tsx"), join("components", "support", "SupportWidget.tsx")]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /AnswerFeedback/);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
