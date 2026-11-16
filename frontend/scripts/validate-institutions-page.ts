// scripts/validate-institutions-page.ts
// The Institutions page must stay honest: nothing is labelled "available", every offer says what exists today, no promise words,
// and the proof links point at real pages. No database, no network.
//   npx tsx scripts/validate-institutions-page.ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHECK_OUR_WORK, INSTITUTION_GROUPS, INSTITUTION_LIMITS, INSTITUTION_PILOT_QUESTIONS, INSTITUTION_PILOT_STEPS } from "../lib/content/institutions";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const root = join(__dirname, "..");
const services = INSTITUTION_GROUPS.flatMap((g) => g.services);

test("there are offers, and none is labelled 'available' (a partner cannot use any of them off the shelf today)", () => {
  assert.ok(services.length >= 4);
  assert.ok(services.every((s) => s.status !== "available"), "an offer is labelled available");
});

test("every offer says what exists today", () => {
  for (const s of services) assert.ok(s.today.trim().length > 40, `thin 'today' for ${s.title}`);
});

test("no promise words in any offer (guarantee, outperform, alpha, profit)", () => {
  const copy = services.flatMap((s) => [s.title, s.detail, s.today]).join(" ");
  assert.ok(!/\b(guarantee[sd]?|outperform\w*|alpha|profit\w*)\b/i.test(copy), "promise wording found");
});

test("the limits say: not signals, regulator decides the classification, no raw-quote resale, no SLA, no return claims", () => {
  const t = INSTITUTION_LIMITS.join(" ").toLowerCase();
  assert.ok(t.includes("not a signal service"));
  assert.ok(t.includes("regulator") && t.includes("compliance"));
  assert.ok(t.includes("do not resell raw quotes"));
  assert.ok(t.includes("no uptime or service-level"));
  assert.ok(t.includes("no claim about returns"));
});

test("every 'check our work' link points at a real page", () => {
  for (const c of CHECK_OUR_WORK) assert.ok(existsSync(join(root, "app", c.href.replace(/^\//, ""), "page.tsx")), `no page for ${c.href}`);
});

test("pilot: three steps, and the request asks for regulator and jurisdictions", () => {
  assert.equal(INSTITUTION_PILOT_STEPS.length, 3);
  assert.ok(INSTITUTION_PILOT_QUESTIONS.some((q) => /regulator/i.test(q)));
  assert.ok(INSTITUTION_PILOT_QUESTIONS.length >= 5);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
