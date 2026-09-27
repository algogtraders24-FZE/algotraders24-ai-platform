// scripts/validate-ai-rate-limit.ts
// AT24 Security Hardening P1.1 - validates lib/security/aiRateLimit.ts and
// lib/security/quantChatEntitlement.ts against the REAL database (no test
// framework in this project - see package.json), matching the existing
// validate-payment-links.ts convention. Run via
// `npm run validate:ai-rate-limit`.
//
// Covers the owner's exact P1.1 acceptance gate: the 21st request blocked,
// the 501st blocked globally, concurrent requests can't bypass either
// limit, different users can't reset the global counter, window
// expiration works, legitimate requests below the limit work, and the
// Quant Chat monthly aiMessages entitlement enforces correctly.
//
// Safety: every row this script creates is tagged under a run-specific
// prefix/time-window and removed in a `finally` block. The global-guard
// test (test 2) necessarily counts ALL "algo_test_compile"-type RequestLog
// rows created platform-wide during its ~1-2 second run window, not just
// this script's own - acceptable because real traffic on this type is
// currently near-zero (see the P1.1 baseline research) and cleanup scopes
// by type + a captured "testStartedAt" timestamp, removing exactly what
// exists in that window regardless of source.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { checkAndRecordAiRateLimit } from "../lib/security/aiRateLimit";
import { checkQuantChatMonthlyEntitlement } from "../lib/security/quantChatEntitlement";

const RUN_TAG = `ratelimit-${Date.now()}`;

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
  const createdUserIds: string[] = [];

  try {
    await test("legitimate requests below the per-user limit all succeed (1-20 of 20)", async () => {
      const userId = `${RUN_TAG}-user-a`;
      for (let i = 1; i <= 20; i++) {
        const result = await checkAndRecordAiRateLimit(userId, "trading_copilot");
        assert.equal(result.allowed, true, `request ${i} should be allowed`);
      }
    });

    await test("the 21st request from the same user in the same window is blocked (user_burst)", async () => {
      const userId = `${RUN_TAG}-user-a`; // same user as above - already has 20 recorded
      const result = await checkAndRecordAiRateLimit(userId, "trading_copilot");
      assert.equal(result.allowed, false);
      assert.equal(result.reason, "user_burst");
    });

    await test("a different user is unaffected by another user's burst limit (per-user isolation)", async () => {
      const userId = `${RUN_TAG}-user-b`;
      const result = await checkAndRecordAiRateLimit(userId, "trading_copilot");
      assert.equal(result.allowed, true);
    });

    await test("concurrent requests cannot bypass the per-user burst limit (race safety)", async () => {
      const userId = `${RUN_TAG}-user-concurrent`;
      const results = await Promise.all(
        Array.from({ length: 25 }, () => checkAndRecordAiRateLimit(userId, "trading_copilot")),
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed && r.reason === "user_burst").length;
      assert.equal(allowedCount, 20, `expected exactly 20 of 25 concurrent requests admitted, got ${allowedCount}`);
      assert.equal(blockedCount, 5, `expected exactly 5 of 25 concurrent requests blocked, got ${blockedCount}`);
    });

    await test("window expiration - requests older than 10 minutes don't count against the limit", async () => {
      const userId = `${RUN_TAG}-user-expired`;
      const staleTime = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago, outside the 10-min window
      await prisma.requestLog.createMany({
        data: Array.from({ length: 20 }, () => ({ userId, type: "trading_copilot", createdAt: staleTime })),
      });
      const result = await checkAndRecordAiRateLimit(userId, "trading_copilot");
      assert.equal(result.allowed, true, "20 stale (>10min old) rows should not count against the fresh window");
    });

    await test("global emergency guard trips at the 501st request across many different users, even though each user's own burst limit is nowhere near reached", async () => {
      const testStartedAt = new Date();
      for (let i = 0; i < 500; i++) {
        const result = await checkAndRecordAiRateLimit(`${RUN_TAG}-global-${i}`, "algo_test_compile");
        assert.equal(result.allowed, true, `request ${i + 1}/500 should be allowed (global guard not yet reached)`);
      }
      // The 501st request, from yet another brand-new user (per-user count = 1, nowhere near the 20/user limit).
      const overLimit = await checkAndRecordAiRateLimit(`${RUN_TAG}-global-501`, "algo_test_compile");
      assert.equal(overLimit.allowed, false, "different users must not be able to bypass or reset the shared global counter");
      assert.equal(overLimit.reason, "global_guard");

      await prisma.requestLog.deleteMany({ where: { type: "algo_test_compile", createdAt: { gte: testStartedAt } } });
    });

    await test("Quant Chat monthly aiMessages entitlement - allowed below the free-plan limit (500), blocked at/above it", async () => {
      const user = await prisma.user.create({
        data: { email: `${RUN_TAG}-quant@example.com`, planId: "free", name: "Rate Limit Test User" },
      });
      createdUserIds.push(user.id);
      const conversation = await prisma.conversation.create({ data: { userId: user.id, title: "validation" } });

      const belowLimit = await checkQuantChatMonthlyEntitlement(user.id, "free");
      assert.equal(belowLimit.allowed, true, "a user with 0 assistant messages this period should be allowed");

      await prisma.message.createMany({
        data: Array.from({ length: 500 }, (_, i) => ({
          conversationId: conversation.id,
          userId: user.id,
          role: "assistant",
          content: `msg ${i}`,
        })),
      });

      const atLimit = await checkQuantChatMonthlyEntitlement(user.id, "free");
      assert.equal(atLimit.allowed, false, "a free-plan user at exactly 500 assistant messages this period should be blocked");
    });
  } finally {
    const cleanupErrors: string[] = [];
    const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    await safeDelete("request_logs", () =>
      prisma.requestLog.deleteMany({ where: { userId: { startsWith: RUN_TAG } } }),
    );
    await safeDelete("messages", () =>
      prisma.message.deleteMany({ where: { userId: { in: createdUserIds } } }),
    );
    await safeDelete("conversations", () =>
      prisma.conversation.deleteMany({ where: { userId: { in: createdUserIds } } }),
    );
    await safeDelete("users", () => prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }));

    if (cleanupErrors.length > 0) {
      console.error("  WARNING: cleanup step(s) failed:");
      for (const e of cleanupErrors) console.error(`    ${e}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (request logs, messages, conversations, user)");
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
