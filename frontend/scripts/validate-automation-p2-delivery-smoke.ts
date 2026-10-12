// scripts/validate-automation-p2-delivery-smoke.ts
// AT24 Automation Phase 2 - LIVE delivery smoke against the REAL production DB
// and the REAL (Prisma-backed) credit ledger, with a REAL Market Intelligence
// agent run. Proves the part that matters to a user:
//
//   template -> activate -> run -> readable result -> saved result -> bell
//
// SAFETY (same discipline as validate-automation-live-agent-smoke.ts): two
// synthetic userIds (no FK to "User"), ONE throwaway automation made from the
// real "Daily Market Brief" template, read-only agent (no publication), every
// row removed afterwards (Automation cascade, AgentRun cascade, ledger entries,
// notifications) and verified 0 left. Spends ~5 agent credits of the synthetic
// user and one market-data call - NOT wired into `validate:automation`.
//
//   node --conditions=react-server -r tsx/cjs --env-file=.env --env-file=.env.local scripts/validate-automation-p2-delivery-smoke.ts

import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { automationService } from "../services/automation/automation-service";
import { automationRepository } from "../services/automation/automation-repository";
import { triggerManualRun } from "../services/automation/run-dispatch";
import { dispatchAutomationRun } from "../services/automation/dispatcher";
import { getRunDetail } from "../services/automation/run-view";
import { getLatestResults } from "../services/automation/results";

const RID = Math.random().toString(36).slice(2, 8);
const A = `smoke-automation-p2-${process.pid}-${RID}-A`;
const B = `smoke-automation-p2-${process.pid}-${RID}-B`;

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
    console.error(err instanceof Error ? `    ${err.stack ?? err.message}` : `    ${String(err)}`);
  }
}

async function cleanup(): Promise<{ automations: number; agentRuns: number; ledger: number; notifications: number }> {
  const agentRuns = (await prisma.agentRun.deleteMany({ where: { userId: { in: [A, B] } } })).count;
  const ledger = (await prisma.agentCreditLedgerEntry.deleteMany({ where: { userId: { in: [A, B] } } })).count;
  const notifications = (await prisma.userNotification.deleteMany({ where: { userId: { in: [A, B] } } })).count;
  let automations = 0;
  for (const u of [A, B]) automations += await automationRepository._deleteAllForUser(u).catch(() => 0);
  return { automations, agentRuns, ledger, notifications };
}

async function main(): Promise<void> {
  console.log("validate-automation-p2-delivery-smoke (LIVE, real Market Intelligence run)\n");
  await cleanup();

  let automationId = "";
  let runId = "";

  await test("create from the real Daily Market Brief template (XAUUSD) and activate", async () => {
    const r = await automationService.createFromTemplate(A, "daily-market-brief", { symbol: "XAUUSD" });
    automationId = r.id;
    await automationService.transition(A, automationId, "activate");
    const d = await automationService.detail(A, automationId);
    assert.equal(d.status, "ACTIVE");
    assert.deepEqual(d.definition.delivery?.channels, ["bell", "telegram", "push"]);
  });

  await test("Run now -> SUCCEEDED with a real child agent run", async () => {
    const r = await triggerManualRun(A, automationId);
    runId = r.runId;
    for (let i = 0; i < 15; i++) {
      const row = await prisma.automationRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (row && ["SUCCEEDED", "FAILED", "CONDITION_HALTED", "CANCELLED", "CREDIT_BLOCKED"].includes(row.status)) break;
      await dispatchAutomationRun(runId);
    }
    const row = await prisma.automationRun.findUnique({ where: { id: runId } });
    assert.equal(row?.status, "SUCCEEDED", JSON.stringify(row?.error));
  });

  await test("Run Detail shows the agent's actual conclusion (not just a status)", async () => {
    const d = await getRunDetail(A, runId);
    const agent = d.steps.find((s) => s.kind === "agent_run");
    assert.ok(agent?.brief && !agent.brief.empty, "agent step must carry a readable brief");
    console.log(`    brief: ${agent!.brief!.headline}`);
    assert.ok(agent!.brief!.headline.startsWith("XAUUSD"));
    assert.ok(agent!.brief!.lines.length > 0);
    assert.ok(agent!.brief!.disclaimer);
  });

  await test("the saved result is the Market Intelligence conclusion (the template defect is gone)", async () => {
    const results = await getLatestResults(A, 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].brief.kind, "market-intelligence-conclusion");
    assert.equal(results[0].runId, runId);
  });

  await test("delivered to the user's bell with a link to the run; unlinked Telegram/push stayed silent", async () => {
    const run = await prisma.automationRun.findUnique({ where: { id: runId }, select: { contextSnapshot: true } });
    const snap = run?.contextSnapshot as { delivery?: { status: string; channels: Record<string, unknown> } } | null;
    assert.equal(snap?.delivery?.status, "delivered");
    assert.equal(snap?.delivery?.channels.bell, true);
    assert.ok(!snap?.delivery?.channels.telegram && !snap?.delivery?.channels.push);
    const notes = await prisma.userNotification.findMany({ where: { userId: A } });
    assert.equal(notes.length, 1, "exactly one notification - never duplicated");
    assert.equal(notes[0].href, `/dashboard/automation/runs/${runId}`);
    assert.ok(notes[0].body.startsWith("XAUUSD"));
  });

  await test("a second finalize attempt does not notify again", async () => {
    await dispatchAutomationRun(runId); // terminal run -> no-op
    assert.equal(await prisma.userNotification.count({ where: { userId: A } }), 1);
  });

  await test("credits: run == step == sum(ledger), no double charge", async () => {
    const step = await prisma.automationStepRun.findFirst({ where: { automationRunId: runId, kind: "agent_run" } });
    assert.ok(step?.agentRunId);
    const entries = await prisma.agentCreditLedgerEntry.findMany({ where: { runId: step!.agentRunId! } });
    const sum = Math.round(entries.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    const run = await prisma.automationRun.findUnique({ where: { id: runId }, select: { creditsUsed: true } });
    console.log(`    ledger=${sum} step=${step!.creditsUsed} run=${run!.creditsUsed}`);
    assert.equal(step!.creditsUsed, sum);
    assert.equal(run!.creditsUsed, sum);
    assert.equal(new Set(entries.map((e) => e.idempotencyKey)).size, entries.length);
  });

  await test("another user sees none of it (results, run, notifications)", async () => {
    assert.equal((await getLatestResults(B, 5)).length, 0);
    await assert.rejects(() => getRunDetail(B, runId), /not found/i);
    assert.equal(await prisma.userNotification.count({ where: { userId: B } }), 0);
  });

  console.log("\n=== cleanup ===");
  const removed = await cleanup();
  console.log(`  removed: ${JSON.stringify(removed)}`);
  await test("0 synthetic rows remain in production", async () => {
    assert.equal(await prisma.automation.count({ where: { userId: { in: [A, B] } } }), 0);
    assert.equal(await prisma.agentRun.count({ where: { userId: { in: [A, B] } } }), 0);
    assert.equal(await prisma.agentCreditLedgerEntry.count({ where: { userId: { in: [A, B] } } }), 0);
    assert.equal(await prisma.userNotification.count({ where: { userId: { in: [A, B] } } }), 0);
  });

  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Smoke crashed:", err);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
