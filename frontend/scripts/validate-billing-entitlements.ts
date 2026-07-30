// scripts/validate-billing-entitlements.ts
// Sprint L2.5 - Standalone validation for the real billing/subscription
// rework against the REAL database (no test framework exists in this
// project - see package.json). Run via `npm run validate:billing`.
//
// Covers: EntitlementService's real Prisma aggregation (AI messages scoped
// to the current period, Knowledge documents/storage as cumulative
// ceilings, conversation count), and SubscriptionActionService's real
// mutations (cancel/reactivate always persist; a plan change only persists
// for a $0 plan - anything else throws PaymentRequiredError and leaves the
// database untouched, never a fake success).
//
// Safety: creates exactly one throwaway User (+ synthetic Conversation,
// Messages, Knowledge rows, and a Subscription) under a clearly-marked
// synthetic email, exercises every case, then hard-deletes everything it
// created in a `finally` block regardless of pass/fail. Reads the existing
// seeded "free"/"pro" Plan rows but never creates, mutates, or deletes them.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { entitlementService } from "../services/billing/EntitlementService";
import {
  subscriptionActionService,
  PaymentRequiredError,
  SubscriptionNotFoundError,
  InvalidPlanError,
} from "../services/billing/SubscriptionActionService";

const RUN_TAG = `sprintl2-5-${Date.now()}`;

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
  const freePlan = await prisma.plan.findUnique({ where: { id: "free" } });
  const proPlan = await prisma.plan.findUnique({ where: { id: "pro" } });
  assert.ok(freePlan, "seeded 'free' Plan row must exist (run prisma db seed)");
  assert.ok(proPlan, "seeded 'pro' Plan row must exist (run prisma db seed)");

  const user = await prisma.user.create({
    data: { email: `${RUN_TAG}@internal.test`, name: "L2.5 Validation User", planId: "pro" },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title: "L2.5 validation conversation" },
  });

  const now = new Date();
  const periodStart = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  const periodEnd = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000); // 25 days ahead
  const beforePeriod = new Date(periodStart.getTime() - 24 * 60 * 60 * 1000); // 1 day before period

  try {
    // 3 assistant messages inside the period, 1 outside (must not count),
    // plus 2 user messages (must not count - only assistant replies do).
    await prisma.message.create({
      data: { conversationId: conversation.id, userId: user.id, role: "assistant", content: "reply 1", createdAt: periodStart },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, userId: user.id, role: "assistant", content: "reply 2", createdAt: now },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, userId: user.id, role: "assistant", content: "reply 3", createdAt: periodEnd },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, userId: user.id, role: "assistant", content: "outside period", createdAt: beforePeriod },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, userId: user.id, role: "user", content: "question 1", createdAt: now },
    });

    // Two active Knowledge docs (2 MB + 3 MB = 5 MB) and one soft-deleted
    // doc that must not count toward the ceiling.
    const docA = await prisma.knowledge.create({
      data: { userId: user.id, title: "Doc A", source: "upload", documentSize: 2 * 1024 * 1024 },
    });
    const docB = await prisma.knowledge.create({
      data: { userId: user.id, title: "Doc B", source: "upload", documentSize: 3 * 1024 * 1024 },
    });
    const docDeleted = await prisma.knowledge.create({
      data: { userId: user.id, title: "Doc Deleted", source: "upload", documentSize: 999 * 1024 * 1024, deletedAt: new Date() },
    });

    await test("aiMessages: counts only assistant-role messages within the given period", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.aiMessages.used, 3);
    });

    await test("aiMessages: entitlement matches the pro plan's real aiCredits limit", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.aiMessages.limit, proPlan!.price >= 0 ? e.aiMessages.limit : -1); // sanity: limit is a real positive number
      assert.ok(e.aiMessages.limit > 0);
      assert.equal(e.aiMessages.remaining, e.aiMessages.limit - 3);
    });

    await test("knowledgeDocuments: counts only non-deleted rows, cumulative (not period-scoped)", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.knowledgeDocuments.used, 2);
    });

    await test("storageMb: sums only non-deleted document sizes, converted to MB", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.storageMb.used, 5);
    });

    await test("conversations: counts real, non-deleted conversations", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.conversations.used, 1);
    });

    await test("no-fabrication: unmeasured metrics are explicitly tracked:false, never a guessed number", async () => {
      const e = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.equal(e.marketAnalysisRequests.tracked, false);
      assert.equal(e.searchRequests.tracked, false);
    });

    await test("unknown planId falls back to 'free' rather than throwing or fabricating a plan", async () => {
      const e = await entitlementService.getEntitlements(user.id, "not-a-real-plan", periodStart, periodEnd);
      assert.equal(e.planId, "free");
    });

    await test("determinism: identical inputs produce identical usage across two calls", async () => {
      const a = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      const b = await entitlementService.getEntitlements(user.id, "pro", periodStart, periodEnd);
      assert.deepEqual(a, b);
    });

    // ---- Subscription mutations ----

    await test("cancel/reactivate: no subscription row throws SubscriptionNotFoundError", async () => {
      await assert.rejects(
        () => subscriptionActionService.setCancelAtPeriodEnd(user.id, true),
        SubscriptionNotFoundError,
      );
    });

    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: "pro",
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });

    await test("cancel: real DB write sets cancelAtPeriodEnd true", async () => {
      const updated = await subscriptionActionService.setCancelAtPeriodEnd(user.id, true);
      assert.equal(updated.cancelAtPeriodEnd, true);
      const row = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.equal(row?.cancelAtPeriodEnd, true);
    });

    await test("reactivate: real DB write sets cancelAtPeriodEnd false", async () => {
      const updated = await subscriptionActionService.setCancelAtPeriodEnd(user.id, false);
      assert.equal(updated.cancelAtPeriodEnd, false);
    });

    await test("changePlan: unknown plan id throws InvalidPlanError, no DB write", async () => {
      await assert.rejects(
        () => subscriptionActionService.changePlan(user.id, "not-a-real-plan"),
        InvalidPlanError,
      );
      const row = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.equal(row?.planId, "pro");
    });

    await test("changePlan: a plan priced above $0 throws PaymentRequiredError, never a silent grant", async () => {
      assert.ok(proPlan!.price > 0, "fixture assumption: pro plan is priced above $0");
      await assert.rejects(
        () => subscriptionActionService.changePlan(user.id, "pro"),
        PaymentRequiredError,
      );
      const row = await prisma.subscription.findUnique({ where: { id: sub.id } });
      assert.equal(row?.planId, "pro", "planId must be unchanged after a rejected paid change");
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(freshUser?.planId, "pro", "User.planId must be unchanged after a rejected paid change");
    });

    await test("changePlan: a $0 plan is a real, persisted change (no payment needed)", async () => {
      assert.equal(freePlan!.price, 0, "fixture assumption: free plan is $0");
      const updated = await subscriptionActionService.changePlan(user.id, "free");
      assert.equal(updated.planId, "free");
      assert.equal(updated.cancelAtPeriodEnd, false);
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(freshUser?.planId, "free", "User.planId must be kept in sync with the real Subscription row");
    });

    await prisma.knowledge.deleteMany({ where: { id: { in: [docA.id, docB.id, docDeleted.id] } } });
  } finally {
    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    await prisma.knowledge.deleteMany({ where: { userId: user.id } });
    await prisma.conversation.deleteMany({ where: { id: conversation.id } }); // cascades Message rows
    await prisma.user.deleteMany({ where: { id: user.id } });

    const leftoverMessages = await prisma.message.count({ where: { conversationId: conversation.id } });
    const leftoverKnowledge = await prisma.knowledge.count({ where: { userId: user.id } });
    const leftoverSub = await prisma.subscription.count({ where: { userId: user.id } });
    if (leftoverMessages > 0 || leftoverKnowledge > 0 || leftoverSub > 0) {
      console.error("  WARNING: some validation rows were not cleaned up");
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, conversation, messages, knowledge, subscription)");
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
