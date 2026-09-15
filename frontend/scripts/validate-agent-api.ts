// scripts/validate-agent-api.ts
// Sprint AN, step A15 - Agents UI/API integration (G15).
//
// House style. DB-touching (real A3 rows under per-process users).
//   node --env-file=.env.local --env-file=.env node_modules/tsx/dist/cli.mjs scripts/validate-agent-api.ts
//   (npm run validate:agent-api)
//
// A15 wires /dashboard/agents to the REAL A1-A14 framework. This suite
// proves the API-facing SERVICE seam + the route files' security posture:
//
//   - the service selects a canonical definition and DELEGATES to the shared
//     agentRuntime - it reimplements no runtime / planner / authorization
//   - userId is the caller's argument (from the server session in the route)
//     - a `userId` inside the goal body is ignored
//   - execution stays bounded + resumable: startAgentRun only queues;
//     each advanceAgentRun drives exactly one tick() (a small bounded number
//     of new steps), and is a no-op once terminal
//   - EVERY requester-facing read/advance is ownership-scoped: user B can
//     neither read nor advance user A's run, and it does not appear in B's
//     list (same "not found" as a nonexistent run - no existence leak)
//   - the observability model the API returns is real persisted state
//   - the route files use getUserOrNull + sessionUser.profile.id, never a
//     body userId, and import no second runtime / planner / authorizer / LLM

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import {
  startAgentRun,
  advanceAgentRun,
  getAgentRun,
  listAgentRuns,
  listRunnableAgentTypes,
  isRunnableAgentType,
  UnknownAgentTypeError,
  RUNNABLE_AGENT_TYPES,
} from "../services/agent-framework/api/agent-run-service";
import { isTerminalRunStatus } from "../types/agent-framework/index";
import { prisma } from "../lib/prisma";

const RID = Math.random().toString(36).slice(2, 8);
const USER_A = `validate-agent-api-${process.pid}-${RID}-A`;
const USER_B = `validate-agent-api-${process.pid}-${RID}-B`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(USER_A);
  await agentRunRepository._deleteRunsForUser(USER_B);
}

/** Drive a run to terminal the way the client loop does, one bounded advance
 *  at a time, asserting each advance adds only a small bounded number of
 *  steps (never runs the whole agent). */
async function driveBounded(user: string, runId: string): Promise<NonNullable<Awaited<ReturnType<typeof advanceAgentRun>>>> {
  let last!: NonNullable<Awaited<ReturnType<typeof advanceAgentRun>>>;
  let prevSteps = 0;
  for (let i = 0; i < 30; i++) {
    const res = await advanceAgentRun(user, runId);
    assert.ok(res, "owner can advance");
    const steps = res.observability.steps.length;
    assert.ok(steps - prevSteps <= 3, `advance ${i} added ${steps - prevSteps} steps - a single advance must be bounded`);
    prevSteps = steps;
    last = res;
    if (res.terminal) break;
  }
  assert.ok(last.terminal, "run reached a terminal state within a bounded number of advances");
  return last;
}

async function main(): Promise<void> {
  console.log("\nAN1.17 - Agent API / UI integration (A15) validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. agent type surface
  // ----------------------------------------------------------------

  await test("runnable types: exactly the 4 agents with a real definition, with display metadata", () => {
    const types = listRunnableAgentTypes();
    assert.deepEqual(types.map((t) => t.type).sort(), ["MARKET_INTELLIGENCE", "RESEARCH", "STRATEGY_RESEARCH", "SUPPORT"]);
    for (const t of types) {
      assert.ok(t.label && t.description && t.goalHint, `${t.type} has display metadata`);
      assert.ok(Array.isArray(t.defaultTools) && t.defaultTools.length >= 1);
      assert.equal(t.autonomyCap, 1);
    }
    assert.deepEqual([...RUNNABLE_AGENT_TYPES].sort(), ["MARKET_INTELLIGENCE", "RESEARCH", "STRATEGY_RESEARCH", "SUPPORT"]);
  });

  await test("unknown / not-yet-runnable agent types are rejected with a clear message", async () => {
    assert.equal(isRunnableAgentType("RESEARCH"), true);
    assert.equal(isRunnableAgentType("RISK"), false); // registered but no definition
    assert.equal(isRunnableAgentType("nonsense"), false);
    await assert.rejects(
      startAgentRun({ userId: USER_A, agentType: "RISK", goal: {} }),
      (e: unknown) => e instanceof UnknownAgentTypeError && /no runnable definition yet/.test((e as Error).message),
    );
    await assert.rejects(
      startAgentRun({ userId: USER_A, agentType: "nonsense", goal: {} }),
      (e: unknown) => e instanceof UnknownAgentTypeError && /unknown agent type/.test((e as Error).message),
    );
  });

  // ----------------------------------------------------------------
  // 2. startAgentRun only queues; userId is the caller's, not the body's
  // ----------------------------------------------------------------

  await test("startAgentRun creates a QUEUED run (no execution) with the canonical definition", async () => {
    const { runId } = await startAgentRun({ userId: USER_A, agentType: "RESEARCH", goal: { question: "isolation probe" } });
    const row = await agentRunRepository.getRun(runId);
    assert.equal(row!.status, "queued", "no execution happens in startAgentRun");
    assert.equal(row!.userId, USER_A);
    assert.equal((row!.metadata as { definition?: { type?: string } }).definition?.type, "RESEARCH");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.steps.length, 0, "a queued run has no steps yet");
  });

  await test("a `userId` inside the goal body is IGNORED - the run belongs to the caller's id", async () => {
    const { runId } = await startAgentRun({
      userId: USER_A,
      agentType: "RESEARCH",
      goal: { userId: USER_B, requesterId: USER_B, question: "who owns me" },
    });
    const row = await agentRunRepository.getRun(runId);
    assert.equal(row!.userId, USER_A, "goal.userId must not override the session user");
  });

  // ----------------------------------------------------------------
  // 3. bounded + resumable advance
  // ----------------------------------------------------------------

  await test("advanceAgentRun: one bounded slice per call; terminal state reached; then a no-op", async () => {
    const { runId } = await startAgentRun({ userId: USER_A, agentType: "RESEARCH", goal: { question: "bounded advance", symbol: "XAUUSD" } });
    const last = await driveBounded(USER_A, runId);
    assert.ok(["succeeded", "tool_error"].includes(last.observability.run!.status), `terminal status ${last.observability.run!.status}`);

    // a further advance on a terminal run is a no-op
    const noop = await advanceAgentRun(USER_A, runId);
    assert.ok(noop);
    assert.equal(noop!.advanced, false, "advancing a terminal run does nothing");
    assert.equal(noop!.terminal, true);
    assert.equal(noop!.observability.steps.length, last.observability.steps.length, "no new steps");
  });

  // ----------------------------------------------------------------
  // 4. ownership isolation - the security core of A15
  // ----------------------------------------------------------------

  await test("ownership: user B cannot read, advance, or list user A's run", async () => {
    const { runId } = await startAgentRun({ userId: USER_A, agentType: "MARKET_INTELLIGENCE", goal: { symbol: "XAUUSD" } });
    await driveBounded(USER_A, runId);

    assert.equal(await getAgentRun(USER_B, runId), null, "B cannot read A's run (same as not-found)");
    assert.equal(await advanceAgentRun(USER_B, runId), null, "B cannot advance A's run");
    assert.ok(await getAgentRun(USER_A, runId), "A can read its own run");

    const aList = await listAgentRuns(USER_A);
    const bList = await listAgentRuns(USER_B);
    assert.ok(aList.some((r) => r.runId === runId), "A's run is in A's list");
    assert.ok(!bList.some((r) => r.runId === runId), "A's run is NOT in B's list");
  });

  // ----------------------------------------------------------------
  // 5. the observability model is real persisted state
  // ----------------------------------------------------------------

  await test("getAgentRun returns real persisted state: status / timeline / toolCalls / evidence / output / evaluation / credits", async () => {
    const { runId } = await startAgentRun({ userId: USER_A, agentType: "RESEARCH", goal: { question: "shape check", symbol: "XAUUSD" } });
    await driveBounded(USER_A, runId);
    const obs = await getAgentRun(USER_A, runId);
    assert.ok(obs);
    for (const k of ["run", "steps", "toolCalls", "evidence", "credits", "evaluation", "timeline"]) {
      assert.ok(k in obs!, `observability.${k}`);
    }
    assert.equal(obs!.run!.id, runId);
    assert.equal(obs!.timeline.length, obs!.steps.length);
    assert.ok("totalCharged" in obs!.credits);
    if (obs!.run!.status === "succeeded") {
      assert.ok(obs!.evaluation, "a succeeded run has a persisted evaluation");
      assert.ok(obs!.run!.output != null, "a succeeded run has a persisted output");
      assert.ok(obs!.toolCalls.length >= 1);
    }
    // cross-check: the raw trace agrees with the API model
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(obs!.steps.length, trace.steps.length);
    assert.equal(obs!.evidence.length, trace.evidence.length);
  });

  // ----------------------------------------------------------------
  // 6. structural - the route files' security posture
  // ----------------------------------------------------------------

  await test("structural: the 3 route files auth via getUserOrNull + sessionUser.profile.id, never a body userId", () => {
    const base = join(ROOT, "app", "api", "private", "agents", "framework", "runs");
    const files = [
      join(base, "route.ts"),
      join(base, "[id]", "route.ts"),
      join(base, "[id]", "advance", "route.ts"),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const name = f.split(/[/\\]/).slice(-2).join("/");
      assert.match(src, /getUserOrNull\(\)/, `${name} authenticates`);
      assert.match(src, /sessionUser\.profile\.id/, `${name} uses the session user id`);
      assert.ok(!/body\.(userId|requesterId)|\buserId\b\s*:\s*(body|req)/.test(src), `${name} must not read a userId from the body`);
      // no second runtime / planner / authorizer / executor / LLM in a route
      for (const bad of ["new AgentRuntime", "SupervisorService", "authorization-service", "authorizationService", "tool-gateway", "invokeTool", "@/lib/ai"]) {
        assert.ok(!src.includes(bad), `${name} must not import "${bad}" - delegate to the service`);
      }
    }
  });

  await test("structural: the API service delegates to the SHARED runtime and reimplements nothing", () => {
    const src = readFileSync(join(ROOT, "services", "agent-framework", "api", "agent-run-service.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    assert.ok(importLines.some((l) => /\bagentRuntime\b/.test(l) && /runtime\/agent-runtime/.test(l)), "uses the shared agentRuntime singleton");
    assert.ok(!src.includes("new AgentRuntime("), "does not construct its own runtime");
    for (const bad of ["supervisor/supervisor", "SupervisorService", "authorization-service", "authorizationService", "output-integrity", "checkOutputIntegrity", "tool-gateway", "invokeTool", "@/lib/ai"]) {
      assert.ok(!src.includes(bad), `service must not import "${bad}"`);
    }
    // ownership is enforced through the A14 primitives
    assert.match(src, /getRunForUser|requesterId/, "enforces ownership via the A14 read primitives");
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  try { await cleanup(); await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
