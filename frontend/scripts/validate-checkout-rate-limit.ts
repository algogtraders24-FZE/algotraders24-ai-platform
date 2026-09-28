// scripts/validate-checkout-rate-limit.ts
// AT24 Security Hardening P2.2 - validates lib/security/checkoutRateLimit.ts
// against the REAL database (no test framework in this project - see
// package.json), matching the existing validate-ai-rate-limit.ts /
// validate-login-rate-limit.ts convention. Run via
// `npm run validate:checkout-rate-limit`.
//
// Covers the owner's exact locked acceptance criteria: 1-10 allowed, 11th
// blocked, window expiry recovers, the SAME user is one shared bucket
// regardless of which of the 5 checkout routes is calling (the function
// is keyed purely by userId - it has no notion of "which route" at all,
// so sharing is structural, not something that can silently regress),
// different users get independent buckets, and concurrent requests
// cannot trivially bypass the limit (reuses aiRateLimit.ts's proven
// non-blocking advisory-lock design).
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { checkAndRecordCheckoutAttempt } from "../lib/security/checkoutRateLimit";

const RUN_TAG = `checkoutrl-${Date.now()}`;

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

async function main() {
  try {
    await test("attempts 1-10 all allowed", async () => {
      const userId = `${RUN_TAG}-user-a`;
      for (let i = 1; i <= 10; i++) {
        const result = await checkAndRecordCheckoutAttempt(userId);
        assert.equal(result.allowed, true, `attempt ${i} should be allowed`);
      }
    });

    await test("the 11th attempt in the same 10-minute window is blocked", async () => {
      const userId = `${RUN_TAG}-user-a`;
      const result = await checkAndRecordCheckoutAttempt(userId);
      assert.equal(result.allowed, false);
    });

    await test(
      "same user across all 5 checkout endpoints shares ONE bucket - the function is keyed purely by userId, with no route/endpoint parameter at all, so 5 calls representing 5 different routes for the SAME already-maxed-out user are all blocked, not given a fresh 10 each",
      async () => {
        const userId = `${RUN_TAG}-user-a`; // already at 10/10 from the tests above
        for (let i = 0; i < 5; i++) {
          const result = await checkAndRecordCheckoutAttempt(userId);
          assert.equal(result.allowed, false, `simulated call ${i + 1} (representing a different checkout route) should still be blocked - same shared bucket`);
        }
      },
    );

    await test("a different authenticated user has an independent bucket, unaffected by user-a's block", async () => {
      const userId = `${RUN_TAG}-user-b`;
      const result = await checkAndRecordCheckoutAttempt(userId);
      assert.equal(result.allowed, true);
    });

    await test("window expiration - attempts older than 10 minutes don't count against a fresh check", async () => {
      const userId = `${RUN_TAG}-user-c`;
      const staleTime = new Date(Date.now() - 11 * 60 * 1000); // 11 min ago, outside the 10-min window
      await prisma.requestLog.createMany({
        data: Array.from({ length: 10 }, () => ({ userId, type: "checkout", createdAt: staleTime })),
      });
      const result = await checkAndRecordCheckoutAttempt(userId);
      assert.equal(result.allowed, true, "10 stale (>10min old) attempts should not count against the fresh window");
    });

    await test("concurrency - concurrent checkout attempts cannot trivially bypass the limit", async () => {
      const userId = `${RUN_TAG}-user-d`;
      const results = await Promise.all(
        Array.from({ length: 15 }, () => checkAndRecordCheckoutAttempt(userId)),
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      assert.equal(allowedCount, 10, `expected exactly 10 of 15 concurrent attempts admitted, got ${allowedCount}`);

      const after = await checkAndRecordCheckoutAttempt(userId);
      assert.equal(after.allowed, false, "after a burst of 15 concurrent attempts against a 10 limit, a later sequential check must be blocked");
    });
  } finally {
    const cleanupErrors: string[] = [];
    try {
      await prisma.requestLog.deleteMany({ where: { userId: { startsWith: RUN_TAG } } });
    } catch (err) {
      cleanupErrors.push(err instanceof Error ? err.message : String(err));
    }

    if (cleanupErrors.length > 0) {
      console.error("  WARNING: cleanup step(s) failed:");
      for (const e of cleanupErrors) console.error(`    ${e}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed");
    }
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
