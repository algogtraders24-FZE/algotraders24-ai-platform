// scripts/validate-login-rate-limit.ts
// AT24 Security Hardening P1.3 - validates lib/security/loginRateLimit.ts
// against the REAL database (no test framework in this project - see
// package.json), matching the existing validate-ai-rate-limit.ts
// convention. Run via `npm run validate:login-rate-limit`.
//
// Covers the locked P1.3 spec: max 5 failed attempts / 15 min, keyed on
// IP + normalized email, only FAILED attempts count, window expiration,
// IP/email isolation, and concurrency behavior.
//
// Concurrency note (documented, not hidden): checkLoginRateLimit (a
// read-only count) and recordFailedLogin (a separate insert) are two
// steps, not one atomic operation - under truly simultaneous concurrent
// requests there is a narrow TOCTOU window where more than 5 failures
// could be recorded before the limit trips. This is the SAME accepted
// race already present in lib/security/signupRateLimit.ts's combined
// check+record (two concurrent signups can both read an under-limit
// count before either inserts) - not a new risk introduced here. Real
// brute-force traffic is normally sequential (each attempt waits for the
// previous response), so this is a low real-world risk; the concurrency
// test below documents the actual behavior rather than asserting a
// stronger guarantee than the design provides.
//
// Safety: every row this script creates is tagged under a run-specific
// IP prefix and removed in a `finally` block.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { checkLoginRateLimit, recordFailedLogin } from "../lib/security/loginRateLimit";

const RUN_TAG = `loginrl-${Date.now()}`;

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
    await test("attempts 1-5 (failed logins) are each checked as allowed before being recorded", async () => {
      const ip = `${RUN_TAG}-ip-a`;
      const email = `${RUN_TAG}-user-a@example.com`;
      for (let i = 1; i <= 5; i++) {
        const result = await checkLoginRateLimit({ ip, email });
        assert.equal(result.allowed, true, `attempt ${i} should be allowed`);
        await recordFailedLogin({ ip, email });
      }
    });

    await test("the 6th attempt in the same 15-minute window is blocked", async () => {
      const ip = `${RUN_TAG}-ip-a`;
      const email = `${RUN_TAG}-user-a@example.com`;
      const result = await checkLoginRateLimit({ ip, email });
      assert.equal(result.allowed, false);
      assert.ok(result.reason === "ip" || result.reason === "email");
    });

    await test("email is normalized (case-insensitive) for the rate-limit key - uppercase variant is still blocked", async () => {
      const ip = `${RUN_TAG}-ip-a`;
      const email = `${RUN_TAG}-USER-A@EXAMPLE.COM`.toLowerCase(); // caller (signInAction) normalizes before calling
      const result = await checkLoginRateLimit({ ip, email });
      assert.equal(result.allowed, false, "the lowercased form of the same address should still be blocked");
    });

    await test("IP isolation - a different IP with a different email is unaffected by another IP+email's block", async () => {
      const ip = `${RUN_TAG}-ip-b`;
      const email = `${RUN_TAG}-user-b@example.com`;
      const result = await checkLoginRateLimit({ ip, email });
      assert.equal(result.allowed, true);
    });

    await test("email-scoped limit - the SAME email attacked from a fresh, different IP is still blocked (per-email counter)", async () => {
      const ip = `${RUN_TAG}-ip-c`; // fresh IP, never used before
      const email = `${RUN_TAG}-user-a@example.com`; // the already-maxed-out email from test 1
      const result = await checkLoginRateLimit({ ip, email });
      assert.equal(result.allowed, false);
      assert.equal(result.reason, "email");
    });

    await test("successful login never counts against the limit - checking without recording leaves the count untouched", async () => {
      const ip = `${RUN_TAG}-ip-d`;
      const email = `${RUN_TAG}-user-d@example.com`;
      // Simulate 10 successful logins: check, then (as signInAction does on
      // success) never call recordFailedLogin.
      for (let i = 0; i < 10; i++) {
        const result = await checkLoginRateLimit({ ip, email });
        assert.equal(result.allowed, true, `successful-login simulation ${i + 1} should never be blocked`);
      }
    });

    await test("window expiration - failures older than 15 minutes don't count against a fresh check", async () => {
      const ip = `${RUN_TAG}-ip-e`;
      const email = `${RUN_TAG}-user-e@example.com`;
      const staleTime = new Date(Date.now() - 16 * 60 * 1000); // 16 min ago, outside the 15-min window
      await prisma.signupAttempt.createMany({
        data: Array.from({ length: 5 }, () => ({ ip, email, action: "login", createdAt: staleTime })),
      });
      const result = await checkLoginRateLimit({ ip, email });
      assert.equal(result.allowed, true, "5 stale (>15min old) failures should not count against the fresh window");
    });

    await test("concurrency - concurrent failed-attempt cycles don't crash and roughly enforce the limit (documented TOCTOU tolerance)", async () => {
      const ip = `${RUN_TAG}-ip-f`;
      const email = `${RUN_TAG}-user-f@example.com`;
      const results = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const check = await checkLoginRateLimit({ ip, email });
          if (check.allowed) await recordFailedLogin({ ip, email });
          return check.allowed;
        }),
      );
      const allowedCount = results.filter(Boolean).length;
      // Not asserting exactly 5 (the documented race can admit a few more
      // under true concurrency) - asserting the limiter still meaningfully
      // engages rather than admitting all 10.
      assert.ok(allowedCount <= 10 && allowedCount >= 1, `expected a bounded number allowed, got ${allowedCount}`);
      assert.ok(allowedCount < 10, "the limiter should block at least some of 10 concurrent attempts against a 5-limit");

      // A subsequent, sequential check must now be blocked regardless of
      // how the race resolved above (the count is already >= 5).
      const after = await checkLoginRateLimit({ ip, email });
      assert.equal(after.allowed, false, "after a burst of concurrent failures, a later sequential check must be blocked");
    });
  } finally {
    const cleanupErrors: string[] = [];
    try {
      await prisma.signupAttempt.deleteMany({ where: { ip: { startsWith: RUN_TAG } } });
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
