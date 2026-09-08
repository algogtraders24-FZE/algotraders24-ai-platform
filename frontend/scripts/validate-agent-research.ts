// scripts/validate-agent-research.ts
// Sprint AN, step A11 - the Research Agent (G11 target).
//
// House style (node:assert/strict, tsx). Run: npm run validate:agent-research
//
// A11 adds an agent DEFINITION + a planning/synthesis SPECIALIST + two thin
// tool ADAPTERS over EXISTING AT24 capabilities. It adds NO new runtime, NO
// new planner, NO new store, NO web-search provider.
//
// Proves:
//   - researchAgentDefinition() is a valid AF-v1 AgentDefinition (RESEARCH
//     type, autonomy 1, the 2 bound tools, seeded permissions)
//   - RESEARCH -> researchSpecialist; deterministic plan is
//     knowledge_search -> news.search, NO LLM, NO research.web_search
//   - research.web_search is NOT registered (owner G10: "do not invent a new
//     ... web-search provider")
//   - the specialist NEVER imports lib/ai or the executor (structural)
//   - E2E on a FAKE registry: goal -> Supervisor -> researchSpecialist ->
//     knowledge_search + news.search -> AgentEvidence -> evidence-first
//     "research-brief" -> A6 integrity PASS -> A10 evaluation persisted
//   - the brief CITES evidence (evidenceIds) and never restates source text;
//     no forbidden trading field / signal language; disclaimer present
//   - honest emptiness: no evidence -> coverage "no-coverage", resolved false,
//     NO fabricated citations
//   - E2E on the REAL registry (best-effort): a clean terminal state either
//     way (succeeded, or tool_error when an embedding/news provider is absent)

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateAgentDefinition,
  type AgentDefinition,
  type ToolDefinition,
  AGENT_EVALUATION_DIMENSIONS,
} from "../types/agent-framework/index";
import { isKnownAgentType, autonomyCapForType } from "../services/agent-framework/agent-type-registry";
import { selectSpecialist, SupervisorService } from "../services/agent-framework/supervisor/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry, REGISTERED_TOOL_IDS } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import {
  researchAgentDefinition,
  runResearchAgent,
  RESEARCH_AGENT_TOOL_IDS,
} from "../services/agent-framework/agents/research-agent";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

// Per-process unique so concurrent runs (or a peer session against the same
// shared DB) never clobber each other's runs via cleanup() mid-execution.
const TEST_USER = `validate-agent-research-${process.pid}-${Date.now().toString(36)}`;
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

// ------------------------------------------------------------------
// Fake, dependency-free stand-ins for the two real adapters, registered
// under the SAME ids so the agent definition's bindings resolve.
// ------------------------------------------------------------------

function fakeTool(
  id: string,
  category: ToolDefinition["category"],
  permission: ToolDefinition["requiredPermissions"][number],
  evidenceType: "research_document" | "news",
  hits: { claim: string; source: string; relevance: number }[],
): ToolImplementation<Record<string, never>, { hits: unknown[] }> {
  return {
    definition: {
      id, name: id, description: `fake ${id}`, version: "1.0.0", category,
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: [permission], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: [evidenceType], provenanceProducer: `fake-${evidenceType}` },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { hits: hits.map((h) => ({ ...h })) },
        evidence: hits.map((h) => ({
          type: evidenceType,
          claim: h.claim,
          source: h.source,
          sourceId: `${h.source}:${h.claim.slice(0, 12)}`,
          timestamp: now,
          data: { claim: h.claim, source: h.source },
          relevance: h.relevance,
          confidence: h.relevance,
          provenance: { producer: `fake-${evidenceType}`, retrievedAt: now },
        })),
      };
    },
  };
}

function fakeRegistry(opts: { knowledge?: typeof KNOW_HITS; news?: typeof NEWS_HITS } = {}): ToolRegistry {
  return new ToolRegistry()
    .register(fakeTool("research.knowledge_search", "RESEARCH", "CAN_RUN_RESEARCH", "research_document", opts.knowledge ?? KNOW_HITS))
    .register(fakeTool("news.search", "NEWS", "CAN_READ_NEWS", "news", opts.news ?? NEWS_HITS))
    .freeze();
}

const KNOW_HITS = [
  { claim: "Internal note: the desk treats the prior week high/low as the key liquidity reference for gold.", source: "knowledge:kb-1", relevance: 0.82 },
  { claim: "Internal note: range days into London often resolve on the New York open.", source: "knowledge:kb-1", relevance: 0.6 },
];
const NEWS_HITS = [
  { claim: "Central bank commentary reiterates a data-dependent stance.", source: "Reuters", relevance: 0.7 },
];

/** A runtime + evaluator sharing one in-memory ledger + eval store. */
function harness(registry: ToolRegistry) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const store = new InMemoryEvaluationStore();
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  return { rt, evaluation };
}

const FORBIDDEN_KEYS = ["entry", "stoploss", "takeprofit", "target", "positionsize", "signal", "side", "direction", "recommendation", "order", "trade"];
const FORBIDDEN_TEXT = [/\bbuy\b/i, /\bsell\b/i, /win[- ]?rate/i, /probability of profit/i];

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.13 - Research Agent (A11) validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. definition
  // ----------------------------------------------------------------

  await test("researchAgentDefinition(): valid AF-v1, RESEARCH type, autonomy 1, 2 bound tools", () => {
    const def = researchAgentDefinition();
    const res = validateAgentDefinition(def, { isRegisteredType: isKnownAgentType, autonomyCapForType });
    assert.equal(res.valid, true, JSON.stringify(res.violations));
    assert.equal(def.type, "RESEARCH");
    assert.equal(def.autonomyLevel, 1);
    assert.deepEqual(def.tools.map((t) => t.toolId).sort(), [...RESEARCH_AGENT_TOOL_IDS].sort());
    assert.deepEqual(def.permissionPolicy.granted.sort(), ["CAN_READ_NEWS", "CAN_RUN_RESEARCH", "CAN_USE_MEMORY"]);
    // no dangerous permission, no live-execution capability
    for (const p of def.permissionPolicy.granted) {
      assert.ok(p !== "CAN_CREATE_ORDER" && p !== "CAN_EXECUTE_ORDER" && p !== "CAN_GENERATE_SIGNAL");
    }
  });

  await test("the agent is NOT bound to research.web_search, and that tool is NOT registered", () => {
    const def = researchAgentDefinition();
    assert.ok(!def.tools.some((t) => t.toolId === "research.web_search"), "web_search must not be bound");
    assert.ok(!(REGISTERED_TOOL_IDS as readonly string[]).includes("research.web_search"), "web_search must not be registered");
    const reg = buildToolRegistry();
    assert.equal(reg.get("research.web_search"), undefined);
    // the two real adapters ARE registered
    assert.ok(reg.has("research.knowledge_search"));
    assert.ok(reg.has("news.search"));
  });

  // ----------------------------------------------------------------
  // 2. deterministic planning
  // ----------------------------------------------------------------

  await test("RESEARCH -> researchSpecialist; deterministic plan: knowledge_search -> news.search, no LLM", async () => {
    assert.equal(selectSpecialist("RESEARCH").key, "RESEARCH");
    const sup = new SupervisorService({ registry: fakeRegistry(), llmAssist: false });
    const plan = await sup.plan(
      researchAgentDefinition(),
      { question: "What does my knowledge base say about gold liquidity levels?", symbol: "XAUUSD" },
      { userId: TEST_USER, runId: "test-run" },
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["research.knowledge_search", "news.search"]);
    assert.equal(plan.planMetadata?.specialist, "RESEARCH");
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
    const kReq = plan.requests[0];
    assert.equal((kReq.input as { query?: string }).query, "What does my knowledge base say about gold liquidity levels?");
  });

  await test("structural: the research specialist never imports lib/ai or the executor", () => {
    const dir = join(ROOT, "services", "agent-framework", "supervisor", "specialists");
    const src = readFileSync(join(dir, "research.specialist.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b|await import\(/.test(l));
    assert.ok(!importLines.some((l) => l.includes("lib/ai")), "specialist must not import lib/ai");
    assert.ok(!importLines.some((l) => /tool-gateway|invokeTool/.test(l)), "specialist must not import the executor");
    assert.ok(!src.includes('"use client"'), "specialist is server-only");
  });

  await test("A11 added NO new infrastructure dir under agent-framework (definitions + specialist + adapters only)", () => {
    const base = join(ROOT, "services", "agent-framework");
    const dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    // the A1-A10 set + the new "agents" folder (definitions only). Nothing else.
    assert.deepEqual(dirs, ["agents", "authorization", "credits", "evaluation", "integrity", "memory", "runtime", "supervisor", "tools"]);
    // agents/ holds ONLY canonical agent definitions (one file per agent, A11+).
    const agentsFiles = readdirSync(join(base, "agents"));
    assert.ok(agentsFiles.includes("research-agent.ts"), "research-agent.ts present");
    assert.ok(agentsFiles.every((f) => f.endsWith("-agent.ts")), `agents/ holds only *-agent.ts definitions, got ${agentsFiles.join(", ")}`);
  });

  // ----------------------------------------------------------------
  // 3. E2E on a fake registry (deterministic)
  // ----------------------------------------------------------------

  await test("E2E (fake registry): goal -> researchSpecialist -> evidence-first brief -> integrity PASS -> evaluation", async () => {
    const registry = fakeRegistry();
    const { rt, evaluation } = harness(registry);
    const final = await runResearchAgent({
      userId: TEST_USER,
      goal: { question: "Summarise what I know about gold key levels", symbol: "XAUUSD" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);

    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.deepEqual(trace.toolCalls.map((t) => t.toolId), ["research.knowledge_search", "news.search"]);
    assert.equal(trace.evidence.length, KNOW_HITS.length + NEWS_HITS.length);

    const out = final!.output as Record<string, unknown>;
    assert.equal(out.kind, "research-brief");
    assert.equal(out.resolved, true);
    assert.equal(out.coverage, "knowledge-backed");
    assert.equal(out.knowledgeHits, KNOW_HITS.length);
    assert.equal(out.newsHits, NEWS_HITS.length);
    assert.ok(Array.isArray(out.evidenceIds) && (out.evidenceIds as string[]).length === trace.evidence.length);

    // every citation points at a real evidence row from THIS run; no free text
    const runEvidenceIds = new Set(trace.evidence.map((e) => e.id));
    for (const c of out.citations as Record<string, unknown>[]) {
      assert.ok(runEvidenceIds.has(c.evidenceId as string), "citation -> real evidence row");
      assert.deepEqual(Object.keys(c).sort(), ["confidence", "evidenceId", "relevance", "source", "sourceType"]);
      assert.ok(!("claim" in c) && !("statement" in c) && !("text" in c), "a citation never restates source text");
    }

    // A6 integrity gate ran and PASSED before "succeeded"
    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep && (evalStep.output as { passed?: boolean }).passed === true, "integrity PASS");

    // governance: not a signal
    const json = JSON.stringify(out).replace(JSON.stringify(out.disclaimer), '""');
    for (const k of Object.keys(out)) assert.ok(!FORBIDDEN_KEYS.includes(k.toLowerCase()), `key "${k}"`);
    for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(json), `text ${re}`);
    assert.ok(typeof out.disclaimer === "string" && (out.disclaimer as string).includes("not financial advice"));

    // A10 evaluation persisted, structured
    const ev = await evaluation.getForRun(final!.id);
    assert.ok(ev, "A10 evaluation was written at the terminal transition");
    assert.equal(ev!.terminalStatus, "succeeded");
    assert.deepEqual(ev!.scores.map((s) => s.dimension).sort(), [...AGENT_EVALUATION_DIMENSIONS].sort());
    assert.equal(ev!.measurableSignals.specialist, "RESEARCH");
    console.log(`      -> brief: ${out.coverage}, ${(out.citations as unknown[]).length} citations, composite ${ev!.compositeScore}`);
  });

  await test("honest emptiness: no knowledge + no news -> coverage 'no-coverage', resolved false, NO fabricated citations", async () => {
    const registry = fakeRegistry({ knowledge: [], news: [] });
    const { rt } = harness(registry);
    const final = await runResearchAgent({ userId: TEST_USER, goal: "anything at all", runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.coverage, "no-coverage");
    assert.equal(out.resolved, false);
    assert.equal((out.citations as unknown[]).length, 0);
    assert.equal((out.evidenceIds as unknown[]).length, 0);
    assert.equal(out.citationCount, 0);
  });

  await test("news-only: knowledge empty but news present -> coverage 'news-only', resolved true", async () => {
    const registry = fakeRegistry({ knowledge: [] });
    const { rt } = harness(registry);
    const final = await runResearchAgent({ userId: TEST_USER, goal: { question: "macro backdrop?", symbol: "XAUUSD" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.coverage, "news-only");
    assert.equal(out.resolved, true);
    assert.equal(out.knowledgeHits, 0);
    assert.equal(out.newsHits, NEWS_HITS.length);
  });

  // ----------------------------------------------------------------
  // 4. E2E on the REAL registry (best-effort)
  // ----------------------------------------------------------------

  await test("E2E (real registry): a clean terminal state either way; trace stays intact", async () => {
    const final = await runResearchAgent({
      userId: TEST_USER,
      goal: { question: "What is in my knowledge base about risk management?", symbol: "XAUUSD" },
    });
    assert.ok(
      ["succeeded", "tool_error"].includes(final!.status),
      `unexpected terminal status ${final!.status} (${final!.errorCode})`,
    );
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.ok(trace.steps.find((s) => s.kind === "plan"), "a plan step was persisted");
    if (final!.status === "succeeded") {
      const out = final!.output as Record<string, unknown>;
      assert.equal(out.kind, "research-brief");
      console.log(`      -> (live) ${out.coverage}, ${(out.citations as unknown[]).length} citations, ${trace.evidence.length} evidence`);
    } else {
      console.log(`      -> (live) embedding/news provider unavailable -> clean ${final!.errorCode}; trace intact`);
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
