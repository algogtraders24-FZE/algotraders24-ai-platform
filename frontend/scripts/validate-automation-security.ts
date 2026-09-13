// scripts/validate-automation-security.ts
// AT24 Automation (MVP) - security / tenant-isolation suite.
//
// Strongest-safe approach (per owner testing directive):
//   * synthetic per-process userIds only - no FK to "User", cannot collide
//     with a real cuid id; deterministic cascade cleanup at the end.
//   * NEVER modifies or deletes a real user record to exercise authorization.
//   * structural (grep) assertions on the route + service source for the
//     "no client-trusted userId" and "no legacy-agent import" locks.
//
//   npm run validate:automation-security
//
// Covers AUTOMATION_TEST_PLAN.md §3.

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "../lib/prisma";
import { automationService } from "../services/automation/automation-service";
import { automationRepository } from "../services/automation/automation-repository";
import {
  triggerManualRun,
  requestRunCancellation,
  dispatchSlot,
} from "../services/automation/run-dispatch";
import { getRunDetail, listAutomationRuns } from "../services/automation/run-view";
import { slotDispatchRoute } from "../services/automation/cron-route";
import { isValidCronSecret } from "../lib/intelligence/cron-auth";
import type { AutomationWorkflowDefinition } from "../types/automation";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RID = Math.random().toString(36).slice(2, 8);
const A = `validate-automation-sec-${process.pid}-${RID}-A`;
const B = `validate-automation-sec-${process.pid}-${RID}-B`;

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

const def = (): unknown => ({
  schemaVersion: 1,
  trigger: { type: "manual", timezone: "Asia/Kolkata" },
  steps: [{ id: "s1", kind: "workspace_save", action: { title: "x", from: "$.trigger.firedAt" } }],
} satisfies { schemaVersion: 1; trigger: AutomationWorkflowDefinition["trigger"]; steps: unknown });

async function cleanup(): Promise<void> {
  for (const u of [A, B]) await automationRepository._deleteAllForUser(u).catch(() => {});
}

async function main(): Promise<void> {
  console.log("validate-automation-security\n");
  await cleanup();

  // A owns an automation + a run; B owns nothing.
  const ownedByA = await automationService.create({ userId: A, name: "A's automation", definition: def() });
  await automationService.transition(A, ownedByA.id, "activate");
  const runA = await triggerManualRun(A, ownedByA.id);

  await test("created row's userId is exactly the caller's arg (no body override path)", async () => {
    const row = await prisma.automation.findUnique({ where: { id: ownedByA.id }, select: { userId: true } });
    assert.equal(row?.userId, A);
    const runRow = await prisma.automationRun.findUnique({ where: { id: runA.runId }, select: { userId: true, requesterId: true } });
    assert.equal(runRow?.userId, A);
    assert.equal(runRow?.requesterId, A);
  });

  await test("user B cannot READ user A's automation (404, no existence leak)", async () => {
    await assert.rejects(() => automationService.detail(B, ownedByA.id), /not found/i);
  });

  await test("user B cannot EDIT user A's automation", async () => {
    await assert.rejects(() => automationService.update(B, ownedByA.id, { name: "hijacked" }), /not found/i);
    const row = await prisma.automation.findUnique({ where: { id: ownedByA.id }, select: { name: true } });
    assert.equal(row?.name, "A's automation");
  });

  await test("user B cannot TRANSITION user A's automation", async () => {
    await assert.rejects(() => automationService.transition(B, ownedByA.id, "archive"), /not found/i);
  });

  await test("user B cannot RUN user A's automation", async () => {
    await assert.rejects(() => triggerManualRun(B, ownedByA.id), /not found/i);
  });

  await test("user B cannot LIST user A's automation runs", async () => {
    await assert.rejects(() => listAutomationRuns(B, ownedByA.id), /not found/i);
  });

  await test("user B cannot READ user A's run detail (404)", async () => {
    await assert.rejects(() => getRunDetail(B, runA.runId), /not found/i);
  });

  await test("user B cannot CANCEL user A's run (404)", async () => {
    await assert.rejects(() => requestRunCancellation(B, runA.runId), /not found/i);
  });

  await test("user A's automation does not appear in user B's list", async () => {
    const list = await automationService.list(B, { includeArchived: true });
    assert.ok(!list.some((x) => x.id === ownedByA.id));
  });

  await test("isValidCronSecret rejects missing / wrong bearer", () => {
    assert.equal(isValidCronSecret(new Request("https://x/c")), false);
    assert.equal(
      isValidCronSecret(new Request("https://x/c", { headers: { authorization: "Bearer wrong-secret" } })),
      false,
    );
  });

  await test("cron dispatch route never dispatches without a valid cron secret", async () => {
    // In a real HTTP request the admin fallback returns 401; in this bare
    // script context cookies() is unavailable so withContext maps the thrown
    // error to 500. Either way: NOT 200, an error envelope, and no dispatch.
    const { GET } = slotDispatchRoute("morning_ist");
    for (const headers of [undefined, { authorization: "Bearer definitely-not-the-cron-secret" }]) {
      const res = await GET(new Request("https://x/api/private/automations/cron/dispatch/morning-ist", { headers }));
      assert.notEqual(res.status, 200, `unauthenticated cron call returned ${res.status}`);
      const body = (await res.json()) as { status: string };
      assert.equal(body.status, "error");
    }
  });

  await test("dispatchSlot only ever runs ACTIVE automations for the exact slot", async () => {
    // A's automation is manual-trigger -> must never be picked up by a slot pass
    const result = await dispatchSlot("morning_ist", new Date());
    assert.equal(typeof result.dispatched, "number");
    // no run was created for A's manual automation
    const runs = await automationRepository.listRunsForAutomation(ownedByA.id, A, 50);
    assert.ok(runs.every((r) => r.trigger === "manual"));
  });

  // ── structural locks ──
  await test("no file under services/automation/** reads a client-supplied userId", () => {
    const bad = /\b(body|req|request|payload|json)\.userId\b|searchParams\.get\(['"]userId['"]\)|params\.userId/;
    for (const f of walk(join(ROOT, "services", "automation"))) {
      const src = readFileSync(f, "utf8");
      assert.ok(!bad.test(src), `${f} appears to read a client-supplied userId`);
    }
  });

  await test("no automation API route reads a client-supplied userId", () => {
    const bad = /\b(body|req|request|payload|json)\.userId\b|searchParams\.get\(['"]userId['"]\)/;
    for (const dir of ["automations", "automation-runs"]) {
      for (const f of walk(join(ROOT, "app", "api", "private", dir))) {
        const src = readFileSync(f, "utf8");
        assert.ok(!bad.test(src), `${f} appears to read a client-supplied userId`);
        assert.ok(src.includes("getUserOrNull") || src.includes("route-helpers") || src.includes("cron-route"), `${f} has no session gate`);
      }
    }
  });

  await test("the dispatcher runs child AgentRuns as the automation OWNER", () => {
    const src = readFileSync(join(ROOT, "services", "automation", "dispatcher.ts"), "utf8");
    assert.ok(/userId:\s*x\.userId/.test(src), "agent_run step must pass the owner userId to startAgentRun");
    assert.ok(/trigger:\s*"schedule"/.test(src), "child AgentRun trigger should be 'schedule'");
  });

  await test("automation code never imports the frozen legacy agent layer", () => {
    for (const f of walk(join(ROOT, "services", "automation"))) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/from ["']@\/services\/agents\//.test(src), `${f} imports the frozen legacy services/agents/*`);
    }
  });

  await test("publication_draft path has no publish/schedule capability", () => {
    const src = readFileSync(join(ROOT, "services", "automation", "dispatcher.ts"), "utf8");
    assert.ok(src.includes("articleService.createDraft"), "publication_draft must go through createDraft");
    assert.ok(!/articleService\.(publish|schedule|update)\b/.test(src), "automation must not publish/schedule/edit articles");
  });

  await test("cron route auth = cron secret OR admin (ingest-news precedent)", () => {
    const src = readFileSync(join(ROOT, "services", "automation", "cron-route.ts"), "utf8");
    assert.ok(src.includes("isValidCronSecret"), "must check isValidCronSecret");
    assert.ok(src.includes("requireAdmin"), "must fall back to requireAdmin");
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
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
