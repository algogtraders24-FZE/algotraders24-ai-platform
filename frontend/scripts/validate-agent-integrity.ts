// scripts/validate-agent-integrity.ts
// Sprint AN, step A6 - Evidence hardening + Output Integrity (G06).
//
// Run: npm run validate:agent-integrity
//
// Proves the invariant: an agent conclusion is not trustworthy just because
// the agent produced it. checkOutputIntegrity() is a DETERMINISTIC,
// LLM-independent gate. The runtime runs it BEFORE "succeeded"; a failure is
// a deterministic terminal "failed" with errorCode "output_integrity".
//
// Layer 1 - unit: hand-crafted output + synthetic trace, every adversarial
//           case must fail; the valid case must pass.
// Layer 2 - runtime: a specialist that emits a forbidden field drives a real
//           run to "failed / output_integrity" with an evaluation step.

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";

import { makeDefaultAgentDefinitionBase, type AgentDefinition } from "../types/agent-framework/index";
import { checkOutputIntegrity } from "../services/agent-framework/integrity/output-integrity";
import { buildLineage } from "../services/agent-framework/integrity/evidence-lineage";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import type { RunPlanner, RunTrace } from "../services/agent-framework/supervisor/run-planner";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-integrity-user";
const registry = buildToolRegistry();

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

function makeDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = new Date().toISOString();
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: `agt_int_${Math.random().toString(36).slice(2, 9)}`,
    slug: "integrity-test-agent",
    version: "1.0.0",
    name: "Integrity Test Agent",
    description: "Synthetic agent for validate-agent-integrity.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective: "Prove the integrity gate.",
    instructions: "n/a",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: [{ toolId: "market.snapshot" }],
    permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

// ---- synthetic trace builder --------------------------------------------

const NOW = new Date();
function trace(over: {
  runId?: string;
  evidence?: Partial<RunTrace["evidence"][number]>[];
  steps?: Partial<RunTrace["steps"][number]>[];
  toolCalls?: Partial<RunTrace["toolCalls"][number]>[];
} = {}): RunTrace {
  const runId = over.runId ?? "run_int_1";
  const step = { id: "step_1", runId, index: 1, kind: "tool_call", status: "ok", summary: "", input: null, output: null, startedAt: NOW, completedAt: NOW, durationMs: 1, creditsConsumed: 0, createdAt: NOW };
  const tc = { id: "tc_1", runId, stepId: "step_1", toolId: "market.snapshot", toolVersion: "1.0.0", input: {}, output: {}, status: "ok", permissionChecked: [], creditCost: 0, startedAt: NOW, completedAt: NOW, durationMs: 1, evidenceIds: [], createdAt: NOW };
  const ev = {
    id: "ev_1", runId, stepId: "step_1", toolCallId: "tc_1", type: "market_data",
    claim: "XAUUSD 2600", source: "market-data-service", sourceId: "XAUUSD",
    timestamp: NOW, data: { price: 2600 }, relevance: 1, confidence: 0.9,
    provenance: { producer: "market-data-service", retrievedAt: NOW.toISOString() }, createdAt: NOW,
  };
  return {
    run: { id: runId, input: {} } as RunTrace["run"],
    steps: (over.steps ?? [{}]).map((o) => ({ ...step, ...o })) as RunTrace["steps"],
    toolCalls: (over.toolCalls ?? [{}]).map((o) => ({ ...tc, ...o })) as RunTrace["toolCalls"],
    evidence: (over.evidence ?? [{}]).map((o) => ({ ...ev, ...o })) as RunTrace["evidence"],
  };
}

const DEF = makeDef();
const check = (output: unknown, t: RunTrace = trace(), def: AgentDefinition = DEF) =>
  checkOutputIntegrity({ output, trace: t, definition: def, registry });

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Output Integrity validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // valid case
  // ----------------------------------------------------------------

  await test("VALID: well-formed output, evidence belongs to the run, lineage intact -> PASS", () => {
    const r = check({
      kind: "market-intelligence-conclusion",
      resolved: true,
      bias: "neutral",
      basis: ["regime: low-volatility"],
      evidenceIds: ["ev_1"],
      disclaimer: "Decision support only. Not a trade recommendation. No entry, stop, target or position size.",
    });
    assert.equal(r.passed, true, JSON.stringify(r.violations));
    assert.equal(r.lineage.complete, true);
    assert.equal(r.lineage.links[0].capability, registry.describe("market.snapshot").wraps);
  });

  // ----------------------------------------------------------------
  // adversarial cases - each must deterministically FAIL
  // ----------------------------------------------------------------

  const fails = (name: string, output: unknown, expectCode: string, t?: RunTrace, def?: AgentDefinition) =>
    test(`INVALID: ${name} -> FAIL (${expectCode})`, () => {
      const r = check(output, t, def);
      assert.equal(r.passed, false);
      assert.ok(r.violations.some((x) => x.code === expectCode), `expected code ${expectCode}, got ${JSON.stringify(r.violations.map((x) => x.code))}`);
    });

  await fails("malformed output (string)", "not an object", "malformed_output");
  await fails("malformed output (array)", [1, 2, 3], "malformed_output");
  await fails("resolved with no evidence cited", { resolved: true, basis: ["x"], evidenceIds: [] }, "unsupported_claim");
  await fails("resolved with empty basis", { resolved: true, basis: [], evidenceIds: ["ev_1"] }, "unsupported_claim");
  await fails("foreign evidenceId (not in run)", { resolved: true, basis: ["x"], evidenceIds: ["ev_FOREIGN"] }, "foreign_evidence_id");
  await fails(
    "evidence row from a different run",
    { resolved: true, basis: ["x"], evidenceIds: ["ev_1"] },
    "broken_lineage",
    trace({ evidence: [{ runId: "some_other_run" }] }),
  );
  await fails(
    "evidence -> toolCall that isn't in the run",
    { resolved: true, basis: ["x"], evidenceIds: ["ev_1"] },
    "broken_lineage",
    trace({ evidence: [{ toolCallId: "tc_MISSING" }] }),
  );
  await fails(
    "evidence -> unregistered tool",
    { resolved: true, basis: ["x"], evidenceIds: ["ev_1"] },
    "broken_lineage",
    trace({ toolCalls: [{ toolId: "totally.made.up" }] }),
  );
  await fails(
    "invalid provenance (empty producer)",
    { resolved: true, basis: ["x"], evidenceIds: ["ev_1"] },
    "invalid_evidence",
    trace({ evidence: [{ provenance: { producer: "", retrievedAt: NOW.toISOString() } }] }),
  );
  await fails(
    "credential in provenance",
    { resolved: true, basis: ["x"], evidenceIds: ["ev_1"] },
    "sensitive_data",
    trace({ evidence: [{ provenance: { producer: "x", retrievedAt: NOW.toISOString(), api_key: "sk-abc123def456" } as never }] }),
  );
  await fails("forbidden trading field (entryZone)", { evidenceIds: ["ev_1"], entryZone: [2600, 2610] }, "forbidden_trading_field");
  await fails("forbidden trading field nested (setup.stopLoss)", { evidenceIds: ["ev_1"], setup: { stopLoss: 2590 } }, "forbidden_trading_field");
  await fails("forbidden signal language in summary", { evidenceIds: ["ev_1"], summary: "This is a strong buy signal right now" }, "forbidden_signal_language");
  await fails("win-rate claim", { evidenceIds: ["ev_1"], note2: "expected win-rate 72%" }, "forbidden_signal_language");
  await fails("malformed summary (number)", { evidenceIds: ["ev_1"], summary: 5 }, "malformed_output");

  await test("disclaimer field is allowed to say 'not a trade recommendation'", () => {
    const r = check({
      resolved: false,
      evidenceIds: ["ev_1"],
      disclaimer: "Not a buy or sell recommendation. No entry, stop or target.",
    });
    // 'buy'/'sell' inside the whitelisted disclaimer key must NOT trip the checker
    assert.ok(!r.violations.some((x) => x.code === "forbidden_signal_language"), JSON.stringify(r.violations));
  });

  await test("autonomy >= 2 agent MAY carry position fields (not constrained)", () => {
    const l2 = makeDef({ autonomyLevel: 2 });
    const r = check({ evidenceIds: ["ev_1"], positionSize: 0.1 }, trace(), l2);
    assert.ok(!r.violations.some((x) => x.code === "forbidden_trading_field"));
  });

  await test("buildLineage: reports gaps for a foreign id and a missing step", () => {
    const l = buildLineage({ evidenceIds: ["ev_1", "ev_X"] }, trace({ evidence: [{ stepId: "step_GONE" }] }), registry);
    assert.equal(l.complete, false);
    assert.ok(l.gaps.some((g) => g.includes("ev_X")));
    assert.ok(l.gaps.some((g) => g.includes("step_GONE")));
  });

  // ----------------------------------------------------------------
  // runtime integration: integrity gate blocks "succeeded"
  // ----------------------------------------------------------------

  await test("RUNTIME: a specialist emitting a forbidden field -> run FAILS output_integrity", async () => {
    // A planner whose synthesis deliberately violates the constraint.
    const badPlanner: RunPlanner = {
      async plan() {
        return {
          requests: [{ toolId: "test.noop", input: {}, rationale: "test" }],
          rationale: "test plan",
          planMetadata: { specialist: "test" },
        };
      },
      async synthesizeOutput(t) {
        return {
          output: { kind: "bad", evidenceIds: t.evidence.map((e) => e.id), entry: 2600, stopLoss: 2590, summary: "strong buy" },
          summary: "deliberately non-compliant output",
        };
      },
    };
    const noop: ToolImplementation<Record<string, never>, { ok: true }> = {
      definition: {
        id: "test.noop", name: "noop", description: "t", version: "1.0.0", category: "RESEARCH",
        inputSchema: { type: "object" }, outputSchema: { type: "object" },
        requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: 0,
        creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
        evidence: { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "test" },
        status: "active", wraps: "n/a",
      },
      parseInput: () => ({ ok: true, value: {} }),
      checkOutput: () => ({ valid: true, violations: [] }),
      handler: async () => ({
        output: { ok: true },
        evidence: [{
          type: "derived", claim: "noop ran", source: "test", sourceId: "noop",
          timestamp: new Date().toISOString(), data: {}, relevance: 1, confidence: 1,
          provenance: { producer: "test", retrievedAt: new Date().toISOString() },
        }],
      }),
    };
    const reg = new ToolRegistry().register(noop).freeze();
    const runtime = new AgentRuntime({ registry: reg, planner: badPlanner });
    const def = makeDef({ type: "RESEARCH", tools: [{ toolId: "test.noop" }], permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] } });

    const { runId } = await runtime.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await runtime.runToCompletion(runId);
    const t = await agentRunRepository.getRunTrace(runId);

    assert.equal(final?.status, "failed", `expected failed, got ${final?.status}`);
    assert.equal(final?.errorCode, "output_integrity");
    assert.match(final?.errorMessage ?? "", /forbidden_trading_field|forbidden_signal_language/);

    const evalStep = t.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep, "an evaluation step recording the integrity result must exist");
    assert.equal(evalStep!.status, "error");
    assert.equal((evalStep!.output as { passed?: boolean }).passed, false);
  });

  await test("RUNTIME: a compliant run still reaches succeeded (integrity PASS)", async () => {
    const runtime = new AgentRuntime(); // production supervisor + registry
    const { runId } = await runtime.startRun({
      definition: makeDef({ tools: [{ toolId: "market.snapshot" }, { toolId: "market.intelligence" }] }),
      input: { question: "Analyze XAUUSD for a bullish or bearish lean", symbol: "XAUUSD" },
      userId: TEST_USER,
    });
    const final = await runtime.runToCompletion(runId);
    const t = await agentRunRepository.getRunTrace(runId);
    assert.ok(["succeeded", "tool_error"].includes(final!.status), `status ${final!.status}`);
    if (final!.status === "succeeded") {
      const evalStep = t.steps.find((s) => s.kind === "evaluation");
      assert.equal((evalStep!.output as { passed?: boolean }).passed, true);
      console.log(`      -> succeeded with integrity PASS, ${t.evidence.length} evidence`);
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
