// scripts/validate-agent-evaluation.ts
// Sprint AN, step A10 - Evaluation + Observability (G10).
//
// Run: npm run validate:agent-evaluation
//
// A10 is NOT another authorization/integrity engine. It READS the recorded
// results of A6 (integrity step), A8 (denial steps) and A9 (ledger) from the
// persisted trace and SCORES them into a structured, auditable AgentEvaluation.

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  makeDefaultAgentDefinitionBase,
  type AgentDefinition,
  AGENT_EVALUATION_DIMENSIONS,
} from "../types/agent-framework/index";
import { EvaluationService, EVALUATOR_VERSION } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { getRunObservability } from "../services/agent-framework/evaluation/observability";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import type { RunPlanner } from "../services/agent-framework/supervisor/run-planner";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-evaluation-user";

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
    id: `agt_ev_${Math.random().toString(36).slice(2, 9)}`,
    slug: "eval-test-agent",
    version: "1.0.0",
    name: "Eval Test Agent",
    description: "Synthetic agent for validate-agent-evaluation.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective: "prove evaluation",
    instructions: "n/a",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: [{ toolId: "market.snapshot" }, { toolId: "market.intelligence" }],
    permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function fakeTool(id: string, over: Partial<ToolImplementation<Record<string, never>, unknown>["definition"]> = {}): ToolImplementation<Record<string, never>, unknown> {
  return {
    definition: {
      id, name: id, description: "t", version: "1.0.0", category: "RESEARCH",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "t" },
      status: "active", wraps: "n/a", ...over,
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => ({
      output: {},
      evidence: [{ type: "derived", claim: `${id} ran`, source: "t", sourceId: id, timestamp: new Date().toISOString(), data: {}, relevance: 1, confidence: 1, provenance: { producer: "t", retrievedAt: new Date().toISOString() } }],
    }),
  };
}

/** A runtime + evaluator sharing one in-memory ledger + eval store. */
function harness(opts: { registry?: ToolRegistry; planner?: RunPlanner; allowance?: number } = {}) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(opts.allowance ?? 100000) });
  const store = new InMemoryEvaluationStore();
  const registry = opts.registry ?? buildToolRegistry();
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store });
  const rt = new AgentRuntime({ registry, planner: opts.planner, creditLedger: ledger, evaluation });
  return { rt, evaluation, ledger, store };
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Evaluation + Observability validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // succeeded run
  // ----------------------------------------------------------------

  await test("SUCCEEDED run: structured evaluation, high composite, all 7 dimensions, failureCategory none", async () => {
    const { rt, evaluation } = harness();
    const { runId } = await rt.startRun({ definition: makeDef(), input: { question: "Analyze XAUUSD bullish or bearish", symbol: "XAUUSD" }, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    if (final?.status !== "succeeded") {
      console.log(`      (skipped assertions - provider gave ${final?.status})`);
      return;
    }
    const ev = await evaluation.getForRun(runId);
    assert.ok(ev, "the runtime auto-evaluated the run at its terminal transition");
    assert.equal(ev!.evaluatorVersion, EVALUATOR_VERSION);
    assert.equal(ev!.terminalStatus, "succeeded");
    assert.equal(ev!.failureCategory, "none");
    assert.deepEqual(ev!.scores.map((s) => s.dimension).sort(), [...AGENT_EVALUATION_DIMENSIONS].sort());
    for (const s of ev!.scores) {
      assert.ok(s.score >= 0 && s.score <= 1, `${s.dimension} score in range`);
      assert.ok(typeof s.basis === "string" && s.basis.length > 0, `${s.dimension} has a human-readable basis, not a bare number`);
    }
    assert.equal(ev!.scores.find((s) => s.dimension === "completion")!.score, 1);
    assert.equal(ev!.scores.find((s) => s.dimension === "integrity")!.score, 1);
    assert.ok(ev!.compositeScore >= 0.8, `composite ${ev!.compositeScore} should be high for a clean success`);
    // measurable signals - structured, not a log string
    const sig = ev!.measurableSignals;
    for (const k of ["stepCount", "toolCallCount", "evidenceCount", "creditsCharged", "wallMs", "planningPath", "specialist", "integrityPassed"]) {
      assert.ok(k in sig, `measurableSignals.${k}`);
    }
    assert.equal(sig.specialist, "MARKET_INTELLIGENCE");
    assert.equal(sig.integrityPassed, true);
    console.log(`      -> composite ${ev!.compositeScore}, ${sig.toolCallCount} tools, ${sig.evidenceCount} evidence, ${sig.creditsCharged} credits`);
  });

  await test("idempotent: evaluate() twice -> the same result", async () => {
    const { rt, evaluation } = harness();
    const { runId } = await rt.startRun({ definition: makeDef(), input: { symbol: "XAUUSD" }, userId: TEST_USER });
    await rt.runToCompletion(runId);
    const a = await evaluation.evaluate(runId);
    const b = await evaluation.evaluate(runId);
    assert.deepEqual(a, b);
  });

  // ----------------------------------------------------------------
  // credit failure
  // ----------------------------------------------------------------

  await test("credit_limit run: failureCategory 'credit', completion 0.7 (expected guardrail), analysis names it", async () => {
    const reg = new ToolRegistry().register(fakeTool("t.a")).register(fakeTool("t.b")).freeze();
    const { rt, evaluation } = harness({ registry: reg, allowance: 1 });
    const def = makeDef({ type: "RESEARCH", tools: [{ toolId: "t.a" }, { toolId: "t.b" }], permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] } });
    const { runId } = await rt.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "credit_limit");

    const ev = await evaluation.getForRun(runId);
    assert.equal(ev!.failureCategory, "credit");
    assert.equal(ev!.terminalStatus, "credit_limit");
    assert.equal(ev!.scores.find((s) => s.dimension === "completion")!.score, 0.7);
    assert.match(ev!.failureAnalysis, /credit/i);
    assert.equal(ev!.measurableSignals.errorCode, "insufficient_credits");
    assert.ok(ev!.compositeScore < 0.7);
  });

  // ----------------------------------------------------------------
  // integrity failure
  // ----------------------------------------------------------------

  await test("integrity-failed run: failureCategory 'integrity', integrity score 0, low composite", async () => {
    const badPlanner: RunPlanner = {
      async plan() { return { requests: [{ toolId: "t.x", input: {}, rationale: "t" }], rationale: "p", planMetadata: { specialist: "test", planningPath: "deterministic" } }; },
      async synthesizeOutput(t) { return { output: { kind: "bad", evidenceIds: t.evidence.map((e) => e.id), entry: 2600, summary: "strong buy" }, summary: "non-compliant" }; },
    };
    const reg = new ToolRegistry().register(fakeTool("t.x")).freeze();
    const { rt, evaluation } = harness({ registry: reg, planner: badPlanner });
    const def = makeDef({ type: "RESEARCH", tools: [{ toolId: "t.x" }], permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] } });
    const { runId } = await rt.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "failed");

    const ev = await evaluation.getForRun(runId);
    assert.equal(ev!.failureCategory, "integrity");
    assert.equal(ev!.scores.find((s) => s.dimension === "integrity")!.score, 0);
    assert.ok(ev!.measurableSignals.integrityViolationCount as number >= 1);
    assert.ok(ev!.compositeScore < 0.6);
  });

  // ----------------------------------------------------------------
  // authorization overreach
  // ----------------------------------------------------------------

  await test("permission-denied run: failureCategory 'expected_guardrail', authorization score reduced", async () => {
    const { rt, evaluation } = harness();
    const def = makeDef({ permissionPolicy: { granted: [] } }); // no CAN_READ_MARKET_DATA
    const { runId } = await rt.startRun({ definition: def, input: { symbol: "XAUUSD" }, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "permission_denied");

    const ev = await evaluation.getForRun(runId);
    assert.equal(ev!.failureCategory, "expected_guardrail");
    assert.equal(ev!.scores.find((s) => s.dimension === "authorization")!.score, 0.4);
    assert.ok((ev!.measurableSignals.deniedGateCount as number) >= 1);
  });

  // ----------------------------------------------------------------
  // observability read model
  // ----------------------------------------------------------------

  await test("getRunObservability: assembles Run -> Steps -> ToolCalls -> Evidence -> Credits -> Evaluation -> timeline", async () => {
    const { rt, evaluation, ledger } = harness();
    const { runId } = await rt.startRun({ definition: makeDef(), input: { symbol: "XAUUSD" }, userId: TEST_USER });
    await rt.runToCompletion(runId);

    const obs = await getRunObservability(runId, { creditLedger: ledger, evaluation });
    assert.ok(obs);
    assert.equal(obs!.run!.id, runId);
    assert.ok(Array.isArray(obs!.steps) && obs!.steps.length >= 1);
    assert.ok(Array.isArray(obs!.timeline) && obs!.timeline.length === obs!.steps.length);
    assert.ok("totalCharged" in obs!.credits);
    assert.ok(obs!.evaluation, "the evaluation is part of the observability model");
    assert.equal(obs!.evaluation!.runId, runId);
    // timeline entries are structured
    for (const t of obs!.timeline) {
      assert.ok(typeof t.kind === "string" && typeof t.durationMs === "number");
    }
  });

  // ----------------------------------------------------------------
  // contract + migration parity
  // ----------------------------------------------------------------

  await test("AGENT_EVALUATION_DIMENSIONS has the 7 locked dimensions", () => {
    assert.deepEqual([...AGENT_EVALUATION_DIMENSIONS].sort(), [
      "authorization", "completion", "evidence", "groundedness", "integrity", "limits_respected", "tool_selection",
    ]);
  });

  await test("A10 migration present, additive-only, NOT APPLIED", () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations", "20260907130000_add_agent_evaluation", "migration.sql");
    assert.ok(existsSync(p));
    const sql = readFileSync(p, "utf8");
    assert.match(sql, /STATUS: NOT APPLIED/);
    assert.match(sql, /Never run `prisma migrate dev`/);
    assert.ok(!/\bDROP\b/i.test(sql) && !/ALTER TABLE/i.test(sql));
    assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]), ["AgentEvaluation"]);
    assert.match(sql, /CREATE UNIQUE INDEX "AgentEvaluation_runId_key"/);
  });

  await test("A10 does not re-implement authorization or integrity (structural)", async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "agent-framework", "evaluation");
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
      // it READS the integrity helper (buildLineage) but never the checker, and never the authorizer
      assert.ok(!importLines.some((l) => /checkOutputIntegrity|authorization-service|authorizationService/.test(l)), `${f} must not import the A6 checker or the A8 authorizer`);
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
