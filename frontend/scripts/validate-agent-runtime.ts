// scripts/validate-agent-runtime.ts
// Sprint AN, step A4 - Server-side resumable Agent Runtime (G04).
//
// House style. Run:
//   node --env-file=.env.local --env-file=.env node_modules/tsx/dist/cli.mjs scripts/validate-agent-runtime.ts
//   (npm run validate:agent-runtime)
//
// This test WRITES real rows to the A3 tables (AgentRun/Step/ToolCall/
// Evidence) under a synthetic userId, and cleans them up at start + end.
//
// Proves:
//   1. the small end-to-end proof: Agent -> Planner -> market.snapshot ->
//      typed result -> AgentEvidence -> succeeded, fully persisted.
//   2. resumable tick(): a FRESH AgentRuntime instance per tick (simulating a
//      lost serverless invocation) drives the same runId to completion from
//      the DB row alone.
//   3. every failure/limit path terminates deterministically with the right
//      AgentRunStatus, before or at the executor boundary.

import assert from "node:assert/strict";

import {
  makeDefaultAgentDefinitionBase,
  type AgentDefinition,
  type ToolDefinition,
} from "../types/agent-framework/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-runtime-user";

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

function makeDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = new Date().toISOString();
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: `agt_test_${Math.random().toString(36).slice(2, 9)}`,
    slug: "runtime-test-agent",
    version: "1.0.0",
    name: "Runtime Test Agent",
    description: "Synthetic agent for validate-agent-runtime.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective: "Prove the runtime substrate end to end.",
    instructions: "Invoke bound tools; synthesise an evidence-backed output.",
    modelPolicy: { preferred: "m-fast", fallback: [], allowed: ["m-fast"] },
    tools: [{ toolId: "market.snapshot" }],
    permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** A fake, dependency-free tool (no network, no DB). Optionally emits one
 *  evidence draft, optionally requires a higher autonomy floor. */
function makeFakeTool(
  id: string,
  opts: { autonomyFloor?: 0 | 1 | 2; producesEvidence?: boolean } = {},
): ToolImplementation<Record<string, never>, { ok: true; id: string }> {
  const producesEvidence = opts.producesEvidence ?? false;
  const definition: ToolDefinition = {
    id,
    name: id,
    description: `Test-only tool ${id}.`,
    version: "1.0.0",
    category: "RESEARCH",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    requiredPermissions: ["CAN_RUN_RESEARCH"],
    autonomyFloor: opts.autonomyFloor ?? 0,
    creditCost: { model: "flat", credits: 1 },
    executionMode: "sync",
    evidence: producesEvidence
      ? { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "test-fixture" }
      : { producesEvidence: false, evidenceTypes: [], provenanceProducer: "test-fixture" },
    status: "active",
    wraps: "n/a (test fixture)",
  };
  return {
    definition,
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => ({
      output: { ok: true, id },
      evidence: producesEvidence
        ? [{
            type: "derived",
            claim: `${id} ran`,
            source: "test-fixture",
            sourceId: id,
            timestamp: new Date().toISOString(),
            data: { id },
            relevance: 1,
            confidence: 1,
            provenance: { producer: "test-fixture", retrievedAt: new Date().toISOString() },
          }]
        : [],
    }),
  };
}

/** A registry with only fake tools - fully deterministic, no network/DB. */
function fakeRegistry(...tools: ToolImplementation<Record<string, never>, unknown>[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register(t);
  return reg.freeze();
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Runtime validation (writes + cleans real rows)\n");
  await cleanup();

  const runtime = new AgentRuntime(); // production tool registry

  // ----------------------------------------------------------------
  // 1. small end-to-end proof
  // ----------------------------------------------------------------

  await test("small proof: Agent -> Planner -> market.snapshot -> evidence -> terminal, fully persisted", async () => {
    const def = makeDef();
    const { runId } = await runtime.startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });

    const queued = await agentRunRepository.getRun(runId);
    assert.equal(queued?.status, "queued");
    assert.equal(queued?.agentId, def.id);

    const final = await runtime.runToCompletion(runId);
    const trace = await agentRunRepository.getRunTrace(runId);

    // provider is up in this env (proven in A2) -> succeeded. If a provider
    // outage makes the tool return tool_error, the run terminates tool_error
    // and the persistence assertions below still hold.
    assert.ok(["succeeded", "tool_error"].includes(final!.status), `unexpected status ${final!.status}`);

    const kinds = trace.steps.map((s) => s.kind);
    assert.ok(kinds.includes("plan"), "must have a plan step");
    assert.ok(kinds.includes("tool_call"), "must have a tool_call step");
    // strictly increasing, gapless indices
    trace.steps.forEach((s, i) => assert.equal(s.index, i, "step indices must be gapless 0..n"));

    assert.equal(trace.toolCalls.length, 1, "exactly one tool call");
    assert.equal(trace.toolCalls[0].toolId, "market.snapshot");

    if (final!.status === "succeeded") {
      assert.ok(kinds.includes("output"), "a succeeded run has an output step");
      assert.equal(trace.toolCalls[0].status, "ok");
      assert.ok(trace.evidence.length >= 1, "an ok market.snapshot yields >= 1 evidence row");
      const ev = trace.evidence[0];
      assert.equal(ev.type, "market_data");
      assert.equal((ev.provenance as { producer?: string }).producer, "market-data-service");
      assert.equal(ev.runId, runId);
      assert.equal(ev.toolCallId, trace.toolCalls[0].id, "evidence is linked to its tool call");
      const out = final!.output as { evidenceIds?: string[]; evidenceCount?: number };
      assert.equal(out.evidenceCount, trace.evidence.length);
      console.log(`      -> succeeded, ${trace.steps.length} steps, ${trace.evidence.length} evidence`);
    } else {
      console.log(`      -> provider unavailable: clean tool_error, trace still intact`);
    }

    // idempotent: ticking a terminal run is a no-op
    const again = await runtime.tick(runId);
    assert.equal(again!.status, final!.status);
    assert.equal((await agentRunRepository.getRunTrace(runId)).steps.length, trace.steps.length);
  });

  // ----------------------------------------------------------------
  // 2. resumable tick() - a fresh runtime per tick
  // ----------------------------------------------------------------

  await test("resumable: a FRESH AgentRuntime per tick drives the run from the DB row alone", async () => {
    const reg = fakeRegistry(
      makeFakeTool("test.step_a", { producesEvidence: true }),
      makeFakeTool("test.step_b", { producesEvidence: true }),
    );
    const freshRuntime = () => new AgentRuntime({ registry: reg });
    const def = makeDef({
      type: "RESEARCH",
      tools: [{ toolId: "test.step_a" }, { toolId: "test.step_b" }],
      permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] },
      autonomyLevel: 1,
    });
    const { runId } = await freshRuntime().startRun({ definition: def, input: {}, userId: TEST_USER });

    // tick 1: queued -> running, plan persisted
    await freshRuntime().tick(runId);
    let row = await agentRunRepository.getRun(runId);
    let trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(row?.status, "running");
    assert.equal(trace.steps.filter((s) => s.kind === "plan").length, 1);
    assert.equal((row?.plan as unknown[]).length, 2);
    assert.equal((row?.resumeState as { nextPlanIndex?: number })?.nextPlanIndex, 0);

    // tick 2: first tool call (one bounded slice)
    await freshRuntime().tick(runId);
    row = await agentRunRepository.getRun(runId);
    trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls.length, 1, "one tool call after tick 2");
    assert.equal(trace.toolCalls[0].toolId, "test.step_a");
    assert.equal((row?.resumeState as { nextPlanIndex?: number })?.nextPlanIndex, 1, "resumeState advanced");
    assert.equal(row?.status, "running");

    // tick 3: second tool call
    await freshRuntime().tick(runId);
    trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls.length, 2, "two tool calls after tick 3");
    assert.equal(trace.toolCalls[1].toolId, "test.step_b");
    assert.equal((await agentRunRepository.getRun(runId))?.status, "running");

    // tick 4: plan exhausted -> output -> succeeded
    await freshRuntime().tick(runId);
    row = await agentRunRepository.getRun(runId);
    assert.equal(row?.status, "succeeded");
    assert.equal(row?.resumeState, null, "resumeState cleared on completion");
    assert.ok((row?.completedAt as Date) instanceof Date);

    trace = await agentRunRepository.getRunTrace(runId);
    assert.deepEqual(
      trace.steps.map((s) => s.kind),
      ["plan", "tool_call", "evidence", "tool_call", "evidence", "output", "evaluation"], // A6: integrity gate
    );
    assert.equal(trace.steps.at(-1)!.kind, "evaluation");
    assert.equal((trace.steps.at(-1)!.output as { passed?: boolean }).passed, true);
    trace.steps.forEach((s, i) => assert.equal(s.index, i, "gapless indices across ticks"));
    assert.equal(trace.evidence.length, 2, "one evidence row per fake tool");
    assert.equal(row?.creditsConsumed, 2, "credits accumulated across ticks (1 + 1 placeholder)");
    console.log("      -> 4 ticks, 2 tool calls, succeeded; state survived every fresh runtime");
  });

  // ----------------------------------------------------------------
  // 3. failure / limit paths (deterministic, no network)
  // ----------------------------------------------------------------

  await test("limit: maxSteps breach -> step_limit (before any tool call)", async () => {
    const def = makeDef();
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });
    // hand-tighten the persisted limits snapshot to maxSteps: 1
    await prisma.agentRun.update({ where: { id: runId }, data: { limits: { ...(def ? {} : {}), maxSteps: 1, maxToolCalls: 40, maxRuntimeMs: 300000, maxCreditCost: 250, maxRetries: 2 } } });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "step_limit");
    assert.equal(final?.errorCode, "maxSteps");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls.length, 0, "terminated before any tool call");
  });

  await test("limit: credit ceiling below first tool cost -> credit_limit (before the executor)", async () => {
    const def = makeDef({
      creditPolicy: { perRunCeiling: 0.5, perDayCeiling: 0.5, requireEstimateUnder: 0.5 },
    });
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "credit_limit");
    assert.equal(final?.errorCode, "maxCreditCost");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls.length, 0, "no tool call - credit check is pre-executor");
  });

  await test("authorization: unknown tool -> tool_error / unknown_tool", async () => {
    const def = makeDef({ tools: [{ toolId: "does.not.exist" }] });
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "tool_error");
    assert.equal(final?.errorCode, "unknown_tool");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls.length, 1);
    assert.equal(trace.toolCalls[0].status, "invalid_input");
  });

  await test("authorization: missing permission -> permission_denied (before the executor)", async () => {
    const def = makeDef({ permissionPolicy: { granted: [] } }); // no CAN_READ_MARKET_DATA
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "permission_denied");
    assert.equal(final?.errorCode, "missing_permission");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls[0].status, "permission_denied");
  });

  await test("authorization: autonomy floor not met -> permission_denied", async () => {
    const rt = new AgentRuntime({ registry: fakeRegistry(makeFakeTool("test.floor2", { autonomyFloor: 2 })) });
    const def = makeDef({
      type: "RESEARCH",
      tools: [{ toolId: "test.floor2" }],
      permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] },
      autonomyLevel: 1, // floor is 2
    });
    const { runId } = await rt.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "permission_denied");
    assert.equal(final?.errorCode, "autonomy_floor");
  });

  await test("forensic query: 'why did this agent conclude X' = one indexed read of AgentEvidence by runId", async () => {
    const def = makeDef();
    const { runId } = await new AgentRuntime().startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });
    await new AgentRuntime().runToCompletion(runId);
    const evidence = await prisma.agentEvidence.findMany({ where: { runId } });
    const row = await agentRunRepository.getRun(runId);
    if (row?.status === "succeeded") {
      assert.ok(evidence.length >= 1);
      for (const e of evidence) {
        assert.equal(e.runId, runId);
        assert.ok(e.stepId, "every evidence row links to a step");
        assert.ok((e.provenance as { producer?: string }).producer, "every evidence row has provenance");
      }
    }
  });

  await test("runtime layer is server-only (no browser/client imports)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "agent-framework", "runtime");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const banned of ['"use client"', "next/navigation", "next/router", "window.", "document.", "localStorage"]) {
        assert.ok(!src.includes(banned), `${f} contains "${banned}" - runtime must be server-only`);
      }
    }
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
