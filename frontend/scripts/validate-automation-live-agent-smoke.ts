// scripts/validate-automation-live-agent-smoke.ts
// AT24 Automation - LIVE PRODUCTION EXECUTION SMOKE (owner-authorized
// 2026-09-13, ahead of the Migration B decision).
//
// Proves the full chain end-to-end against the REAL production database and
// the REAL (Prisma-backed) credit ledger - no in-memory escape hatch, no
// mocked agent:
//
//   Automation -> AutomationRun -> AutomationStepRun -> AgentRun
//     -> AgentCreditLedgerEntry -> SUCCEEDED
//
// SAFETY (same discipline as validate-marketplace-production-smoke.ts /
// validate-automation-lifecycle.ts): exactly TWO synthetic userIds
// (no FK to "User", cannot collide with a real cuid id), one throwaway
// automation with a single read-only agent_run step (Market Intelligence -
// no publication, no workspace mutation of a real user), deterministic
// cleanup of every row this script creates (Automation cascade, AgentRun
// cascade, AgentCreditLedgerEntry - which has no FK and must be cleaned
// explicitly), verified 0 rows left at the end.
//
// NOT wired into `npm run validate:automation` (it spends real agent
// credits / hits real market-data providers each run) - invoke directly:
//   node --env-file=.env --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/validate-automation-live-agent-smoke.ts

import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { automationService } from "../services/automation/automation-service";
import { automationRepository } from "../services/automation/automation-repository";
import { triggerManualRun } from "../services/automation/run-dispatch";
import { dispatchAutomationRun } from "../services/automation/dispatcher";
import { dispatchSlot } from "../services/automation/run-dispatch";
import { getRunDetail } from "../services/automation/run-view";
import { AUTOMATION_SLOTS, slotInstantForIstDay } from "../config/automation-slots";
import type { AutomationWorkflowDefinition } from "../types/automation";

const RID = Math.random().toString(36).slice(2, 8);
const A = `smoke-automation-live-${process.pid}-${RID}-A`;
const B = `smoke-automation-live-${process.pid}-${RID}-B`;
const MAX_DRIVE_TICKS = 15;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.stack ?? err.message}` : `    ${String(err)}`);
  }
}

const oneStepAgentDef = (trigger: AutomationWorkflowDefinition["trigger"]): unknown => ({
  schemaVersion: 1,
  trigger,
  steps: [
    {
      id: "s1",
      kind: "agent_run",
      action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } },
    },
  ],
});

async function driveToTerminal(runId: string): Promise<void> {
  for (let i = 0; i < MAX_DRIVE_TICKS; i++) {
    const row = await prisma.automationRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!row) return;
    if (["SUCCEEDED", "FAILED", "CONDITION_HALTED", "CANCELLED", "CREDIT_BLOCKED"].includes(row.status)) return;
    await dispatchAutomationRun(runId);
  }
}

async function cleanup(): Promise<{ automations: number; agentRuns: number; ledger: number }> {
  const agentRuns = (await prisma.agentRun.deleteMany({ where: { userId: { in: [A, B] } } })).count;
  const ledger = (await prisma.agentCreditLedgerEntry.deleteMany({ where: { userId: { in: [A, B] } } })).count;
  let automations = 0;
  for (const u of [A, B]) automations += await automationRepository._deleteAllForUser(u).catch(() => 0);
  return { automations, agentRuns, ledger };
}

async function main(): Promise<void> {
  console.log("validate-automation-live-agent-smoke (LIVE production execution)\n");
  await cleanup();

  console.log("=== 1. Create ===");
  let automationId = "";
  let runId = "";

  await test("create the smallest valid scratch automation (1 agent_run step)", async () => {
    const r = await automationService.create({
      userId: A,
      name: "Live smoke - Market Intelligence",
      definition: oneStepAgentDef({ type: "manual", timezone: "Asia/Kolkata" }),
    });
    automationId = r.id;
    assert.equal(r.status, "DRAFT");
    assert.equal(r.version, 1);
    console.log(`    automationId=${automationId} version=${r.version}`);
  });

  console.log("\n=== 2. Activate ===");
  await test("activate -> server state is ACTIVE (re-fetched)", async () => {
    await automationService.transition(A, automationId, "activate");
    const row = await prisma.automation.findUnique({ where: { id: automationId } });
    assert.equal(row?.status, "ACTIVE");
  });

  console.log("\n=== 3. Run now ===");
  await test("POST-equivalent triggerManualRun creates a real AutomationRun", async () => {
    const r = await triggerManualRun(A, automationId);
    runId = r.runId;
    assert.ok(runId);
    const row = await prisma.automationRun.findUnique({ where: { id: runId } });
    assert.ok(row, "AutomationRun row must exist - never manually inserted");
    assert.equal(row!.automationId, automationId);
    assert.equal(row!.userId, A);
    assert.equal(row!.requesterId, A);
    assert.equal(row!.trigger, "manual");
  });

  await driveToTerminal(runId);

  console.log("\n=== 4. Verify real execution chain ===");
  let childAgentRunId: string | null = null;
  let stepCredits = 0;
  let runCredits = 0;

  await test("AutomationRun reached SUCCEEDED with correct version + timing", async () => {
    const run = await prisma.automationRun.findUnique({ where: { id: runId } });
    assert.ok(run);
    console.log(`    status=${run!.status} durationMs=${run!.durationMs} creditsUsed=${run!.creditsUsed}`);
    assert.equal(run!.status, "SUCCEEDED", `run did not succeed: ${JSON.stringify(run!.error)}`);
    assert.ok(run!.durationMs != null && run!.durationMs >= 0);
    assert.ok(run!.startedAt && run!.completedAt);
    const version = await prisma.automationDefinitionVersion.findUnique({ where: { id: run!.definitionVersionId } });
    assert.equal(version?.automationId, automationId);
    runCredits = run!.creditsUsed;
  });

  await test("exactly one AutomationStepRun, server-produced status OK, with a real child agentRunId", async () => {
    const steps = await prisma.automationStepRun.findMany({ where: { automationRunId: runId }, orderBy: { index: "asc" } });
    assert.equal(steps.length, 1);
    const s = steps[0];
    console.log(`    step: kind=${s.kind} status=${s.status} agentRunId=${s.agentRunId} creditsUsed=${s.creditsUsed} durationMs=${s.durationMs}`);
    assert.equal(s.kind, "agent_run");
    assert.equal(s.status, "OK");
    assert.ok(s.agentRunId, "agent_run step must record the child AgentRun id");
    assert.ok(s.durationMs != null && s.durationMs >= 0);
    assert.ok(s.startedAt && s.completedAt);
    childAgentRunId = s.agentRunId;
    stepCredits = s.creditsUsed;
  });

  await test("the child AgentRun exists, belongs to the test owner, and actually executed", async () => {
    const agentRun = await prisma.agentRun.findUnique({ where: { id: childAgentRunId! } });
    assert.ok(agentRun, "child AgentRun must be a real persisted row");
    console.log(`    AgentRun: id=${agentRun!.id} status=${agentRun!.status} trigger=${agentRun!.trigger} creditsConsumed=${agentRun!.creditsConsumed}`);
    assert.equal(agentRun!.userId, A);
    assert.equal(agentRun!.status, "succeeded");
    assert.equal(agentRun!.trigger, "schedule"); // AT24 Automation always drives child runs with trigger="schedule"
    const steps = await prisma.agentStep.count({ where: { runId: childAgentRunId! } });
    assert.ok(steps > 0, "the agent must have taken at least one real planning/tool/output step");
  });

  await test("credits: AutomationRun == AutomationStepRun == sum(AgentCreditLedgerEntry) - no double charge", async () => {
    const entries = await prisma.agentCreditLedgerEntry.findMany({ where: { runId: childAgentRunId! } });
    const ledgerSum = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    console.log(`    ledger entries=${entries.length} sum=${ledgerSum} | step=${stepCredits} | run=${runCredits}`);
    assert.equal(stepCredits, ledgerSum);
    assert.equal(runCredits, ledgerSum);
    // idempotency: no duplicate idempotencyKey (would violate the unique
    // constraint at write time, but assert distinctness explicitly too)
    const keys = new Set(entries.map((e) => e.idempotencyKey));
    assert.equal(keys.size, entries.length, "no duplicate ledger idempotencyKey - no double charge");
  });

  await test("Run Detail read model shows the persisted execution (not a client-fabricated status)", async () => {
    const detail = await getRunDetail(A, runId);
    assert.equal(detail.status, "SUCCEEDED");
    assert.equal(detail.steps.length, 1);
    assert.equal(detail.steps[0].status, "OK");
    assert.equal(detail.steps[0].agentRunId, childAgentRunId);
    assert.equal(detail.creditsUsed, runCredits);
  });

  console.log("\n=== 5. Negative / authorization smoke ===");
  await test("user B cannot read user A's automation or run (404, no existence leak)", async () => {
    await assert.rejects(() => automationService.detail(B, automationId), /not found/i);
    await assert.rejects(() => getRunDetail(B, runId), /not found/i);
  });

  console.log("\n=== 6. Scheduled dispatch observation ===");
  const now = new Date();
  const nextSlot = pickNextSlot(now);
  let scheduledRunId = "";
  await test(`edit to a daily trigger on the next slot (${nextSlot.id}) - ACTIVE unaffected`, async () => {
    const r = await automationService.update(A, automationId, {
      definition: oneStepAgentDef({ type: "daily", timezone: "Asia/Kolkata", slot: nextSlot.id }),
    });
    assert.equal(r.version, 2);
    const row = await prisma.automation.findUnique({ where: { id: automationId } });
    assert.equal(row?.status, "ACTIVE");
  });

  await test("dispatchSlot (the exact function the cron route calls) creates exactly one scheduled run at the right instant", async () => {
    const expectedInstant = slotInstantForIstDay(nextSlot, now);
    const result = await dispatchSlot(nextSlot.id, now);
    console.log(`    dispatchSlot -> dispatched=${result.dispatched} resumed=${result.resumed} skipped=${JSON.stringify(result.skipped)}`);
    const runs = await prisma.automationRun.findMany({ where: { automationId, trigger: "schedule" } });
    assert.equal(runs.length, 1, "exactly one scheduled AutomationRun must exist");
    scheduledRunId = runs[0].id;
    assert.equal(runs[0].scheduledFor?.toISOString(), expectedInstant.toISOString());
  });

  await test("a second dispatch pass for the same slot instant does NOT duplicate the run (unique constraint)", async () => {
    await dispatchSlot(nextSlot.id, now);
    const runs = await prisma.automationRun.findMany({ where: { automationId, trigger: "schedule" } });
    assert.equal(runs.length, 1, "retry must not create a second run for the same (automationId, scheduledFor)");
  });

  await driveToTerminal(scheduledRunId);

  await test("the scheduled run reaches a terminal state", async () => {
    const run = await prisma.automationRun.findUnique({ where: { id: scheduledRunId } });
    console.log(`    scheduled run status=${run?.status}`);
    assert.ok(["SUCCEEDED", "FAILED", "CREDIT_BLOCKED"].includes(run!.status));
  });

  console.log("\n=== cleanup ===");
  const removed = await cleanup();
  console.log(`  removed: automations=${removed.automations} agentRuns=${removed.agentRuns} ledgerEntries=${removed.ledger}`);

  await test("0 synthetic rows remain in production", async () => {
    const a = await prisma.automation.count({ where: { userId: { in: [A, B] } } });
    const ar = await prisma.agentRun.count({ where: { userId: { in: [A, B] } } });
    const led = await prisma.agentCreditLedgerEntry.count({ where: { userId: { in: [A, B] } } });
    assert.equal(a, 0);
    assert.equal(ar, 0);
    assert.equal(led, 0);
  });

  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

function pickNextSlot(now: Date) {
  // Both are `daily` slots; either is a valid "next" proof. Pick whichever
  // this IST calendar day's instant is closer to `now` going forward, else
  // the one whose instant already passed least recently today.
  const withDelta = AUTOMATION_SLOTS.map((s) => ({ s, delta: slotInstantForIstDay(s, now).getTime() - now.getTime() }));
  const upcoming = withDelta.filter((x) => x.delta >= 0).sort((a, b) => a.delta - b.delta);
  if (upcoming.length) return upcoming[0].s;
  return withDelta.sort((a, b) => b.delta - a.delta)[0].s; // most recently passed
}

main().catch(async (err) => {
  console.error("Live smoke crashed:", err);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
