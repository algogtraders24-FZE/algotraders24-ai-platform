// scripts/validate-automation-lifecycle.ts
// AT24 Automation (MVP) - DB integration suite. DB-touching, house style
// (mirrors scripts/validate-agent-api.ts): synthetic per-process userIds
// that CANNOT collide with a real cuid User id and have no FK to "User", so
// nothing here reads or writes a real user's data. Deterministic cleanup at
// the end (cascade from the automation row).
//
//   npm run validate:automation-lifecycle
//
// Covers AUTOMATION_TEST_PLAN.md §2: create, activate, versioning, lifecycle
// state machine, run creation + scheduled dedup, dispatcher persistence
// (condition + workspace_save - no external side effects), CONDITION_HALTED,
// cancellation, plan limits, template creation.

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { automationService } from "../services/automation/automation-service";
import { automationRepository } from "../services/automation/automation-repository";
import { triggerManualRun, requestRunCancellation } from "../services/automation/run-dispatch";
import { dispatchAutomationRun } from "../services/automation/dispatcher";
import { getRunDetail } from "../services/automation/run-view";
import type { AutomationWorkflowDefinition } from "../types/automation";

const RID = Math.random().toString(36).slice(2, 8);
const U = (s: string) => `validate-automation-lc-${process.pid}-${RID}-${s}`;
const USER = U("owner");

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

const manualDef = (steps: AutomationWorkflowDefinition["steps"]): unknown => ({
  schemaVersion: 1,
  trigger: { type: "manual", timezone: "Asia/Kolkata" },
  steps,
});

// leading, side-effect-free step so a definition never starts with a condition
const save = (id: string, title = "Result"): AutomationWorkflowDefinition["steps"][number] => ({
  id,
  kind: "workspace_save",
  action: { title, from: "$.trigger.firedAt" },
});

async function cleanup(): Promise<void> {
  for (const u of [USER, U("a"), U("b")]) {
    await automationRepository._deleteAllForUser(u).catch(() => {});
  }
}

async function main(): Promise<void> {
  console.log("validate-automation-lifecycle (DB integration)\n");
  await cleanup();

  let autoId = "";
  let v1 = 0;

  await test("create -> DRAFT + v1", async () => {
    const r = await automationService.create({
      userId: USER,
      name: "LC test",
      definition: manualDef([save("s1"), save("s2", "Second")]),
    });
    autoId = r.id;
    v1 = r.version;
    assert.equal(r.status, "DRAFT");
    assert.equal(r.version, 1);
  });

  await test("first step may not be a condition (server-rejected)", async () => {
    await assert.rejects(
      () =>
        automationService.create({
          userId: USER,
          name: "bad",
          definition: manualDef([
            { id: "s1", kind: "condition", condition: { left: "$.trigger.firedAt", op: "neq", right: "" } },
          ]),
        }),
      /invalid/i,
    );
  });

  await test("detail reflects the definition + owner", async () => {
    const d = await automationService.detail(USER, autoId);
    assert.equal(d.owner, USER);
    assert.equal(d.status, "DRAFT");
    assert.equal(d.definition.steps.length, 2);
  });

  await test("edit writes a NEW version, does not touch status", async () => {
    const r = await automationService.update(USER, autoId, {
      definition: manualDef([save("s1", "Only step")]),
    });
    assert.equal(r.version, v1 + 1);
    const d = await automationService.detail(USER, autoId);
    assert.equal(d.status, "DRAFT");
    assert.equal(d.activeVersion, v1 + 1);
  });

  await test("invalid transition DRAFT -> pause -> 409", async () => {
    await assert.rejects(() => automationService.transition(USER, autoId, "pause"), /Cannot transition/);
  });

  await test("activate -> ACTIVE", async () => {
    const r = await automationService.transition(USER, autoId, "activate");
    assert.equal(r.status, "ACTIVE");
  });

  await test("manual run: condition true -> workspace_save -> SUCCEEDED + artifact", async () => {
    await automationService.update(USER, autoId, {
      definition: manualDef([
        save("s1", "Lead"),
        { id: "s2", kind: "condition", condition: { left: "$.trigger.firedAt", op: "neq", right: "" } },
        { id: "s3", kind: "workspace_save", action: { title: "Result", from: "$.trigger.firedAt" } },
      ]),
    });
    const { runId } = await triggerManualRun(USER, autoId);
    const detail = await getRunDetail(USER, runId);
    assert.equal(detail.status, "SUCCEEDED", JSON.stringify(detail.steps));
    assert.equal(detail.steps.length, 3);
    assert.ok(detail.steps.every((s) => s.status === "OK"));
    assert.ok(detail.steps[2].artifactId);
    const arts = await automationRepository.listArtifactsForUser(USER, 10);
    assert.ok(arts.length >= 1);
  });

  await test("manual run: condition false -> CONDITION_HALTED, downstream SKIPPED", async () => {
    await automationService.update(USER, autoId, {
      definition: manualDef([
        save("s1", "Lead"),
        { id: "s2", kind: "condition", condition: { left: "$.trigger.firedAt", op: "eq", right: "definitely-not-this" } },
        { id: "s3", kind: "workspace_save", action: { title: "Should skip", from: "$.trigger.firedAt" } },
      ]),
    });
    const { runId } = await triggerManualRun(USER, autoId);
    const detail = await getRunDetail(USER, runId);
    assert.equal(detail.status, "CONDITION_HALTED");
    assert.equal(detail.steps[0].status, "OK");
    assert.equal(detail.steps[1].status, "OK");
    assert.equal(detail.steps[2].status, "SKIPPED");
    assert.ok(detail.steps[2].reason && detail.steps[2].reason.includes("halted"));
  });

  await test("one active run at a time -> RUN_IN_PROGRESS", async () => {
    // create a QUEUED run directly, then a manual trigger must 409
    const auto = await automationRepository.getAutomationForUser(autoId, USER);
    await automationRepository.createRun({
      automationId: autoId,
      definitionVersionId: auto!.activeVersionId!,
      userId: USER,
      requesterId: USER,
      trigger: "manual",
      scheduledFor: null,
    });
    await assert.rejects(() => triggerManualRun(USER, autoId), /in progress/i);
    // clean the stuck QUEUED run so later tests are unaffected
    await prisma.automationRun.updateMany({ where: { automationId: autoId, status: "QUEUED" }, data: { status: "CANCELLED" } });
  });

  await test("scheduled dedup: same (automationId, scheduledFor) inserted once", async () => {
    const auto = await automationRepository.getAutomationForUser(autoId, USER);
    const slotInstant = new Date("2026-10-06T02:30:00.000Z");
    const first = await automationRepository.createScheduledRunIfAbsent({
      automationId: autoId,
      definitionVersionId: auto!.activeVersionId!,
      userId: USER,
      requesterId: "system:scheduler",
      trigger: "schedule",
      scheduledFor: slotInstant,
    });
    const second = await automationRepository.createScheduledRunIfAbsent({
      automationId: autoId,
      definitionVersionId: auto!.activeVersionId!,
      userId: USER,
      requesterId: "system:scheduler",
      trigger: "schedule",
      scheduledFor: slotInstant,
    });
    assert.ok(first && first.id);
    assert.equal(second, null);
    await prisma.automationRun.deleteMany({ where: { id: first!.id } });
  });

  await test("cancellation: QUEUED run -> CANCELLED immediately", async () => {
    const auto = await automationRepository.getAutomationForUser(autoId, USER);
    const run = await automationRepository.createRun({
      automationId: autoId,
      definitionVersionId: auto!.activeVersionId!,
      userId: USER,
      requesterId: USER,
      trigger: "manual",
      scheduledFor: null,
    });
    const r = await requestRunCancellation(USER, run.id);
    assert.equal(r.status, "CANCELLED");
  });

  await test("cancellation: RUNNING run stops at the next step boundary", async () => {
    await automationService.update(USER, autoId, {
      definition: manualDef([save("s1", "one"), save("s2", "two"), save("s3", "three")]),
    });
    const auto = await automationRepository.getAutomationForUser(autoId, USER);
    const run = await automationRepository.createRun({
      automationId: autoId,
      definitionVersionId: auto!.activeVersionId!,
      userId: USER,
      requesterId: USER,
      trigger: "manual",
      scheduledFor: null,
    });
    await automationRepository.patchRun(run.id, { status: "RUNNING", startedAt: new Date(), cancelRequestedAt: new Date() });
    await dispatchAutomationRun(run.id);
    const detail = await getRunDetail(USER, run.id);
    assert.equal(detail.status, "CANCELLED");
    assert.ok(detail.steps.some((s) => s.status === "SKIPPED"));
  });

  await test("historical run keeps its old definitionVersionId after an edit", async () => {
    const { runId } = await (async () => {
      await automationService.update(USER, autoId, {
        definition: manualDef([save("s1", "vN")]),
      });
      return triggerManualRun(USER, autoId);
    })();
    const before = await prisma.automationRun.findUnique({ where: { id: runId }, select: { definitionVersionId: true } });
    await automationService.update(USER, autoId, {
      definition: manualDef([save("s1", "vNplus1")]),
    });
    const after = await prisma.automationRun.findUnique({ where: { id: runId }, select: { definitionVersionId: true } });
    assert.equal(before!.definitionVersionId, after!.definitionVersionId);
  });

  await test("plan limit: free plan (synthetic user = free) caps at 2 active/draft", async () => {
    const limUser = U("a");
    await automationService.create({ userId: limUser, name: "one", definition: manualDef([save("s1", "x")]) });
    await automationService.create({ userId: limUser, name: "two", definition: manualDef([save("s1", "x")]) });
    await assert.rejects(
      () => automationService.create({ userId: limUser, name: "three", definition: manualDef([save("s1", "x")]) }),
      /Plan limit/,
    );
  });

  await test("createFromTemplate produces a real DRAFT with substituted symbol", async () => {
    const tplUser = U("b");
    const r = await automationService.createFromTemplate(tplUser, "daily-market-brief", { symbol: "EURUSD" });
    assert.equal(r.status, "DRAFT");
    const d = await automationService.detail(tplUser, r.id);
    const agentStep = d.definition.steps.find((s) => s.kind === "agent_run");
    assert.ok(agentStep && agentStep.kind === "agent_run" && agentStep.action.input.symbol === "EURUSD");
  });

  await test("archive is terminal", async () => {
    await automationService.transition(USER, autoId, "archive").catch(() => {});
    const d = await automationService.detail(USER, autoId);
    assert.equal(d.status, "ARCHIVED");
    await assert.rejects(() => automationService.transition(USER, autoId, "activate"), /Cannot transition/);
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
