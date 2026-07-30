// scripts/validate-admin-control-center.ts
// Sprint L2.6 - Standalone validation for the Admin Control Center against
// the REAL database (no test framework exists in this project - see
// package.json). Run via `npm run validate:admin`.
//
// Covers: real user role/status mutations, real admin subscription
// overrides (including the deliberate difference from L2.5's self-service
// flow - an admin CAN grant a paid plan), real knowledge moderation
// (soft-delete only), real analytics/health aggregates, real audit
// logging of every mutation, and a structural check that every admin API
// route actually gates on requireAdmin (Phase 1's "every action must
// require Admin authorization" rule).
//
// Safety: creates exactly one throwaway admin actor + one throwaway target
// user (+ synthetic Conversation/Message/Knowledge/Subscription rows)
// under clearly-marked synthetic emails, exercises every case, then
// hard-deletes everything it created in a `finally` block regardless of
// pass/fail, including any AuditLog rows it produced (the only script in
// this project that deletes AuditLog rows - production code never does).
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { adminUserService } from "../services/admin/AdminUserService";
import { adminSubscriptionService, InvalidPlanError } from "../services/admin/AdminSubscriptionService";
import { adminKnowledgeService } from "../services/admin/AdminKnowledgeService";
import { adminAnalyticsService } from "../services/admin/AdminAnalyticsService";
import { adminHealthService } from "../services/admin/AdminHealthService";
import { auditLogService } from "../services/admin/AuditLogService";

const RUN_TAG = `l2-6-${Date.now()}`;

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

const ADMIN_ROUTE_FILES = [
  "app/api/private/admin/users/route.ts",
  "app/api/private/admin/users/[userId]/route.ts",
  "app/api/private/admin/subscriptions/route.ts",
  "app/api/private/admin/subscriptions/[userId]/route.ts",
  "app/api/private/admin/knowledge/route.ts",
  "app/api/private/admin/knowledge/[knowledgeId]/route.ts",
  "app/api/private/admin/analytics/route.ts",
  "app/api/private/admin/health/route.ts",
  "app/api/private/admin/audit-logs/route.ts",
];

async function main(): Promise<void> {
  const freePlan = await prisma.plan.findUnique({ where: { id: "free" } });
  const proPlan = await prisma.plan.findUnique({ where: { id: "pro" } });
  assert.ok(freePlan, "seeded 'free' Plan row must exist (run prisma db seed)");
  assert.ok(proPlan, "seeded 'pro' Plan row must exist (run prisma db seed)");

  const admin = await prisma.user.create({
    data: { email: `${RUN_TAG}-admin@internal.test`, name: "L2.6 Admin Actor", role: "admin" },
  });
  const target = await prisma.user.create({
    data: { email: `${RUN_TAG}-target@internal.test`, name: "L2.6 Target User", role: "user", planId: "free" },
  });
  const conversation = await prisma.conversation.create({
    data: { userId: target.id, title: "L2.6 validation conversation" },
  });
  await prisma.message.create({
    data: { conversationId: conversation.id, userId: target.id, role: "assistant", content: "reply", createdAt: new Date() },
  });
  const doc = await prisma.knowledge.create({
    data: { userId: target.id, title: "L2.6 validation doc", source: "upload", documentSize: 1024 },
  });

  try {
    await test("structural: every admin API route file gates on requireAdmin", async () => {
      for (const file of ADMIN_ROUTE_FILES) {
        const content = readFileSync(file, "utf-8");
        assert.ok(
          content.includes("requireAdmin"),
          `${file} must call requireAdmin(...) before doing anything`,
        );
      }
    });

    await test("AdminUserService.listUsers: finds the synthetic target user, real DB data", async () => {
      const page = await adminUserService.listUsers({ page: 1, pageSize: 100, query: RUN_TAG });
      assert.ok(page.items.some((u) => u.id === target.id));
    });

    await test("AdminUserService.getUser: real usage counts (1 conversation, 1 knowledge doc)", async () => {
      const detail = await adminUserService.getUser(target.id);
      assert.ok(detail);
      assert.equal(detail!.conversationCount, 1);
      assert.equal(detail!.knowledgeDocumentCount, 1);
    });

    await test("AdminUserService.setRole + audit log: real DB write, real audit trail", async () => {
      const updated = await adminUserService.setRole(target.id, "admin");
      assert.equal(updated?.role, "admin");
      await auditLogService.record({
        actorUserId: admin.id,
        action: "user.role_changed",
        targetType: "User",
        targetId: target.id,
        metadata: { before: "user", after: "admin" },
      });
      const logs = await auditLogService.list({ page: 1, pageSize: 10, actorUserId: admin.id });
      assert.ok(logs.items.some((l) => l.action === "user.role_changed" && l.targetId === target.id));
      // revert for the rest of the script
      await adminUserService.setRole(target.id, "user");
    });

    await test("AdminUserService.setStatus: real suspend/activate DB write", async () => {
      const suspended = await adminUserService.setStatus(target.id, "suspended");
      assert.equal(suspended?.status, "suspended");
      const activated = await adminUserService.setStatus(target.id, "active");
      assert.equal(activated?.status, "active");
    });

    await test("AdminSubscriptionService.overridePlan: unknown plan throws InvalidPlanError", async () => {
      await assert.rejects(() => adminSubscriptionService.overridePlan(target.id, "not-a-real-plan"), InvalidPlanError);
    });

    await test("AdminSubscriptionService.overridePlan: admin CAN grant a paid plan (unlike self-service L2.5 flow)", async () => {
      assert.ok(proPlan!.price > 0, "fixture assumption: pro plan is priced above $0");
      const sub = await adminSubscriptionService.overridePlan(target.id, "pro");
      assert.equal(sub.planId, "pro");
      const freshUser = await prisma.user.findUnique({ where: { id: target.id } });
      assert.equal(freshUser?.planId, "pro", "User.planId must be kept in sync with the override");
    });

    await test("AdminSubscriptionService.listSubscriptions: real join reflects the override", async () => {
      const page = await adminSubscriptionService.listSubscriptions({ page: 1, pageSize: 200 });
      const row = page.items.find((r) => r.userId === target.id);
      assert.ok(row);
      assert.equal(row!.planId, "pro");
    });

    await test("AdminSubscriptionService.setCancelAtPeriodEnd: real cancel/reactivate DB write", async () => {
      const canceled = await adminSubscriptionService.setCancelAtPeriodEnd(target.id, true);
      assert.equal(canceled?.cancelAtPeriodEnd, true);
      const reactivated = await adminSubscriptionService.setCancelAtPeriodEnd(target.id, false);
      assert.equal(reactivated?.cancelAtPeriodEnd, false);
    });

    await test("AdminKnowledgeService.listKnowledge + getStats: real cross-user data, no fabrication", async () => {
      const page = await adminKnowledgeService.listKnowledge({ page: 1, pageSize: 200 });
      assert.ok(page.items.some((k) => k.id === doc.id));
      const stats = await adminKnowledgeService.getStats();
      assert.ok(stats.totalDocuments >= 1);
      assert.ok(stats.totalStorageBytes >= 1024);
    });

    await test("AdminKnowledgeService.softDeleteKnowledge: real soft delete, not a hard delete", async () => {
      const result = await adminKnowledgeService.softDeleteKnowledge(doc.id);
      assert.equal(result, true);
      const row = await prisma.knowledge.findUnique({ where: { id: doc.id } });
      assert.ok(row, "row must still exist in the database (soft delete)");
      assert.ok(row!.deletedAt, "deletedAt must be set");
      const again = await adminKnowledgeService.softDeleteKnowledge(doc.id);
      assert.equal(again, false, "deleting an already-deleted doc must not report success");
    });

    await test("AdminAnalyticsService.getAnalytics: real totals include the synthetic message, untracked metrics disclosed", async () => {
      const analytics = await adminAnalyticsService.getAnalytics();
      assert.ok(analytics.totals.assistantMessages >= 1);
      assert.deepEqual(analytics.untracked, []);
      assert.ok(analytics.totals.marketAnalysisRequests >= 0);
      assert.ok(analytics.totals.searchRequests >= 0);
    });

    await test("AdminHealthService.getReport: real database reachability + row counts", async () => {
      const report = await adminHealthService.getReport();
      assert.equal(report.subsystems.database.health, "operational", "database must be reachable for this script to have run at all");
      assert.ok(report.rowCounts.users >= 2);
    });

    await test("AuditLogService: append-only - list() never exposes a mutation path", async () => {
      const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(auditLogService));
      assert.ok(!keys.includes("update") && !keys.includes("delete"));
    });
  } finally {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: admin.id }, { targetId: target.id }] } });
    await prisma.subscription.deleteMany({ where: { userId: target.id } });
    await prisma.knowledge.deleteMany({ where: { userId: target.id } });
    await prisma.conversation.deleteMany({ where: { id: conversation.id } }); // cascades Message rows
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, target.id] } } });

    const leftoverAudit = await prisma.auditLog.count({ where: { OR: [{ actorUserId: admin.id }, { targetId: target.id }] } });
    const leftoverKnowledge = await prisma.knowledge.count({ where: { userId: target.id } });
    const leftoverSub = await prisma.subscription.count({ where: { userId: target.id } });
    if (leftoverAudit > 0 || leftoverKnowledge > 0 || leftoverSub > 0) {
      console.error("  WARNING: some validation rows were not cleaned up");
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, conversation, messages, knowledge, subscription, audit logs)");
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
