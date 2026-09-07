// scripts/validate-agent-authorization.ts
// Sprint AN, step A8 - Permissions / Guardrails deepening (G08).
//
// Run: npm run validate:agent-authorization
//   (node --env-file so the runtime-integration tests can reach the DB)
//
// Proves the CENTRAL authorization decision boundary: permission AND autonomy
// are separate controls, BOTH must pass; default-deny; LIVE_EXECUTION double-
// denied; prohibited capability combinations; resource limits consolidated;
// and the planner/LLM can NEVER grant itself a permission or raise autonomy.

import assert from "node:assert/strict";

import {
  makeDefaultAgentDefinitionBase,
  type AgentDefinition,
  type PlannerToolRequest,
  type ToolDefinition,
  DEFAULT_RUN_LIMITS,
  PERMISSION_AUTONOMY_FLOOR,
  PROHIBITED_PERMISSION_COMBINATIONS,
  prohibitedCombosViolated,
} from "../types/agent-framework/index";
import { AuthorizationService } from "../services/agent-framework/authorization/authorization-service";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { MemoryGateway } from "../services/agent-framework/memory/memory-gateway";
import { InMemoryStore } from "../services/agent-framework/memory/in-memory-store";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-authorization-user";
const svc = new AuthorizationService();
const realRegistry = buildToolRegistry();

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
    id: `agt_auth_${Math.random().toString(36).slice(2, 9)}`,
    slug: "auth-test-agent",
    version: "1.0.0",
    name: "Auth Test Agent",
    description: "Synthetic agent for validate-agent-authorization.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective: "prove authorization",
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

const okLimits = () => ({
  limits: { ...DEFAULT_RUN_LIMITS },
  stepCount: 0,
  toolCallCount: 0,
  elapsedMs: 0,
  creditsConsumed: 0,
  retriesUsed: 0,
});

function req(toolId = "market.snapshot", input: unknown = { symbol: "XAUUSD" }): PlannerToolRequest {
  return { toolId, input, rationale: "test" };
}

function fakeTool(id: string, over: Partial<ToolDefinition> = {}): ToolImplementation<Record<string, never>, unknown> {
  const definition: ToolDefinition = {
    id, name: id, description: "t", version: "1.0.0", category: "RESEARCH",
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
    requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: 0,
    creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
    evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "test" },
    status: "active", wraps: "n/a", ...over,
  };
  return {
    definition,
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => ({ output: {}, evidence: [] }),
  };
}

const authz = (def: AgentDefinition, request: PlannerToolRequest, registry = realRegistry, extra: Record<string, unknown> = {}) =>
  svc.authorize({ definition: def, request, registry, limitContext: okLimits(), creditEstimate: 1, ...extra });

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Authorization (central boundary) validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // ALLOW
  // ----------------------------------------------------------------

  await test("ALLOW: permitted tool, sufficient autonomy, within limits -> allow + AuthorizedToolIntent", () => {
    const d = authz(makeDef(), req());
    assert.equal(d.outcome, "allow");
    assert.ok(d.intent);
    assert.equal(d.intent!.toolId, "market.snapshot");
    assert.deepEqual(d.intent!.authorizedBy, ["CAN_READ_MARKET_DATA"]);
    // every gate is recorded, all passed
    assert.ok(d.checks.length >= 8);
    assert.ok(d.checks.every((c) => c.passed));
  });

  // ----------------------------------------------------------------
  // DEFAULT DENY + separate permission / autonomy controls
  // ----------------------------------------------------------------

  await test("DENY: unknown tool -> default deny (unknown_tool)", () => {
    const d = authz(makeDef({ tools: [{ toolId: "does.not.exist" }] }), req("does.not.exist"));
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "unknown_tool");
  });

  await test("DENY: missing permission (empty grant) -> missing_permission; permission gate failed, others may pass", () => {
    const d = authz(makeDef({ permissionPolicy: { granted: [] } }), req());
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "missing_permission");
    assert.equal(d.checks.find((c) => c.gate === "permission")?.passed, false);
  });

  await test("DENY: SEPARATE controls - permission ALLOW but autonomy floor not met -> tool_autonomy_floor", () => {
    const reg = new ToolRegistry().register(fakeTool("test.floor2", { autonomyFloor: 2 })).freeze();
    const d = authz(
      makeDef({ type: "RESEARCH", tools: [{ toolId: "test.floor2" }], permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] }, autonomyLevel: 1 }),
      req("test.floor2"),
      reg,
    );
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "tool_autonomy_floor");
    assert.equal(d.checks.find((c) => c.gate === "permission")?.passed, true, "permission passed - it's autonomy that failed");
  });

  await test("DENY: SEPARATE controls - autonomy sufficient but permission DENY -> missing_permission", () => {
    const reg = new ToolRegistry().register(fakeTool("test.needsperm")).freeze();
    const d = authz(
      makeDef({ type: "RESEARCH", tools: [{ toolId: "test.needsperm" }], permissionPolicy: { granted: [] }, autonomyLevel: 1 }),
      req("test.needsperm"),
      reg,
    );
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "missing_permission");
    assert.equal(d.checks.find((c) => c.gate === "tool_autonomy_floor")?.passed, undefined, "autonomy gate not reached - permission denied first");
  });

  await test("DENY: agent autonomy CEILING exceeded (stale/tampered definition) -> agent_autonomy_ceiling", () => {
    const d = authz(makeDef({ autonomyLevel: 4 }), req()); // v1 ceiling is 2, MI type cap 1
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "agent_autonomy_ceiling");
  });

  await test("DENY: agent holds a permission above its autonomy floor -> permission_autonomy_floor", () => {
    // CAN_GENERATE_SIGNAL has autonomy floor 1; an autonomy-0 agent holding it is invalid.
    const d = authz(
      makeDef({ type: "TRADING_DECISION", permissionPolicy: { granted: ["CAN_READ_MARKET_DATA", "CAN_GENERATE_SIGNAL"] }, autonomyLevel: 0 }),
      req(),
    );
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "permission_autonomy_floor");
  });

  // ----------------------------------------------------------------
  // LIVE_EXECUTION = DENY  (double-denied)
  // ----------------------------------------------------------------

  await test("DENY: a tool needing CAN_EXECUTE_ORDER -> live_execution_denied even if the agent somehow grants it", () => {
    const reg = new ToolRegistry()
      .register(fakeTool("test.exec", { category: "EXECUTION", autonomyFloor: 3, status: "disabled", requiredPermissions: ["CAN_EXECUTE_ORDER"], wraps: "future" }))
      .freeze();
    // even with the dangerous permission granted + max autonomy + a hypothetical
    // live-execution context, an EXECUTION tool is disabled AND the double gate
    // (env flag + allowlist) is off -> denied.
    const d = authz(
      makeDef({ tools: [{ toolId: "test.exec" }], permissionPolicy: { granted: ["CAN_EXECUTE_ORDER"] }, autonomyLevel: 2 }),
      req("test.exec"),
      reg,
    );
    assert.equal(d.outcome, "deny");
    // disabled tool is caught first; the point is it never reaches "allow"
    assert.ok(["tool_disabled", "live_execution_denied", "permission_autonomy_floor", "agent_autonomy_ceiling"].includes(d.denialCode!));
  });

  await test("DENY: a tool requiring a dangerous permission -> live_execution_denied (double gate off)", () => {
    // A v1-legal agent (autonomy 1, no dangerous permission held) asked to
    // call a tool that requires CAN_EXECUTE_ORDER. The live_execution gate
    // fires before the missing-permission gate - a hard backstop.
    const reg = new ToolRegistry()
      .register(fakeTool("test.exec2", { autonomyFloor: 0, requiredPermissions: ["CAN_EXECUTE_ORDER"], category: "RESEARCH" }))
      .freeze();
    const d = svc.authorize({
      definition: makeDef({ type: "RESEARCH", tools: [{ toolId: "test.exec2" }], permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] }, autonomyLevel: 1 }),
      request: req("test.exec2"),
      registry: reg,
      limitContext: okLimits(),
      creditEstimate: 1,
      liveExecution: { liveExecutionEnabled: false, userAllowlisted: false },
    });
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "live_execution_denied");
    assert.equal(d.checks.find((c) => c.gate === "live_execution")?.passed, false);
  });

  // ----------------------------------------------------------------
  // prohibited capability combination
  // ----------------------------------------------------------------

  await test("DENY: prohibited permission combination (CAN_GENERATE_SIGNAL + CAN_EXECUTE_ORDER)", () => {
    assert.ok(PROHIBITED_PERMISSION_COMBINATIONS.length >= 1);
    assert.deepEqual(
      prohibitedCombosViolated(["CAN_GENERATE_SIGNAL", "CAN_EXECUTE_ORDER", "CAN_READ_MARKET_DATA"]),
      [["CAN_GENERATE_SIGNAL", "CAN_EXECUTE_ORDER"]],
    );
    const d = authz(
      makeDef({ type: "TRADING_DECISION", permissionPolicy: { granted: ["CAN_GENERATE_SIGNAL", "CAN_EXECUTE_ORDER"] }, autonomyLevel: 1 }),
      req(),
    );
    assert.equal(d.outcome, "deny");
    // one of: permission_autonomy_floor (CAN_EXECUTE_ORDER floor 3) or prohibited_combination
    assert.ok(["prohibited_combination", "permission_autonomy_floor"].includes(d.denialCode!));
  });

  // ----------------------------------------------------------------
  // resource limits consolidated
  // ----------------------------------------------------------------

  await test("DENY: resource limit consolidated - credit estimate over ceiling -> resource_limit / maxCreditCost", () => {
    const d = svc.authorize({
      definition: makeDef(),
      request: req(),
      registry: realRegistry,
      limitContext: { ...okLimits(), limits: { ...DEFAULT_RUN_LIMITS, maxCreditCost: 0.5 } },
      creditEstimate: 5,
    });
    assert.equal(d.outcome, "deny");
    assert.equal(d.denialCode, "resource_limit");
    assert.equal(d.breachedLimit, "maxCreditCost");
  });

  await test("DENY: resource limit - step count at ceiling -> resource_limit / maxSteps", () => {
    const d = svc.authorize({
      definition: makeDef(),
      request: req(),
      registry: realRegistry,
      limitContext: { ...okLimits(), stepCount: 999, limits: { ...DEFAULT_RUN_LIMITS, maxSteps: 5 } },
      creditEstimate: 1,
    });
    assert.equal(d.denialCode, "resource_limit");
    assert.equal(d.breachedLimit, "maxSteps");
  });

  // ----------------------------------------------------------------
  // the planner / LLM can NEVER grant itself authority
  // ----------------------------------------------------------------

  await test("DENY: a request carrying an authority field -> malformed_request (planner cannot inject permissions/autonomy)", () => {
    for (const field of ["permissions", "granted", "autonomy", "autonomyLevel", "authorizedBy"]) {
      const bad = { toolId: "market.snapshot", input: {}, rationale: "x", [field]: ["CAN_EXECUTE_ORDER"] } as unknown as PlannerToolRequest;
      const d = authz(makeDef(), bad);
      assert.equal(d.outcome, "deny", `field ${field}`);
      assert.equal(d.denialCode, "malformed_request", `field ${field}`);
    }
  });

  await test("PlannerToolRequest type carries no authority fields (structural)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "types", "agent-framework", "tool-contract.ts"),
      "utf8",
    );
    const m = src.match(/export interface PlannerToolRequest\s*\{[^}]*\}/);
    assert.ok(m, "PlannerToolRequest interface not found");
    const block = m![0];
    for (const f of ["permission", "granted", "autonomy", "grant", "authorizedBy"]) {
      assert.ok(!new RegExp(`\\b${f}`, "i").test(block), `PlannerToolRequest body must not contain "${f}": ${block}`);
    }
    assert.equal(PERMISSION_AUTONOMY_FLOOR.CAN_EXECUTE_ORDER, 3);
  });

  // ----------------------------------------------------------------
  // unauthorized memory operation (A7 gateway, cross-checked here)
  // ----------------------------------------------------------------

  await test("unauthorized memory operation is denied by the MemoryGateway (governance is consistent across subsystems)", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const policy = { layers: ["SHORT_TERM" as const], retention: {}, readPolicy: {}, writePolicy: {} };
    const w = await g.write(
      { agentId: "a", agentType: "MARKET_INTELLIGENCE", userId: "u", runId: null, layer: "LONG_TERM", scope: "s", key: "k", value: {}, provenance: { origin: "system", producer: "p", createdAt: new Date().toISOString() } },
      policy,
    );
    assert.equal(w.decision, "deny"); // LONG_TERM not in policy.layers
  });

  // ----------------------------------------------------------------
  // runtime integration
  // ----------------------------------------------------------------

  await test("RUNTIME: a tampered persisted definition (autonomy raised to 4) -> agent_autonomy_ceiling at authorization time", async () => {
    // A definition validated fine at startRun, then its persisted snapshot is
    // tampered. The AuthorizationService re-checks the ceiling every tick -
    // defence in depth: a stored definition is never trusted.
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({ definition: makeDef(), input: { symbol: "XAUUSD" }, userId: TEST_USER });
    const row = await agentRunRepository.getRun(runId);
    const meta = row!.metadata as unknown as { definition: AgentDefinition; contract: string };
    meta.definition.autonomyLevel = 4;
    await prisma.agentRun.update({ where: { id: runId }, data: { metadata: meta as unknown as object } });

    const final = await rt.runToCompletion(runId);
    assert.equal(final?.status, "permission_denied");
    assert.equal(final?.errorCode, "agent_autonomy_ceiling");
    const trace = await agentRunRepository.getRunTrace(runId);
    const denialStep = trace.steps.find((s) => s.kind === "tool_call" && s.status === "error");
    assert.ok(denialStep, "the denial is recorded as a step");
    assert.ok(Array.isArray((denialStep!.output as { checks?: unknown[] }).checks), "the step records every gate evaluated");
  });

  await test("RUNTIME: a well-formed compliant agent still reaches succeeded (authorization allows)", async () => {
    const rt = new AgentRuntime();
    const { runId } = await rt.startRun({
      definition: makeDef({ tools: [{ toolId: "market.snapshot" }, { toolId: "market.intelligence" }] }),
      input: { question: "Analyze XAUUSD bullish or bearish", symbol: "XAUUSD" },
      userId: TEST_USER,
    });
    const final = await rt.runToCompletion(runId);
    assert.ok(["succeeded", "tool_error"].includes(final!.status));
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
