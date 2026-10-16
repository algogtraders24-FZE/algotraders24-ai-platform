// scripts/validate-support-history.ts
// AT24 Copilot Phase 4: conversation history and resume.
// Run: npm run validate:support-history   (real DB; only this test's AgentRun rows, cleaned up)
process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { runSupportAgent } from "../services/agent-framework/agents/support-agent";
import { listSupportConversations, getSupportConversation, titleFrom } from "../services/support/conversation-history";
import { conversationIdFromPath } from "../services/support/handoff-route-path";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";

const USER_A = `validate-support-history-a-${process.pid}-${Date.now().toString(36)}`;
const USER_B = `validate-support-history-b-${process.pid}-${Date.now().toString(36)}`;
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

const PASSAGE = "Open Settings, then Billing, and choose a tier.";

function fakeKb(): ToolImplementation<Record<string, never>, { hits: unknown[]; available: boolean }> {
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
        output: { hits: [{ claim: PASSAGE, topic: "faq", relevance: 0.83 }], available: true },
        evidence: [{
          type: "research_document", claim: PASSAGE, source: "support-kb:faq", sourceId: "support-kb:fix", timestamp: now,
          data: { topic: "faq", title: "fixture", similarity: 0.83, content: PASSAGE }, relevance: 0.83, confidence: 0.83,
          provenance: { producer: "fake-support", retrievedAt: now },
        }],
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
    handler: async () => ({ output: { snapshot: {}, domains: [] }, evidence: [] }),
  };
}

function harness() {
  const registry = new ToolRegistry().register(fakeKb()).register(fakeAccount()).freeze();
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  return new AgentRuntime({ registry, creditLedger: ledger, evaluation });
}

/** One SUPPORT turn, tagged into `conversationId` exactly like startAgentRun does. */
async function turn(userId: string, conversationId: string, question: string) {
  const final = await runSupportAgent({ userId, goal: { question }, runtime: harness() });
  assert.equal(final?.status, "succeeded");
  const row = await agentRunRepository.getRun(final!.id);
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  await agentRunRepository.patchRun(final!.id, { metadata: { ...meta, conversation: { id: conversationId } } });
  return final!;
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(USER_A);
  await agentRunRepository._deleteRunsForUser(USER_B);
}

async function main(): Promise<void> {
  console.log("\nAT24 Copilot Phase 4 - history and resume\n");
  await cleanup();

  await test("title: whitespace collapsed, long titles cut with an ellipsis, empty falls back", () => {
    assert.equal(titleFrom("  What   is\nLive Sync? "), "What is Live Sync?");
    assert.ok(titleFrom("x".repeat(200)).length <= 80 && titleFrom("x".repeat(200)).endsWith("…"));
    assert.equal(titleFrom("   "), "Conversation");
  });

  await test("path helper: reads the id after /conversations/", () => {
    assert.equal(conversationIdFromPath("/api/private/support/conversations/abc-123"), "abc-123");
    assert.equal(conversationIdFromPath("/api/private/support/conversations"), undefined);
  });

  await turn(USER_A, "conv-a-1", "How do I change my billing tier?");
  await turn(USER_A, "conv-a-1", "and what about Elite?");
  await turn(USER_A, "conv-a-2", "What is Live Sync?");
  await turn(USER_B, "conv-b-1", "A question from someone else");

  await test("list: groups turns by conversation, newest conversation first, title = the FIRST question", async () => {
    const list = await listSupportConversations(USER_A);
    assert.equal(list.length, 2);
    assert.equal(list[0].conversationId, "conv-a-2");
    assert.equal(list[1].conversationId, "conv-a-1");
    assert.equal(list[1].turns, 2);
    assert.equal(list[1].title, "How do I change my billing tier?");
    assert.equal(list[0].turns, 1);
  });

  await test("isolation: each user lists only their own conversations", async () => {
    const b = await listSupportConversations(USER_B);
    assert.deepEqual(b.map((c) => c.conversationId), ["conv-b-1"]);
    const a = await listSupportConversations(USER_A);
    assert.ok(!a.some((c) => c.conversationId === "conv-b-1"));
  });

  await test("detail: turns come back oldest-first with the question, the strongest cited passage as the answer, and coverage", async () => {
    const d = await getSupportConversation(USER_A, "conv-a-1");
    assert.ok(d);
    assert.equal(d!.turns.length, 2);
    assert.equal(d!.turns[0].question, "How do I change my billing tier?");
    assert.equal(d!.turns[1].question, "and what about Elite?");
    assert.equal(d!.turns[0].answer, PASSAGE);
    assert.equal(d!.turns[0].coverage, "kb-answered");
    assert.equal(d!.handoff, null);
  });

  await test("detail: a composed answer is preferred over the raw passage", async () => {
    const run = await turn(USER_A, "conv-a-3", "Composed turn");
    const row = await agentRunRepository.getRunForUser(run.id, USER_A);
    await agentRunRepository.patchRun(run.id, { output: { ...((row!.output ?? {}) as Record<string, unknown>), composedAnswer: "Written answer." } });
    const d = await getSupportConversation(USER_A, "conv-a-3");
    assert.equal(d!.turns[0].answer, "Written answer.");
  });

  await test("isolation: another user's conversation id returns null, never someone else's turns", async () => {
    assert.equal(await getSupportConversation(USER_B, "conv-a-1"), null);
    assert.equal(await getSupportConversation(USER_A, "conv-b-1"), null);
    assert.equal(await getSupportConversation(USER_A, "no-such-conversation"), null);
  });

  await test("routes: authenticate first and scope to the session user only", () => {
    for (const f of [["conversations", "route.ts"], ["conversations", "[id]", "route.ts"]]) {
      const src = readFileSync(join(ROOT, "app", "api", "private", "support", ...f), "utf8");
      assert.ok(src.indexOf("getUserOrNull()") > -1, `${f.join("/")} must authenticate`);
      assert.match(src, /sessionUser\.profile\.id/);
      assert.doesNotMatch(src, /req\.json\(\)|searchParams[^;\n]*userId/);
    }
  });

  await test("wiring: the page loads the history and can open or restart a conversation", () => {
    const src = readFileSync(join(ROOT, "app", "dashboard", "support", "page.tsx"), "utf8");
    assert.match(src, /loadConversations\(\)/);
    assert.match(src, /openConversation\(c\.conversationId\)/);
    assert.match(src, /New conversation/);
    assert.match(src, /Earlier in this conversation/);
  });

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
