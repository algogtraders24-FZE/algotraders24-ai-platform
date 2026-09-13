// scripts/validate-agent-support.ts
// Sprint CS1 - the Chat Support Agent.
//
// House style (node:assert/strict, tsx). Run: npm run validate:agent-support
//
// CS1 adds an agent DEFINITION + a planning/synthesis SPECIALIST + two thin
// tool ADAPTERS (over the EXISTING pgvector stack + read-only billing tables).
// It adds NO new runtime, NO new planner, NO new store, NO migration.
//
// Proves:
//   - supportAgentDefinition() is a valid AF-v1 AgentDefinition (SUPPORT type,
//     autonomy 1, the 2 bound tools, seeded permissions - both read-only)
//   - SUPPORT -> supportSpecialist; deterministic plan:
//       generic question  -> [support.knowledge_search]
//       account question  -> [support.knowledge_search, support.account_read]
//     NO LLM
//   - structural: neither the specialist nor either tool imports lib/ai, the
//     executor, or services/knowledge-loop (the K-series governance layer -
//     agent-framework INV-1); all server-only
//   - both tools are registered with the right category / permission / floor
//   - E2E on a FAKE registry: goal -> Supervisor -> supportSpecialist ->
//     support.knowledge_search (+ support.account_read for a billing goal) ->
//     AgentEvidence -> evidence-first "support-answer" -> A6 integrity PASS ->
//     A10 evaluation persisted
//   - the answer CITES evidence (evidenceIds) and never restates passage text,
//     never echoes the raw question; disclaimer present; no forbidden field
//   - A6 SIGNAL-LANGUAGE PROOF: a support passage that legitimately contains
//     "buy" / "sell" still passes the A6 gate, because the output holds only
//     citation refs, not the passage text
//   - honest emptiness: no coverage -> resolved false, escalate true, 0 citations
//   - mutation intent ("cancel my subscription") -> escalate true with the
//     account-change reason, even when the KB has material
//   - account findings are status-only (no apiKeyHash / signature / provider ref)
//   - E2E on the REAL registry (best-effort): a clean terminal state either way

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateAgentDefinition,
  validateToolDefinition,
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
  supportAgentDefinition,
  runSupportAgent,
  SUPPORT_AGENT_TOOL_IDS,
} from "../services/agent-framework/agents/support-agent";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

const TEST_USER = `validate-agent-support-${process.pid}-${Date.now().toString(36)}`;
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
// Fakes for the two real adapters, registered under the SAME ids.
// ------------------------------------------------------------------

function fakeKnowledgeTool(
  hits: { claim: string; topic: string; relevance: number }[],
): ToolImplementation<Record<string, never>, { hits: unknown[]; available: boolean }> {
  return {
    definition: {
      id: "support.knowledge_search", name: "support.knowledge_search", description: "fake",
      version: "1.0.0", category: "SUPPORT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_SUPPORT"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["research_document"], provenanceProducer: "fake-support" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { hits: hits.map((h) => ({ ...h })), available: true },
        evidence: hits.map((h) => ({
          type: "research_document", claim: h.claim, source: `support-kb:${h.topic}`,
          sourceId: `support-kb:${h.claim.slice(0, 12)}`, timestamp: now,
          data: { topic: h.topic, title: "fixture", similarity: h.relevance }, relevance: h.relevance,
          confidence: h.relevance, provenance: { producer: "fake-support", retrievedAt: now },
        })),
      };
    },
  };
}

function fakeAccountTool(
  findings: { domain: string; claim: string }[],
): ToolImplementation<Record<string, never>, { snapshot: unknown; domains: string[] }> {
  return {
    definition: {
      id: "support.account_read", name: "support.account_read", description: "fake",
      version: "1.0.0", category: "ACCOUNT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_ACCOUNT_RECORDS"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "fake-account" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { snapshot: { plan: { planId: "pro", accountStatus: "active" } }, domains: findings.map((f) => f.domain) },
        evidence: findings.map((f) => ({
          type: "derived", claim: f.claim, source: `account:${f.domain}`,
          sourceId: `account:${f.domain}`, timestamp: now, data: { domain: f.domain }, relevance: 0.9,
          confidence: 1, provenance: { producer: "fake-account", retrievedAt: now },
        })),
      };
    },
  };
}

const KB_HITS = [
  { claim: "To change your plan, open Settings → Billing and choose a new tier; the change applies immediately.", topic: "faq", relevance: 0.83 },
  { claim: "Downgrades take effect at the end of the current billing period.", topic: "policy", relevance: 0.61 },
];
// Hits that are above the tool's noise floor but below the specialist's
// STRONG-match threshold (0.6) - "retrieved something, but nothing that
// actually answers the question".
const KB_WEAK_HITS = [
  { claim: "The platform supports MT4 and MT5 Expert Advisors.", topic: "product", relevance: 0.52 },
  { claim: "Contact support for account issues.", topic: "faq", relevance: 0.48 },
];
// A passage that legitimately contains "buy" / "sell" - the A6 gate must NOT
// trip on it, because the agent output never restates this text.
const KB_HITS_WITH_TRADE_WORDS = [
  { claim: "To buy a marketplace product, open its listing and click Buy Now; to sell your own EA, apply as a vendor.", topic: "products", relevance: 0.8 },
];
const ACCOUNT_FINDINGS = [
  { domain: "subscription", claim: 'Subscription to "pro" is "active"; current period ends 2026-10-01.' },
  { domain: "plan", claim: 'Account plan tier is "pro"; account status "active".' },
];

function fakeRegistry(opts: { kb?: typeof KB_HITS; account?: typeof ACCOUNT_FINDINGS } = {}): ToolRegistry {
  return new ToolRegistry()
    .register(fakeKnowledgeTool(opts.kb ?? KB_HITS))
    .register(fakeAccountTool(opts.account ?? ACCOUNT_FINDINGS))
    .freeze();
}

function harness(registry: ToolRegistry) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const store = new InMemoryEvaluationStore();
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  return { rt, evaluation };
}

const FORBIDDEN_KEYS = ["entry", "stoploss", "takeprofit", "target", "positionsize", "signal", "side", "direction", "recommendation", "order", "trade"];
const FORBIDDEN_TEXT = [/\bbuy\b/i, /\bsell\b/i, /\bguaranteed\b/i, /win[- ]?rate/i];

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nCS1 - Chat Support Agent validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. definition
  // ----------------------------------------------------------------

  await test("supportAgentDefinition(): valid AF-v1, SUPPORT type, autonomy 1, 2 bound read-only tools", () => {
    const def = supportAgentDefinition();
    const res = validateAgentDefinition(def, { isRegisteredType: isKnownAgentType, autonomyCapForType });
    assert.equal(res.valid, true, JSON.stringify(res.violations));
    assert.equal(def.type, "SUPPORT");
    assert.equal(def.autonomyLevel, 1);
    assert.deepEqual(def.tools.map((t) => t.toolId).sort(), [...SUPPORT_AGENT_TOOL_IDS].sort());
    assert.deepEqual(def.permissionPolicy.granted.sort(), ["CAN_READ_ACCOUNT_RECORDS", "CAN_RUN_SUPPORT"]);
    for (const p of def.permissionPolicy.granted) {
      assert.ok(
        !["CAN_CREATE_ORDER", "CAN_EXECUTE_ORDER", "CAN_GENERATE_SIGNAL"].includes(p),
        `SUPPORT must not seed ${p}`,
      );
    }
  });

  // ----------------------------------------------------------------
  // 2. registry wiring
  // ----------------------------------------------------------------

  await test("both support tools are registered with the right category / permission / floor", () => {
    const reg = buildToolRegistry();
    assert.ok((REGISTERED_TOOL_IDS as readonly string[]).includes("support.knowledge_search"));
    assert.ok((REGISTERED_TOOL_IDS as readonly string[]).includes("support.account_read"));
    const kb = reg.require("support.knowledge_search").definition;
    const acct = reg.require("support.account_read").definition;
    assert.equal(kb.category, "SUPPORT");
    assert.equal(acct.category, "ACCOUNT");
    assert.deepEqual(kb.requiredPermissions, ["CAN_RUN_SUPPORT"]);
    assert.deepEqual(acct.requiredPermissions, ["CAN_READ_ACCOUNT_RECORDS"]);
    for (const d of [kb, acct]) {
      assert.equal(d.autonomyFloor, 0);
      assert.equal(d.executionMode, "sync");
      assert.equal(validateToolDefinition(d).valid, true, `${d.id} invalid: ${JSON.stringify(validateToolDefinition(d).violations)}`);
    }
  });

  // ----------------------------------------------------------------
  // 3. deterministic planning
  // ----------------------------------------------------------------

  await test("SUPPORT -> supportSpecialist; a non-account question plans [support.knowledge_search] only", async () => {
    assert.equal(selectSpecialist("SUPPORT").key, "SUPPORT");
    const sup = new SupervisorService({ registry: fakeRegistry(), llmAssist: false });
    const plan = await sup.plan(
      supportAgentDefinition(),
      { question: "How do I install an Expert Advisor on MetaTrader 5?" },
      { userId: TEST_USER, runId: "test-run" },
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["support.knowledge_search"]);
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
  });

  await test("an account question also plans support.account_read", async () => {
    const sup = new SupervisorService({ registry: fakeRegistry(), llmAssist: false });
    const plan = await sup.plan(
      supportAgentDefinition(),
      { question: "How do I change my subscription plan and what is my billing status?" },
      { userId: TEST_USER, runId: "test-run" },
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["support.knowledge_search", "support.account_read"]);
  });

  await test("structural: no support file STATICALLY imports lib/ai / the executor / the K-series service; specialist has no lib/ai at all", () => {
    const specialistLike = [
      join(ROOT, "services", "agent-framework", "supervisor", "specialists", "support.specialist.ts"),
      join(ROOT, "services", "agent-framework", "agents", "support-agent.ts"),
    ];
    const toolFiles = [
      join(ROOT, "services", "agent-framework", "tools", "impl", "support-knowledge-search.tool.ts"),
      join(ROOT, "services", "agent-framework", "tools", "impl", "support-account-read.tool.ts"),
    ];
    const STATIC_LIB_AI = /^\s*import\b[^;]*from\s+["'][^"']*lib\/ai/m;
    for (const f of [...specialistLike, ...toolFiles]) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, STATIC_LIB_AI, `${f}: no STATIC lib/ai import (lazy await import is allowed in tools)`);
      assert.doesNotMatch(src, /tool-gateway|invokeTool/, `${f}: no executor import`);
      assert.ok(!src.includes("services/knowledge-loop"), `${f}: agent-framework INV-1 - must not reference services/knowledge-loop`);
      assert.ok(!src.includes('"use client"'), `${f}: server-only`);
    }
    // the specialist + the agent definition don't touch lib/ai even lazily.
    for (const f of specialistLike) {
      assert.ok(!readFileSync(f, "utf8").includes("lib/ai"), `${f}: no lib/ai reference at all`);
    }
  });

  // ----------------------------------------------------------------
  // 4. E2E on a fake registry (deterministic)
  // ----------------------------------------------------------------

  await test("E2E (fake): FAQ question -> cited support-answer -> integrity PASS -> evaluation", async () => {
    const { rt, evaluation } = harness(fakeRegistry());
    const final = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "How do I install an Expert Advisor?" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);

    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.deepEqual(trace.toolCalls.map((t) => t.toolId), ["support.knowledge_search"]);

    const out = final!.output as Record<string, unknown>;
    assert.equal(out.kind, "support-answer");
    assert.equal(out.resolved, true);
    assert.equal(out.coverage, "kb-answered");
    assert.equal(out.escalate, false);
    assert.equal(out.escalationReason, null);

    const runEvidenceIds = new Set(trace.evidence.map((e) => e.id));
    for (const c of out.citations as Record<string, unknown>[]) {
      assert.ok(runEvidenceIds.has(c.evidenceId as string), "citation -> real evidence row");
      assert.ok(!("claim" in c) && !("content" in c) && !("text" in c), "a citation never restates passage text");
    }

    // no passage text, no raw question anywhere in the output
    const json = JSON.stringify(out);
    assert.ok(!json.includes("Settings → Billing"), "output must not carry the passage text");
    assert.ok(!json.includes("install an Expert Advisor"), "output must not echo the raw question");
    for (const k of Object.keys(out)) assert.ok(!FORBIDDEN_KEYS.includes(k.toLowerCase()), `key "${k}"`);
    const scannable = json.replace(JSON.stringify(out.disclaimer), '""');
    for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(scannable), `text ${re}`);

    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep && (evalStep.output as { passed?: boolean }).passed === true, "A6 integrity PASS");

    const ev = await evaluation.getForRun(final!.id);
    assert.ok(ev, "A10 evaluation persisted");
    assert.equal(ev!.terminalStatus, "succeeded");
    assert.deepEqual(ev!.scores.map((s) => s.dimension).sort(), [...AGENT_EVALUATION_DIMENSIONS].sort());
    console.log(`      -> answer: ${out.coverage}, ${(out.citations as unknown[]).length} citations, composite ${ev!.compositeScore}`);
  });

  await test("A6 signal-language: a support passage containing 'buy'/'sell' still passes integrity", async () => {
    const { rt } = harness(fakeRegistry({ kb: KB_HITS_WITH_TRADE_WORDS }));
    const final = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "How do I purchase a product from the marketplace?" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    // the evidence row DOES contain the trade words...
    assert.ok(trace.evidence.some((e) => /\bbuy\b/i.test(e.claim)), "fixture passage has 'buy'");
    // ...but the output does not, so the A6 gate passes.
    const out = final!.output as Record<string, unknown>;
    const scannable = JSON.stringify(out).replace(JSON.stringify(out.disclaimer), '""');
    for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(scannable), `output clean of ${re}`);
    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep && (evalStep.output as { passed?: boolean }).passed === true, "integrity PASS despite trade-word source");
  });

  await test("account question -> support.account_read fires; findings are status-only, no secrets", async () => {
    const { rt } = harness(fakeRegistry());
    const final = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "What is my current subscription and plan status?" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.deepEqual(trace.toolCalls.map((t) => t.toolId), ["support.knowledge_search", "support.account_read"]);
    const out = final!.output as Record<string, unknown>;
    const findings = out.accountFindings as Record<string, unknown>[];
    assert.ok(findings.length >= 1, "account findings present");
    for (const f of findings) assert.deepEqual(Object.keys(f).sort(), ["domain", "evidenceId"]);
    const json = JSON.stringify(out);
    for (const secret of ["apiKeyHash", "signature", "stripeSubscriptionId", "providerRef", "nowPaymentsInvoiceId"]) {
      assert.ok(!json.includes(secret), `output must not carry ${secret}`);
    }
  });

  await test("CS1.2 D2 (no migration): evidence reuses in-enum AgentEvidenceType values; source + producer carry the semantics", async () => {
    const { rt } = harness(fakeRegistry());
    const final = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "How do I change my subscription plan and what is my billing status?" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    const kbEv = trace.evidence.filter((e) => e.source.startsWith("support-kb:"));
    const acctEv = trace.evidence.filter((e) => e.source.startsWith("account:"));
    assert.ok(kbEv.length >= 1 && acctEv.length >= 1, "both kinds of evidence present");
    // NO new enum member - both reuse values already in the Postgres enum.
    for (const e of kbEv) {
      assert.equal(e.type, "research_document", "support-KB evidence reuses research_document");
      assert.equal((e.provenance as { producer?: string }).producer, "fake-support");
    }
    for (const e of acctEv) {
      assert.equal(e.type, "derived", "account-status evidence reuses derived");
      assert.equal((e.provenance as { producer?: string }).producer, "fake-account");
    }
    // the real adapters' producers (asserted here against the shipped defs)
    const reg = buildToolRegistry();
    assert.equal(reg.require("support.knowledge_search").definition.evidence.provenanceProducer, "support-kb-vector-search");
    assert.equal(reg.require("support.account_read").definition.evidence.provenanceProducer, "account-records-read");
    assert.deepEqual(reg.require("support.knowledge_search").definition.evidence.evidenceTypes, ["research_document"]);
    assert.deepEqual(reg.require("support.account_read").definition.evidence.evidenceTypes, ["derived"]);
  });

  await test("weak match only (below STRONG threshold) -> no-coverage, escalate true, 0 citations", async () => {
    const { rt } = harness(fakeRegistry({ kb: KB_WEAK_HITS, account: [] }));
    const final = await runSupportAgent({ userId: TEST_USER, goal: "how do I export my trade history to excel", runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.ok(trace.evidence.length >= 1, "weak hits ARE retrieved as evidence");
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.coverage, "no-coverage");
    assert.equal(out.resolved, false);
    assert.equal(out.escalate, true);
    assert.match(String(out.escalationReason), /no-strong-match/);
    assert.equal((out.citations as unknown[]).length, 0, "a weak tail is never cited");
    assert.equal((out.evidenceIds as unknown[]).length, 0, "output references nothing it did not use");
  });

  await test("honest emptiness: no KB + no account -> no-coverage, resolved false, escalate true, 0 citations", async () => {
    const { rt } = harness(fakeRegistry({ kb: [], account: [] }));
    const final = await runSupportAgent({ userId: TEST_USER, goal: "something the KB has nothing about", runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.coverage, "no-coverage");
    assert.equal(out.resolved, false);
    assert.equal(out.escalate, true);
    assert.equal(typeof out.escalationReason, "string");
    assert.equal((out.citations as unknown[]).length, 0);
    assert.equal(out.citationCount, 0);
  });

  await test("mutation intent: 'cancel my subscription' -> escalate true with the account-change reason", async () => {
    const { rt } = harness(fakeRegistry()); // KB has material
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "Please cancel my subscription now." }, runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.escalate, true);
    assert.match(String(out.escalationReason), /account-change/);
  });

  // ----------------------------------------------------------------
  // 5. E2E on the REAL registry (best-effort)
  // ----------------------------------------------------------------

  await test("E2E (real registry): a clean terminal state either way; trace intact", async () => {
    const final = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "How do credits work on the free plan?" },
    });
    assert.ok(
      ["succeeded", "tool_error"].includes(final!.status),
      `unexpected terminal status ${final!.status} (${final!.errorCode})`,
    );
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.ok(trace.steps.find((s) => s.kind === "plan"), "a plan step was persisted");
    if (final!.status === "succeeded") {
      const out = final!.output as Record<string, unknown>;
      assert.equal(out.kind, "support-answer");
      console.log(`      -> (live) ${out.coverage}, ${(out.citations as unknown[]).length} citations, escalate=${out.escalate}`);
    } else {
      console.log(`      -> (live) embedding/DB unavailable -> clean ${final!.errorCode}; trace intact`);
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
