// scripts/validate-credits-threshold-email.ts
// Email audit follow-up (2026-09-24) - the A9 credit ledger has been live
// in production since 2026-09-07, but nothing ever read the balance it was
// already computing correctly (confirmed via a direct DB check: 343 real
// ledger entries existed before this change touched anything). This
// validates the newly-wired credits-low/exhausted email path against the
// REAL Prisma-backed store (PrismaCreditStore) and the REAL notifier
// (EmailThresholdNotifier) - only the ALLOWANCE is test-controlled
// (FixedAllowanceResolver(100)) so the low/exhausted thresholds are
// reachable with small, deterministic charge amounts. Everything else -
// the store, the dedupe check, the email functions - is the exact real
// production code path.
//
// Standalone validation against the REAL database (no test framework in
// this project - see package.json), same convention as validate-payment-
// hardening.ts. Run via `npm run validate:credits-threshold-email`.
//
// Must run with `--conditions=react-server` - imports EmailService.ts
// (real "server-only" guard) transitively via threshold-notifier.ts.
//
// Safety: every fixture is tagged with one run-unique string and hard-
// deleted in a `finally` block (each step independently caught) regardless
// of pass/fail.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { CreditLedger, PrismaCreditStore, FixedAllowanceResolver, EmailThresholdNotifier } from "../services/agent-framework/credits";

const RUN_TAG = `creditsemail-${Date.now()}`;
const ALLOWANCE = 100;
const LOW_THRESHOLD = ALLOWANCE * 0.2; // 20, matching threshold-notifier.ts's LOW_BALANCE_RATIO

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Credits Email Validation User", planId: "free" } });
  const runId = `${RUN_TAG}-run`;

  // Real store, real notifier, TEST-controlled allowance only - so the
  // low/exhausted boundaries are reachable with small deterministic charges
  // while everything downstream (DB writes, dedupe, email functions) is the
  // genuine production code path.
  const ledger = new CreditLedger({ store: new PrismaCreditStore(), allowances: new FixedAllowanceResolver(ALLOWANCE, "test-plan"), notifier: new EmailThresholdNotifier() });

  try {
    await test("charging down to just above the low threshold does NOT send a credits_low email", async () => {
      const before = Date.now();
      // allowance 100, charge 79 -> balance 21, just above the 20 threshold
      await ledger.charge({ userId: user.id, runId, kind: "tool_call", amount: ALLOWANCE - LOW_THRESHOLD - 1, reason: "validation", idempotencyKey: `${RUN_TAG}-charge1` });
      const log = await prisma.emailLog.findFirst({ where: { type: "credits_low", dedupeKey: { startsWith: user.id }, sentAt: { gte: new Date(before) } } });
      assert.equal(log, null, "must not fire above the threshold");
    });

    await test("crossing the low threshold sends exactly one credits_low email, addressed to the real user", async () => {
      const before = Date.now();
      // balance 21 -> charge 2 -> balance 19, now at/under the 20 threshold
      const result = await ledger.charge({ userId: user.id, runId, kind: "tool_call", amount: 2, reason: "validation", idempotencyKey: `${RUN_TAG}-charge2` });
      assert.ok(result.balance.balance <= LOW_THRESHOLD, "sanity check on the test's own math");

      const log = await prisma.emailLog.findFirst({ where: { type: "credits_low", sentAt: { gte: new Date(before) } } });
      assert.ok(log, "a credits_low EmailLog row must exist");
      assert.equal(log!.recipientEmail, user.email);
      assert.equal(log!.status, "SKIPPED", "no RESEND_API_KEY in this environment - honest SKIPPED path, never a fake SENT");
    });

    await test("a further charge that stays in the low (not exhausted) zone does NOT send a second credits_low email", async () => {
      const before = Date.now();
      // balance 19 -> charge 5 -> balance 14, still low, not exhausted
      await ledger.charge({ userId: user.id, runId, kind: "tool_call", amount: 5, reason: "validation", idempotencyKey: `${RUN_TAG}-charge3` });
      const logs = await prisma.emailLog.findMany({ where: { type: "credits_low", sentAt: { gte: new Date(before) } } });
      assert.equal(logs.length, 0, "the SAME low threshold must not re-fire within the same period - this is exactly the dedupe wasEmailAlreadySent exists for");
    });

    await test("reaching exactly zero balance sends a SEPARATE credits_exhausted email (not another credits_low)", async () => {
      const before = Date.now();
      // balance 14 -> charge 14 -> balance 0
      const result = await ledger.charge({ userId: user.id, runId, kind: "tool_call", amount: 14, reason: "validation", idempotencyKey: `${RUN_TAG}-charge4` });
      assert.equal(result.balance.balance, 0);

      const exhaustedLog = await prisma.emailLog.findFirst({ where: { type: "credits_exhausted", sentAt: { gte: new Date(before) } } });
      assert.ok(exhaustedLog, "a credits_exhausted EmailLog row must exist");
      assert.equal(exhaustedLog!.recipientEmail, user.email);

      const lowLog = await prisma.emailLog.findFirst({ where: { type: "credits_low", sentAt: { gte: new Date(before) } } });
      assert.equal(lowLog, null, "must not ALSO re-fire credits_low - it already fired earlier this period");
    });

    await test("a further charge attempt once exhausted throws InsufficientCreditsError (the ledger's own pre-existing guarantee, unaffected by this change)", async () => {
      await assert.rejects(
        () => ledger.charge({ userId: user.id, runId, kind: "tool_call", amount: 1, reason: "validation", idempotencyKey: `${RUN_TAG}-charge5` }),
        (err: unknown) => err instanceof Error && err.name === "InsufficientCreditsError",
      );
    });

    await test("createCreditLedger() (the real production factory) resolves a real user's balance without crashing, using the real Plan-based allowance", async () => {
      const { createCreditLedger } = await import("../services/agent-framework/credits");
      const balance = await createCreditLedger().balance(user.id);
      assert.ok(balance.allowance > 0, "the free plan must have a real, positive aiCredits allowance");
      assert.equal(balance.planId, "free");
    });
  } finally {
    const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.error(`  cleanup FAILED (${label}):`, err instanceof Error ? err.message : err);
        failed += 1;
      }
    };

    await safeDelete("agent_credit_ledger_entries", () => prisma.agentCreditLedgerEntry.deleteMany({ where: { userId: user.id } }));
    await safeDelete("email_logs", () => prisma.emailLog.deleteMany({ where: { recipientEmail: user.email } }));
    await safeDelete("user", () => prisma.user.deleteMany({ where: { id: user.id } }));

    console.log("  cleanup complete");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
