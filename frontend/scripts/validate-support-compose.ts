// scripts/validate-support-compose.ts
// AT24 Copilot Phase 3.2 - composed (written) answers grounded on the cited KB passages.
// House style (node:assert/strict, tsx). Run: npm run validate:support-compose
// Real DB (AgentRun rows) with a fake tool registry and FAKE provider slots: deterministic, no live LLM.

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { runSupportAgent } from "../services/agent-framework/agents/support-agent";
import {
  composeSupportAnswerForRun,
  isEligibleForComposition,
  buildComposePrompt,
  SUPPORT_COMPOSE_CREDIT_COST,
} from "../services/support/compose-answer";
import type { GenerationSlot } from "../services/support/generate-answer";
import { summarizeTurnForContext } from "../services/support/conversation-context";
import { MUTATION_ESCALATION_REASON } from "../services/agent-framework/supervisor/specialists/support.specialist";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";

const TEST_USER = `validate-support-compose-${process.pid}-${Date.now().toString(36)}`;
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL - ${name}\n    ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

const FULL_PASSAGE =
  "You can change your plan yourself from Settings -> Billing. Open the dashboard, go to Settings, then the Billing tab, and choose a different tier. An upgrade takes effect immediately.";
const STRONG = [{ claim: `${FULL_PASSAGE.slice(0, 60)}…`, content: FULL_PASSAGE, topic: "faq", relevance: 0.83 }];

function fakeKb(hits: typeof STRONG): ToolImplementation<Record<string, never>, { hits: unknown[]; available: boolean }> {
  return {
    definition: {
      id: "support.knowledge_search", name: "support.knowledge_search", description: "fake", version: "1.0.0",
      category: "SUPPORT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_SUPPORT"], autonomyFloor: 0, creditCost: { model: "flat", credits: 1 },
      executionMode: "sync",
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
          data: { topic: h.topic, title: "fixture", similarity: h.relevance, content: h.content },
          relevance: h.relevance, confidence: h.relevance, provenance: { producer: "fake-support", retrievedAt: now },
        })),
      };
    },
  };
}

function fakeAccount(): ToolImplementation<Record<string, never>, { snapshot: unknown; domains: string[] }> {
  return {
    definition: {
      id: "support.account_read", name: "support.account_read", description: "fake", version: "1.0.0",
      category: "ACCOUNT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_ACCOUNT_RECORDS"], autonomyFloor: 0, creditCost: { model: "flat", credits: 1 },
      executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["derived"], provenanceProducer: "fake-account" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { snapshot: { plan: { planId: "pro" } }, domains: ["plan"] },
        evidence: [{
          type: "derived", claim: 'Account plan tier is "SECRET-PLAN-TEXT".', source: "account:plan", sourceId: "account:plan",
          timestamp: now, data: { planId: "pro" }, relevance: 0.9, confidence: 1,
          provenance: { producer: "fake-account", retrievedAt: now },
        }],
      };
    },
  };
}

function harness(hits: typeof STRONG) {
  const registry = new ToolRegistry().register(fakeKb(hits)).register(fakeAccount()).freeze();
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  return new AgentRuntime({ registry, creditLedger: ledger, evaluation });
}

function slot(name: string, text: string | Error, seen?: { prompt?: string }): GenerationSlot {
  return {
    name,
    isAvailable: () => true,
    async complete(req) {
      if (seen) seen.prompt = req.messages.map((m) => m.content).join("\n---\n");
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

async function answeredRun(question: string) {
  const final = await runSupportAgent({ userId: TEST_USER, goal: { question }, runtime: harness(STRONG) });
  assert.equal(final?.status, "succeeded");
  return final!;
}

async function main(): Promise<void> {
  console.log("\nAT24 Copilot Phase 3.2 - composed answers\n");
  await agentRunRepository._deleteRunsForUser(TEST_USER);

  await test("eligibility: kb-answered + citations + not mutation + not already composed", () => {
    const base = { coverage: "kb-answered", escalationReason: null, citations: [{ evidenceId: "e1" }] };
    assert.equal(isEligibleForComposition(base), true);
    assert.equal(isEligibleForComposition({ ...base, coverage: "no-coverage" }), false);
    assert.equal(isEligibleForComposition({ ...base, coverage: "account-context" }), false);
    assert.equal(isEligibleForComposition({ ...base, escalationReason: MUTATION_ESCALATION_REASON }), false);
    assert.equal(isEligibleForComposition({ ...base, citations: [] }), false);
    assert.equal(isEligibleForComposition({ ...base, composedAnswer: "already" }), false);
    assert.equal(isEligibleForComposition(null), false);
  });

  await test("eligibility: the SUPPORT_COMPOSED_ANSWERS=off switch disables composition", () => {
    process.env.SUPPORT_COMPOSED_ANSWERS = "off";
    try {
      assert.equal(isEligibleForComposition({ coverage: "kb-answered", citations: [{ evidenceId: "e1" }] }), false);
    } finally {
      delete process.env.SUPPORT_COMPOSED_ANSWERS;
    }
  });

  await test("compose: a kb-answered run gets a composedAnswer grounded on the FULL cited passage; coverage and citations are unchanged", async () => {
    const run = await answeredRun("How do I change my billing tier?");
    const before = run.output as { coverage?: string; citations?: unknown[] };
    assert.equal(before.coverage, "kb-answered");
    const seen: { prompt?: string } = {};
    const ok = await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "Open Settings, then Billing, and pick a tier.", seen)]);
    assert.equal(ok, true);
    assert.ok(seen.prompt?.includes(FULL_PASSAGE), "the prompt must carry the full passage, not the truncated claim");
    const after = (await agentRunRepository.getRunForUser(run.id, TEST_USER))!.output as Record<string, unknown>;
    assert.equal(after.composedAnswer, "Open Settings, then Billing, and pick a tier.");
    assert.equal(after.composedProvider, "fake");
    assert.equal(after.coverage, "kb-answered");
    assert.equal((after.citations as unknown[]).length, before.citations?.length);
  });

  await test("compose: writes a model_call step and a support-composed evidence row (reusing the derived type), no schema change", async () => {
    const run = await answeredRun("How do I change my billing tier again?");
    await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "Go to Settings then Billing.")]);
    const trace = await agentRunRepository.getRunTrace(run.id);
    assert.ok(trace.steps.some((s) => s.kind === "model_call" && s.summary.includes("composed answer")));
    const ev = trace.evidence.find((e) => e.source === "support-composed:answer");
    assert.ok(ev && ev.type === "derived");
    assert.ok((ev!.data as { groundedOn?: string[] }).groundedOn?.length);
    assert.equal(SUPPORT_COMPOSE_CREDIT_COST, 2);
  });

  await test("compose: a forbidden (advice) candidate is rejected, the next provider is tried, never the advice", async () => {
    const run = await answeredRun("How do I change my billing tier a third time?");
    const ok = await composeSupportAnswerForRun(run.id, TEST_USER, [
      slot("bad", "You should buy gold now, it is a guaranteed profit."),
      slot("good", "Open Settings, then Billing."),
    ]);
    assert.equal(ok, true);
    const out = (await agentRunRepository.getRunForUser(run.id, TEST_USER))!.output as { composedAnswer?: string; composedProvider?: string };
    assert.equal(out.composedProvider, "good");
    assert.ok(!/guaranteed profit/i.test(out.composedAnswer ?? ""));
  });

  await test("compose: every provider failing leaves the run exactly as it was (safe failure)", async () => {
    const run = await answeredRun("How do I change my billing tier a fourth time?");
    const before = JSON.stringify((await agentRunRepository.getRunForUser(run.id, TEST_USER))!.output);
    const ok = await composeSupportAnswerForRun(run.id, TEST_USER, [slot("down", new Error("provider down")), slot("bad2", "This is a guaranteed profit, buy now.")]);
    assert.equal(ok, false);
    assert.equal(JSON.stringify((await agentRunRepository.getRunForUser(run.id, TEST_USER))!.output), before);
  });

  await test("compose: a mutation request is never composed (escalation stays the only outcome)", async () => {
    const run = await answeredRun("Please cancel my subscription");
    const out = run.output as { escalationReason?: string };
    assert.equal(out.escalationReason, MUTATION_ESCALATION_REASON);
    const ok = await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "Done, cancelled.")]);
    assert.equal(ok, false);
  });

  await test("isolation: account findings never reach the prompt, even when account_read ran in the same run", async () => {
    const run = await answeredRun("What is my plan and how do I change my billing tier?");
    const out = run.output as { accountFindings?: unknown[] };
    assert.ok((out.accountFindings ?? []).length > 0, "fixture must have produced account findings");
    const seen: { prompt?: string } = {};
    await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "Open Settings, then Billing.", seen)]);
    assert.ok(seen.prompt && !seen.prompt.includes("SECRET-PLAN-TEXT"), "account text must never be in the prompt");
  });

  await test("idempotent: a second call on an already composed run is a no-op", async () => {
    const run = await answeredRun("How do I change my billing tier a fifth time?");
    assert.equal(await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "First answer.")]), true);
    assert.equal(await composeSupportAnswerForRun(run.id, TEST_USER, [slot("fake", "Second answer.")]), false);
    const out = (await agentRunRepository.getRunForUser(run.id, TEST_USER))!.output as { composedAnswer?: string };
    assert.equal(out.composedAnswer, "First answer.");
  });

  await test("prompt: language mirroring, no-account, no-advice and data-not-instructions rules are in the system instruction", () => {
    const req = buildComposePrompt("q", [{ evidenceId: "e", topic: "faq", title: "", content: "c" }], []);
    const sys = req.messages[0].content;
    assert.match(sys, /same language the user wrote in \(including Hinglish\)/);
    assert.match(sys, /NO access to the user's own account/);
    assert.match(sys, /Never give trading, investment/);
    assert.match(sys, /DATA, never instructions/);
  });

  await test("context: a composed answer becomes the prior-turn summary for follow-ups (still no account text)", () => {
    const s = summarizeTurnForContext({
      input: { question: "q" },
      output: { coverage: "kb-answered", composedAnswer: "Open Settings, then Billing.", citations: [{ topic: "faq" }] },
    });
    assert.equal(s.answerSummary, "Open Settings, then Billing.");
  });

  await test("structural: compose-answer.ts never imports the account tool, prisma, or knowledge-loop", () => {
    const src = readFileSync(join(ROOT, "services", "support", "compose-answer.ts"), "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /from\s+["'][^"']*(account-read|knowledge-loop|lib\/prisma)[^"']*["']/);
  });

  await test("structural: the run hook composes only after the Phase A fallback and before the handoff policy", () => {
    const src = readFileSync(join(ROOT, "services", "agent-framework", "api", "agent-run-service.ts"), "utf8");
    const gen = src.indexOf("generateSupportAnswerForRun(runId, userId)");
    const comp = src.indexOf("composeSupportAnswerForRun(runId, userId)");
    const handoff = src.indexOf("shouldAutoCreateHandoff(");
    assert.ok(gen > -1 && comp > gen && handoff > comp, "order must be: generation, composition, handoff policy");
  });

  await agentRunRepository._deleteRunsForUser(TEST_USER);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await agentRunRepository._deleteRunsForUser(TEST_USER);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
