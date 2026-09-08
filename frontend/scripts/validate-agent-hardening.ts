// scripts/validate-agent-hardening.ts
// Sprint AN, step A14 - Regression + Security + Performance Hardening (G14).
//
// House style (node:assert/strict, tsx). DB-touching (real A3 rows under
// synthetic per-process users, cleaned at start + end).
//   node --env-file=.env.local --env-file=.env node_modules/tsx/dist/cli.mjs scripts/validate-agent-hardening.ts
//   (npm run validate:agent-hardening)
//
// A14 does NOT add an agent. It stresses the complete A1-A13 system:
//
//   1. BOUNDED EXECUTION - one tick() = one bounded slice + persisted
//      checkpoint + return; terminal re-ticks are no-ops; a fresh runtime
//      per tick still completes; repeated runs are structurally identical.
//   2. CROSS-USER ISOLATION - runs, evidence, memory, credits: user A can
//      never read user B's; cleanup of one user cannot touch another.
//   3. CONCURRENCY - a double-tick race on one run does not corrupt the
//      ordered history; concurrent identical charges settle to one entry;
//      concurrent runs for different users do not cross.
//   4. "NEVER TRUST PERSISTED AGENT STATE" - tampered autonomy in the
//      persisted definition, fabricated / foreign evidence ids, and a
//      credential in provenance are all caught at the gate, not trusted.
//   5. PERFORMANCE - per-phase wall-time is measured and bounded (generous
//      ceilings that only catch a pathological blow-up).

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";

import {
  makeDefaultAgentDefinitionBase,
  type AgentDefinition,
  type ToolDefinition,
  type MemoryPolicy,
  type MemoryWriteRequest,
  type MemoryReadQuery,
} from "../types/agent-framework/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver, DuplicateLedgerEntryError } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { getRunObservability } from "../services/agent-framework/evaluation/observability";
import { MemoryGateway } from "../services/agent-framework/memory/memory-gateway";
import { InMemoryStore } from "../services/agent-framework/memory/in-memory-store";
import type { RunPlanner } from "../services/agent-framework/supervisor/run-planner";
import { prisma } from "../lib/prisma";

const RUN_ID = Math.random().toString(36).slice(2, 8);
const USER_A = `validate-agent-hardening-${process.pid}-${RUN_ID}-A`;
const USER_B = `validate-agent-hardening-${process.pid}-${RUN_ID}-B`;

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

// ------------------------------------------------------------------
// fixtures - fully deterministic, no network
// ------------------------------------------------------------------

function fakeTool(
  id: string,
  opts: { evidence?: boolean; badOutput?: boolean; badProvenance?: boolean; autonomyFloor?: 0 | 1 | 2 } = {},
): ToolImplementation<Record<string, never>, unknown> {
  const def: ToolDefinition = {
    id, name: id, description: `fixture ${id}`, version: "1.0.0", category: "RESEARCH",
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
    requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: opts.autonomyFloor ?? 0,
    creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
    evidence: opts.evidence
      ? { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "fixture" }
      : { producesEvidence: false, evidenceTypes: [], provenanceProducer: "fixture" },
    status: "active", wraps: "n/a (test fixture)",
  };
  return {
    definition: def,
    parseInput: () => ({ ok: true, value: {} }),
    // a realistic guard: the handler's output must be an object with ok:true.
    // The `badOutput` handler deliberately violates it - the GATEWAY must
    // catch that (output_validation), not the agent.
    checkOutput: (v) =>
      typeof v === "object" && v !== null && !Array.isArray(v) && (v as { ok?: unknown }).ok === true
        ? { valid: true, violations: [] }
        : { valid: false, violations: [{ path: "", message: "output must be an object with ok:true" }] },
    handler: async () => {
      const now = new Date().toISOString();
      if (opts.badOutput) return { output: "not-an-object" as unknown as Record<string, never>, evidence: [] };
      return {
        output: { ok: true },
        evidence: opts.evidence
          ? [{
              type: "derived", claim: `${id} produced a finding`, source: "fixture", sourceId: id, timestamp: now,
              data: { id }, relevance: 1, confidence: 1,
              provenance: opts.badProvenance
                ? { producer: "fixture apikey=sk-abcdef0123456789 leaked", retrievedAt: now }
                : { producer: "fixture", retrievedAt: now },
            }]
          : [],
      };
    },
  };
}

function reg(...tools: ToolImplementation<Record<string, never>, unknown>[]): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of tools) r.register(t);
  return r.freeze();
}

function makeDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = new Date().toISOString();
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: `agt_hard_${Math.random().toString(36).slice(2, 9)}`,
    slug: "hardening-test-agent",
    version: "1.0.0",
    name: "Hardening Test Agent",
    description: "Synthetic agent for validate-agent-hardening.",
    type: "RESEARCH",
    status: "active",
    objective: "stress the runtime",
    instructions: "n/a",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: [{ toolId: "h.a" }, { toolId: "h.b" }],
    permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function harness(registry: ToolRegistry, allowance = 1_000_000) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(allowance) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  return { rt, evaluation, ledger };
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(USER_A);
  await agentRunRepository._deleteRunsForUser(USER_B);
}

async function main(): Promise<void> {
  console.log("\nAN1.16 - Agent Framework Hardening (A14) validation\n");
  await cleanup();

  // ================================================================
  // 1. BOUNDED EXECUTION
  // ================================================================

  await test("bounded: one tick() executes at most ONE tool call, then persists + returns", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true })));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });

    let prevToolCalls = 0;
    let prevSteps = 0;
    let ticks = 0;
    for (;;) {
      const row = await rt.tick(runId);
      ticks += 1;
      const trace = await agentRunRepository.getRunTrace(runId);
      const dTool = trace.toolCalls.length - prevToolCalls;
      assert.ok(dTool <= 1, `tick added ${dTool} tool calls - a tick must add at most one`);
      assert.ok(trace.steps.length >= prevSteps, "step history is append-only across ticks");
      prevToolCalls = trace.toolCalls.length;
      prevSteps = trace.steps.length;
      if (["succeeded", "failed", "tool_error", "permission_denied", "credit_limit", "step_limit", "timeout"].includes(row!.status)) break;
      assert.ok(ticks < 25, "run did not terminate within a bounded number of ticks");
    }
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal((await agentRunRepository.getRun(runId))!.status, "succeeded");
    assert.equal(trace.toolCalls.length, 2);
    assert.deepEqual(trace.steps.map((s) => s.kind), ["plan", "tool_call", "evidence", "tool_call", "evidence", "output", "evaluation"]);
    trace.steps.forEach((s, i) => assert.equal(s.index, i, "gapless step indices"));
  });

  await test("bounded: a terminal run is a no-op on re-tick (idempotent, fast, no new rows)", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b")));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    await rt.runToCompletion(runId);
    const before = await agentRunRepository.getRunTrace(runId);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) await rt.tick(runId);
    const elapsed = performance.now() - t0;
    const after = await agentRunRepository.getRunTrace(runId);
    assert.equal(after.steps.length, before.steps.length, "no new steps from re-ticking a terminal run");
    assert.equal(after.toolCalls.length, before.toolCalls.length);
    assert.equal(after.run!.status, before.run!.status);
    assert.ok(elapsed < 4000, `5 terminal re-ticks took ${elapsed | 0}ms (should be trivial)`);
  });

  await test("bounded: a FRESH AgentRuntime per tick drives the same run to completion from the DB alone", async () => {
    const registry = reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true }));
    const store = new InMemoryCreditStore();
    const freshRt = () => new AgentRuntime({
      registry,
      creditLedger: new CreditLedger({ store, allowances: new FixedAllowanceResolver(1_000_000) }),
      evaluation: new EvaluationService({ registry, creditLedger: new CreditLedger({ store, allowances: new FixedAllowanceResolver(1_000_000) }), store: new InMemoryEvaluationStore() }),
    });
    const { runId } = await freshRt().startRun({ definition: makeDef(), input: {}, userId: USER_A });
    for (let i = 0; i < 20; i++) {
      const row = await freshRt().tick(runId);
      if (row!.status === "succeeded") break;
    }
    assert.equal((await agentRunRepository.getRun(runId))!.status, "succeeded");
  });

  await test("bounded: repeated runs of the same (definition, input) are structurally identical", async () => {
    const shape = async () => {
      const { rt } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true })));
      const { runId } = await rt.startRun({ definition: makeDef(), input: { q: "same" }, userId: USER_A });
      await rt.runToCompletion(runId);
      const t = await agentRunRepository.getRunTrace(runId);
      return {
        status: t.run!.status,
        steps: t.steps.map((s) => s.kind).join(","),
        tools: t.toolCalls.map((x) => x.toolId).join(","),
        evidence: t.evidence.length,
      };
    };
    const a = await shape();
    const b = await shape();
    const c = await shape();
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });

  // ================================================================
  // 2. CROSS-USER ISOLATION
  // ================================================================

  await test("isolation: getRunForUser returns the run only to its owner; getRunObservability honours requesterId", async () => {
    const { rt, ledger, evaluation } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b")));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    await rt.runToCompletion(runId);

    assert.ok(await agentRunRepository.getRunForUser(runId, USER_A), "owner can read the run");
    assert.equal(await agentRunRepository.getRunForUser(runId, USER_B), null, "a non-owner gets null");

    const asOwner = await getRunObservability(runId, { creditLedger: ledger, evaluation, requesterId: USER_A });
    assert.ok(asOwner && asOwner.run!.id === runId, "owner sees the observability model");
    const asOther = await getRunObservability(runId, { creditLedger: ledger, evaluation, requesterId: USER_B });
    assert.equal(asOther, null, "a non-owner gets null (indistinguishable from not-found)");
    const internal = await getRunObservability(runId, { creditLedger: ledger, evaluation });
    assert.ok(internal, "an internal caller (no requesterId) still gets it");
  });

  await test("isolation: MemoryGateway reads are user-scoped - user B cannot see user A's own-scoped record", async () => {
    const gw = new MemoryGateway({ store: new InMemoryStore() });
    const policy: MemoryPolicy = {
      layers: ["SHORT_TERM"],
      retention: { SHORT_TERM: { mode: "persistent" } },
      readPolicy: { SHORT_TERM: "own" },
      writePolicy: { SHORT_TERM: "allow" },
    };
    const now = new Date().toISOString();
    const w: MemoryWriteRequest = {
      agentId: "agtShared", agentType: "RESEARCH", userId: USER_A, runId: null,
      layer: "SHORT_TERM", scope: "s", key: "k", value: { secret: "A-only" },
      retention: { mode: "persistent" }, provenance: { origin: "system", producer: "test", createdAt: now },
    };
    const wr = await gw.write(w, policy);
    assert.equal(wr.status, "active");

    const readA: MemoryReadQuery = { agentId: "agtShared", agentType: "RESEARCH", userId: USER_A, layer: "SHORT_TERM", scope: "s", key: "k" };
    const readB: MemoryReadQuery = { ...readA, userId: USER_B };
    assert.equal((await gw.read(readA, policy)).records.length, 1, "owner reads its record");
    assert.equal((await gw.read(readB, policy)).records.length, 0, "another user reads nothing");
  });

  await test("isolation: credit balances + run ledgers are per-user; a charge for A never moves B's balance", async () => {
    const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(500) });
    await ledger.charge({ userId: USER_A, runId: "r_a", kind: "tool_call", amount: 40, reason: "t", idempotencyKey: `${RUN_ID}-a1` });
    assert.equal((await ledger.balance(USER_A)).balance, 460);
    assert.equal((await ledger.balance(USER_B)).balance, 500, "B's balance is untouched");
    await ledger.charge({ userId: USER_B, runId: "r_b", kind: "tool_call", amount: 10, reason: "t", idempotencyKey: `${RUN_ID}-b1` });
    assert.equal((await ledger.balance(USER_A)).balance, 460);
    const histA = await ledger.historyForRun("r_a");
    assert.ok(histA.every((e) => e.userId === USER_A), "run A's ledger is all user A");
  });

  await test("isolation: two runs for two users - evidence and steps never cross", async () => {
    const registry = reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true }));
    const { rt: rtA } = harness(registry);
    const { rt: rtB } = harness(registry);
    const [rA, rB] = await Promise.all([
      rtA.startRun({ definition: makeDef(), input: {}, userId: USER_A }).then((x) => rtA.runToCompletion(x.runId)),
      rtB.startRun({ definition: makeDef(), input: {}, userId: USER_B }).then((x) => rtB.runToCompletion(x.runId)),
    ]);
    assert.equal(rA!.status, "succeeded");
    assert.equal(rB!.status, "succeeded");
    const [tA, tB] = await Promise.all([agentRunRepository.getRunTrace(rA!.id), agentRunRepository.getRunTrace(rB!.id)]);
    assert.ok(tA.evidence.every((e) => e.runId === rA!.id));
    assert.ok(tB.evidence.every((e) => e.runId === rB!.id));
    assert.notEqual(rA!.id, rB!.id);
  });

  await test("isolation: cleanup of user B's runs mid-flight does NOT affect user A's in-flight run", async () => {
    const registry = reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true }));
    const { rt: rtA } = harness(registry);
    const { rt: rtB } = harness(registry);
    const { runId: runA } = await rtA.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    const { runId: runB } = await rtB.startRun({ definition: makeDef(), input: {}, userId: USER_B });
    // interleave: advance A one tick, delete B's runs, then finish A
    await rtA.tick(runA); // plan
    await rtA.tick(runA); // tool call
    await agentRunRepository._deleteRunsForUser(USER_B);
    const finalA = await rtA.runToCompletion(runA);
    assert.equal(finalA!.status, "succeeded", "A completes despite B's cleanup");
    assert.equal(await agentRunRepository.getRun(runB), null, "B's run is gone");
    const tA = await agentRunRepository.getRunTrace(runA);
    assert.deepEqual(tA.steps.map((s) => s.kind), ["plan", "tool_call", "evidence", "tool_call", "evidence", "output", "evaluation"]);
  });

  // ================================================================
  // 3. CONCURRENCY
  // ================================================================

  await test("concurrency: a double tick() race on one run does not corrupt the ordered history", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true })));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    // fire pairs of concurrent ticks until terminal
    for (let i = 0; i < 12; i++) {
      const results = await Promise.allSettled([rt.tick(runId), rt.tick(runId)]);
      // at least one of each pair must not reject; a rejection is the
      // (runId,index) unique constraint doing its job, never corruption
      assert.ok(results.some((r) => r.status === "fulfilled"), "a tick pair made progress");
      const row = await agentRunRepository.getRun(runId);
      if (["succeeded", "failed", "tool_error"].includes(row!.status)) break;
    }
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.run!.status, "succeeded");
    // no duplicated positions, gapless
    const idx = trace.steps.map((s) => s.index);
    assert.deepEqual(idx, [...new Set(idx)], "no duplicate step indices");
    assert.deepEqual(idx, idx.map((_, i) => i), "gapless step indices after a racing run");
    assert.equal(trace.toolCalls.length, 2, "exactly two tool calls despite the races");
  });

  await test("concurrency: two identical charges (same idempotencyKey) settle to exactly one ledger entry", async () => {
    const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100) });
    const key = `${RUN_ID}-race`;
    const req = { userId: USER_A, runId: "r_race", kind: "tool_call" as const, amount: 7, reason: "t", idempotencyKey: key };
    const [a, b] = await Promise.all([ledger.charge(req), ledger.charge(req)]);
    const applied = [a, b].filter((r) => r.charged).length;
    assert.equal(applied, 1, "exactly one of the racing charges actually debited");
    assert.equal((await ledger.balance(USER_A)).balance, 93, "debited once, not twice");
    const hist = await ledger.historyForRun("r_race");
    assert.equal(hist.length, 1);
  });

  await test("concurrency: DuplicateLedgerEntryError is the store's guard, surfaced as alreadyApplied", async () => {
    const store = new InMemoryCreditStore();
    await store.insert({ userId: USER_A, runId: "r", stepId: null, toolCallId: null, kind: "tool_call", amount: 1, balanceAfter: 0, idempotencyKey: "dup", reason: "t", periodStart: "2026-01-01T00:00:00.000Z" });
    await assert.rejects(
      store.insert({ userId: USER_A, runId: "r", stepId: null, toolCallId: null, kind: "tool_call", amount: 1, balanceAfter: 0, idempotencyKey: "dup", reason: "t", periodStart: "2026-01-01T00:00:00.000Z" }),
      DuplicateLedgerEntryError,
    );
  });

  // ================================================================
  // 4. NEVER TRUST PERSISTED AGENT STATE
  // ================================================================

  await test("adversarial: autonomy escalated in the PERSISTED definition is caught at authorization (defence in depth)", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { autonomyFloor: 0 }), fakeTool("h.b")));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    // tamper: raise autonomy in the stored snapshot AFTER a legal startRun
    const run = await agentRunRepository.getRun(runId);
    const md = run!.metadata as unknown as { definition: AgentDefinition };
    md.definition.autonomyLevel = 4;
    await agentRunRepository.patchRun(runId, { metadata: md as unknown as Record<string, unknown> });
    const final = await rt.runToCompletion(runId);
    assert.equal(final!.status, "permission_denied", `tampered autonomy must not be trusted (got ${final!.status})`);
    assert.equal(final!.errorCode, "agent_autonomy_ceiling");
  });

  await test("adversarial: a fabricated evidenceId in the output fails the integrity gate", async () => {
    const badPlanner: RunPlanner = {
      async plan() { return { requests: [{ toolId: "h.a", input: {}, rationale: "t" }], rationale: "p", planMetadata: { specialist: "test", planningPath: "deterministic" } }; },
      async synthesizeOutput() { return { output: { kind: "x", resolved: true, evidenceIds: ["ev_totally_made_up"] }, summary: "fabricated" }; },
    };
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true })));
    const def = makeDef({ tools: [{ toolId: "h.a" }] });
    const { runId } = await new AgentRuntime({ registry: reg(fakeTool("h.a", { evidence: true })), planner: badPlanner, creditLedger: new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) }), evaluation: new EvaluationService({ registry: reg(fakeTool("h.a", { evidence: true })), creditLedger: new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) }), store: new InMemoryEvaluationStore() }) }).startRun({ definition: def, input: {}, userId: USER_A });
    const rt2 = new AgentRuntime({ registry: reg(fakeTool("h.a", { evidence: true })), planner: badPlanner, creditLedger: new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) }), evaluation: new EvaluationService({ registry: reg(fakeTool("h.a", { evidence: true })), creditLedger: new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) }), store: new InMemoryEvaluationStore() }) });
    const final = await rt2.runToCompletion(runId);
    assert.equal(final!.status, "failed");
    assert.equal(final!.errorCode, "output_integrity");
  });

  await test("adversarial: an evidenceId from ANOTHER run fails the integrity gate (no foreign lineage)", async () => {
    // a real run for user B, to borrow a real evidence id from
    const { rt: rtB } = harness(reg(fakeTool("h.a", { evidence: true })));
    const { runId: runB } = await rtB.startRun({ definition: makeDef({ tools: [{ toolId: "h.a" }] }), input: {}, userId: USER_B });
    await rtB.runToCompletion(runB);
    const foreignId = (await agentRunRepository.getRunTrace(runB)).evidence[0].id;

    const borrowingPlanner: RunPlanner = {
      async plan() { return { requests: [{ toolId: "h.a", input: {}, rationale: "t" }], rationale: "p", planMetadata: { specialist: "test", planningPath: "deterministic" } }; },
      async synthesizeOutput() { return { output: { kind: "x", resolved: true, evidenceIds: [foreignId] }, summary: "borrowed" }; },
    };
    const mk = () => new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) });
    const registry = reg(fakeTool("h.a", { evidence: true }));
    const rt = new AgentRuntime({ registry, planner: borrowingPlanner, creditLedger: mk(), evaluation: new EvaluationService({ registry, creditLedger: mk(), store: new InMemoryEvaluationStore() }) });
    const { runId } = await rt.startRun({ definition: makeDef({ tools: [{ toolId: "h.a" }] }), input: {}, userId: USER_A });
    const final = await rt.runToCompletion(runId);
    assert.equal(final!.status, "failed");
    assert.equal(final!.errorCode, "output_integrity");
    assert.match(final!.errorMessage ?? "", /foreign_evidence_id|broken_lineage/);
  });

  await test("adversarial: a credential in evidence provenance fails the integrity gate", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true, badProvenance: true })));
    // the specialist must cite it; use a planner that references all evidence
    const citer: RunPlanner = {
      async plan() { return { requests: [{ toolId: "h.a", input: {}, rationale: "t" }], rationale: "p", planMetadata: { specialist: "t", planningPath: "deterministic" } }; },
      async synthesizeOutput(t) { return { output: { kind: "x", resolved: true, evidenceIds: t.evidence.map((e) => e.id) }, summary: "s" }; },
    };
    const mk = () => new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(1e6) });
    const registry = reg(fakeTool("h.a", { evidence: true, badProvenance: true }));
    const rt2 = new AgentRuntime({ registry, planner: citer, creditLedger: mk(), evaluation: new EvaluationService({ registry, creditLedger: mk(), store: new InMemoryEvaluationStore() }) });
    const { runId } = await rt2.startRun({ definition: makeDef({ tools: [{ toolId: "h.a" }] }), input: {}, userId: USER_A });
    const final = await rt2.runToCompletion(runId);
    assert.equal(final!.status, "failed");
    assert.match(final!.errorMessage ?? "", /sensitive_data|credential/);
  });

  await test("adversarial: a malformed tool output is a clean tool_error, not a crash", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { badOutput: true }), fakeTool("h.b")));
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    const final = await rt.runToCompletion(runId);
    assert.equal(final!.status, "tool_error");
    const trace = await agentRunRepository.getRunTrace(runId);
    assert.equal(trace.toolCalls[0].status, "tool_error");
  });

  // ================================================================
  // 5. PERFORMANCE (measured + generously bounded)
  // ================================================================

  await test("perf: per-phase wall-time is bounded (deterministic fixtures, no network)", async () => {
    const { rt } = harness(reg(fakeTool("h.a", { evidence: true }), fakeTool("h.b", { evidence: true })));
    const tStart = performance.now();
    const { runId } = await rt.startRun({ definition: makeDef(), input: {}, userId: USER_A });
    const tCreated = performance.now();
    await rt.tick(runId); // plan
    const tPlan = performance.now();
    await rt.tick(runId); // tool call 1
    const tTool = performance.now();
    await rt.runToCompletion(runId); // rest
    const tDone = performance.now();

    const ms = {
      startRun: (tCreated - tStart) | 0,
      planTick: (tPlan - tCreated) | 0,
      toolTick: (tTool - tPlan) | 0,
      finish: (tDone - tTool) | 0,
      total: (tDone - tStart) | 0,
    };
    console.log(`      -> startRun ${ms.startRun}ms · plan ${ms.planTick}ms · tool ${ms.toolTick}ms · finish ${ms.finish}ms · total ${ms.total}ms`);
    assert.ok(ms.startRun < 3000, `startRun ${ms.startRun}ms`);
    assert.ok(ms.planTick < 3000, `plan tick ${ms.planTick}ms`);
    assert.ok(ms.toolTick < 3000, `tool tick ${ms.toolTick}ms`);
    assert.ok(ms.total < 15000, `full deterministic run ${ms.total}ms`);
    assert.equal((await agentRunRepository.getRun(runId))!.status, "succeeded");
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
