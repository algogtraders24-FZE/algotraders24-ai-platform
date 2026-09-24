// scripts/validate-support-ticket-received-email.ts
// Email audit follow-up (2026-09-24) - the buyer's own "we received your
// ticket" confirmation, closing the one-sided gap where only ops got
// emailed on ticket creation (reply/resolved already emailed the buyer;
// creation didn't). Standalone validation against the REAL database (no
// test framework in this project - see package.json), same convention as
// validate-payment-hardening.ts. Run via `npm run validate:support-ticket-
// received-email`.
//
// Deliberately does NOT reuse validate-support-handoff.ts's existing
// fixtures - that file's TEST_USER is never backed by a real `User` row
// (its own tests never need one), so handoff-service's `prisma.user.
// findUnique` lookup for the email recipient would always resolve to null
// there, silently skipping both the existing ops alert AND this new email
// in every one of its cases. This script creates a real User (and a
// minimal real AgentRun, since SupportHandoff.agentRunId is a genuine FK,
// not a plain string) specifically so the email path is actually exercised.
//
// Safety: every fixture is tagged with one run-unique string and hard-
// deleted in a `finally` block (each step independently caught) regardless
// of pass/fail.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { ensureSupportHandoff } from "../services/support/handoff-service";

const RUN_TAG = `supportemail-${Date.now()}`;

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
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Support Email Validation User", planId: "free" } });
  const run = await prisma.agentRun.create({
    data: {
      agentId: "support",
      agentVersion: "v1",
      userId: user.id,
      status: "succeeded",
      input: { question: "validation fixture" },
      limits: {},
    },
  });

  let handoffId = "";

  try {
    await test("ensureSupportHandoff: a real ticket creation writes both a support_ticket_opened_alert (ops) AND a support_ticket_received (buyer) EmailLog row", async () => {
      const before = Date.now();
      const handoff = await ensureSupportHandoff({
        userId: user.id,
        conversationId: `conv-${RUN_TAG}`,
        triggerSource: "USER_REQUEST",
        reason: "validation fixture",
        agentRunId: run.id,
      });
      handoffId = handoff.id;

      const opsLog = await prisma.emailLog.findFirst({ where: { type: "support_ticket_opened_alert", dedupeKey: handoff.id, sentAt: { gte: new Date(before) } } });
      assert.ok(opsLog, "the existing ops alert must still fire unchanged");

      const buyerLog = await prisma.emailLog.findFirst({ where: { type: "support_ticket_received", dedupeKey: handoff.id, sentAt: { gte: new Date(before) } } });
      assert.ok(buyerLog, "a support_ticket_received EmailLog row must exist for the buyer");
      assert.equal(buyerLog!.recipientEmail, user.email, "the buyer confirmation must go to the actual requester, not ops");
      assert.equal(buyerLog!.status, "SKIPPED", "no RESEND_API_KEY in this environment - dispatch takes its honest SKIPPED path, never a fake SENT");
    });

    await test("ensureSupportHandoff: re-invoking on the SAME active conversation reuses the ticket, does not send a second buyer confirmation", async () => {
      const before = Date.now();
      const handoff = await ensureSupportHandoff({
        userId: user.id,
        conversationId: `conv-${RUN_TAG}`,
        triggerSource: "USER_REQUEST",
        reason: "validation fixture - second call",
        agentRunId: run.id,
      });
      assert.equal(handoff.id, handoffId, "must reuse the same active handoff, not create a second ticket");

      const buyerLog = await prisma.emailLog.findFirst({ where: { type: "support_ticket_received", dedupeKey: handoff.id, sentAt: { gte: new Date(before) } } });
      assert.equal(buyerLog, null, "no new confirmation email on a reused/duplicate ticket - it was already sent on the first, real creation");
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

    await safeDelete("support_handoff_messages+support_handoffs", async () => {
      const handoffs = await prisma.supportHandoff.findMany({ where: { userId: user.id }, select: { id: true } });
      const ids = handoffs.map((h) => h.id);
      if (ids.length > 0) {
        await prisma.supportHandoffMessage.deleteMany({ where: { handoffId: { in: ids } } });
        await prisma.supportHandoff.deleteMany({ where: { id: { in: ids } } });
      }
    });
    await safeDelete("agent_runs", () => prisma.agentRun.deleteMany({ where: { id: run.id } }));
    await safeDelete("email_logs", () =>
      prisma.emailLog.deleteMany({ where: { recipientEmail: { in: [user.email, "support@algotraders24.ai"] }, sentAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } } }),
    );
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
