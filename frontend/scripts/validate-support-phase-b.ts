// scripts/validate-support-phase-b.ts
// AT24 Support - Phase B (Multi-Turn Conversation Continuity).
//
// House style (node:assert/strict, tsx). Run: npm run validate:support-phase-b
//
// Covers the owner's Phase B scope end to end:
//   - conversation id issuance + continuation (startAgentRun, agent-run-service.ts)
//   - user-isolated conversation ownership (agentRunRepository.listRunsForConversation)
//   - ordered conversation turns (oldest -> newest)
//   - bounded context window (turn count + character budget, oldest dropped first)
//   - conversation context reaching Phase A's generation prompt, and ONLY that
//     (KB match / account lookup / mutation escalation stay untouched - proven
//     by re-running Phase A's own existing assertions unchanged elsewhere)
//   - structural account-data isolation extended to conversation history
//   - backward compatibility: a run with no conversation metadata behaves
//     exactly like pre-Phase-B (Phase A original behavior)

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { runSupportAgent } from "../services/agent-framework/agents/support-agent";
import { generateSupportAnswerForRun, type GenerationSlot } from "../services/support/generate-answer";
import {
  normalizeConversationId,
  summarizeTurnForContext,
  buildBoundedContext,
  SUPPORT_CONVERSATION_MAX_TURNS,
  SUPPORT_CONVERSATION_MAX_CHARS,
  type ConversationTurnSummary,
} from "../services/support/conversation-context";
import { startAgentRun } from "../services/agent-framework/api/agent-run-service";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

const TEST_USER = `validate-support-phase-b-${process.pid}-${Date.now().toString(36)}`;
const TEST_USER_2 = `validate-support-phase-b-2-${process.pid}-${Date.now().toString(36)}`;
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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ------------------------------------------------------------------
// Fixtures (same shape as validate-support-phase-a.ts)
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

function fakeAccountTool(): ToolImplementation<Record<string, never>, { snapshot: unknown; domains: string[] }> {
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
        output: { snapshot: { plan: { planId: "pro" } }, domains: ["plan"] },
        evidence: [
          {
            type: "derived", claim: 'Account credit balance is "$9999-SECRET".', source: "account:credits",
            sourceId: "account:credits", timestamp: now, data: { planId: "pro" }, relevance: 0.9,
            confidence: 1, provenance: { producer: "fake-account", retrievedAt: now },
          },
        ],
      };
    },
  };
}

const KB_WEAK_HIT = [{ claim: "Contact support for account issues.", topic: "faq", relevance: 0.48 }];
const KB_NO_HIT: typeof KB_WEAK_HIT = [];

function fakeRegistry(kb: typeof KB_WEAK_HIT): ToolRegistry {
  return new ToolRegistry().register(fakeKnowledgeTool(kb)).register(fakeAccountTool()).freeze();
}

function harness(kb: typeof KB_WEAK_HIT) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const store = new InMemoryEvaluationStore();
  const evaluation = new EvaluationService({ registry: fakeRegistry(kb), creditLedger: ledger, store });
  const rt = new AgentRuntime({ registry: fakeRegistry(kb), creditLedger: ledger, evaluation });
  return rt;
}

// Captures the exact AICompletionRequest handed to the "winning" slot, so
// tests can assert on the actual serialized prompt content.
function capturingSlot(name: string, respond: () => string): { slot: GenerationSlot; lastRequestText: () => string } {
  let last = "";
  const slot: GenerationSlot = {
    name,
    isAvailable: () => true,
    complete: async (req) => {
      last = req.messages.map((m) => m.content).join("\n---\n");
      return respond();
    },
  };
  return { slot, lastRequestText: () => last };
}

/** Simulates what agent-run-service.ts's startAgentRun does for a SUPPORT
 *  run (tag `metadata.conversation.id`) on a run created via the isolated
 *  test harness (runSupportAgent bypasses agent-run-service.ts entirely, by
 *  the same design every other Support test file already relies on). */
async function tagConversation(runId: string, conversationId: string): Promise<void> {
  const row = await agentRunRepository.getRun(runId);
  const existing = (row?.metadata ?? {}) as Record<string, unknown>;
  await agentRunRepository.patchRun(runId, { metadata: { ...existing, conversation: { id: conversationId } } });
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
  await agentRunRepository._deleteRunsForUser(TEST_USER_2);
}

async function main(): Promise<void> {
  console.log("\nAT24 Support Phase B validation (multi-turn conversation continuity)\n");
  await cleanup();

  // ----------------------------------------------------------------
  // Pure unit tests: conversation-context.ts
  // ----------------------------------------------------------------

  await test("normalizeConversationId: accepts a well-shaped string", () => {
    assert.equal(normalizeConversationId("abc-123_XYZ"), "abc-123_XYZ");
  });

  await test("normalizeConversationId: rejects non-string / empty / too long / odd characters -> null", () => {
    assert.equal(normalizeConversationId(undefined), null);
    assert.equal(normalizeConversationId(null), null);
    assert.equal(normalizeConversationId(42), null);
    assert.equal(normalizeConversationId(""), null);
    assert.equal(normalizeConversationId("   "), null);
    assert.equal(normalizeConversationId("a".repeat(101)), null);
    assert.equal(normalizeConversationId("has spaces"), null);
    assert.equal(normalizeConversationId("has/slash"), null);
    assert.equal(normalizeConversationId("<script>"), null);
  });

  await test("summarizeTurnForContext: kb-generated -> answerSummary is the generated answer text", () => {
    const s = summarizeTurnForContext({
      input: { question: "how does it work" },
      output: { coverage: "kb-generated", generatedAnswer: "AT24 connects to MT5 via a bridge." },
    });
    assert.equal(s.question, "how does it work");
    assert.equal(s.answerSummary, "AT24 connects to MT5 via a bridge.");
  });

  await test("summarizeTurnForContext: kb-answered -> topic-only summary, never raw citation objects", () => {
    const s = summarizeTurnForContext({
      input: { question: "how do I reset my password" },
      output: { coverage: "kb-answered", citations: [{ topic: "account-security" }, { topic: "faq" }, { topic: "faq" }] },
    });
    assert.match(s.answerSummary, /account-security/);
    assert.match(s.answerSummary, /faq/);
  });

  await test("summarizeTurnForContext: account-context -> fixed generic string, NEVER the finding's domain/claim", () => {
    const s = summarizeTurnForContext({
      input: { question: "what is my current plan" },
      output: {
        coverage: "account-context",
        // A hostile/buggy caller could in principle attach extra fields to
        // output - the function must ignore them structurally, not by luck.
        accountFindings: [{ evidenceId: "e1", domain: "credits" }],
        secretBalance: "$9999-SECRET",
      },
    });
    assert.doesNotMatch(s.answerSummary, /credits/);
    assert.doesNotMatch(s.answerSummary, /9999/);
    assert.doesNotMatch(s.answerSummary, /SECRET/);
    assert.equal(s.answerSummary, "Answered using the requester's own account status (not repeated here).");
  });

  await test("summarizeTurnForContext: mutation escalation -> fixed generic string", () => {
    const s = summarizeTurnForContext({
      input: { question: "cancel my subscription" },
      output: {
        coverage: "no-coverage",
        escalate: true,
        escalationReason: "requires-an-account-change-only-a-human-or-an-authorised-flow-can-make",
      },
    });
    assert.match(s.answerSummary, /handed off to human support/);
    assert.match(s.answerSummary, /account change/);
  });

  await test("summarizeTurnForContext: plain no-coverage / malformed output -> generic string, never throws", () => {
    const a = summarizeTurnForContext({ input: { question: "q" }, output: { coverage: "no-coverage" } });
    assert.match(a.answerSummary, /No answer was found/);
    const b = summarizeTurnForContext({ input: null, output: null });
    assert.equal(b.question, "");
    assert.match(b.answerSummary, /No answer was found/);
    const c = summarizeTurnForContext({ input: { question: "q" }, output: "not an object" as unknown });
    assert.match(c.answerSummary, /No answer was found/);
  });

  await test("buildBoundedContext: more than MAX_TURNS prior turns -> keeps only the most recent, chronological order preserved", () => {
    const turns: ConversationTurnSummary[] = Array.from({ length: SUPPORT_CONVERSATION_MAX_TURNS + 4 }, (_, i) => ({
      question: `q${i}`,
      answerSummary: `a${i}`,
    }));
    const bounded = buildBoundedContext(turns);
    assert.equal(bounded.length, SUPPORT_CONVERSATION_MAX_TURNS);
    assert.deepEqual(
      bounded.map((t) => t.question),
      turns.slice(-SUPPORT_CONVERSATION_MAX_TURNS).map((t) => t.question),
    );
    // strictly the MOST RECENT turns, not an arbitrary subset
    assert.equal(bounded[bounded.length - 1].question, `q${SUPPORT_CONVERSATION_MAX_TURNS + 3}`);
  });

  await test("buildBoundedContext: char budget drops the OLDEST turns first, always keeps the last turn", () => {
    const big = "x".repeat(SUPPORT_CONVERSATION_MAX_CHARS); // one turn alone exceeds the budget
    const turns: ConversationTurnSummary[] = [
      { question: "old-1", answerSummary: "small" },
      { question: "old-2", answerSummary: "small" },
      { question: "newest", answerSummary: big },
    ];
    const bounded = buildBoundedContext(turns);
    assert.equal(bounded.length, 1, "the oldest turns must be dropped to respect the char budget");
    assert.equal(bounded[0].question, "newest", "the single most recent turn is always kept, even oversized");
  });

  await test("buildBoundedContext: empty input -> empty output", () => {
    assert.deepEqual(buildBoundedContext([]), []);
  });

  // ----------------------------------------------------------------
  // Structural: conversation-context.ts is DB-free and account-data-free
  // ----------------------------------------------------------------

  await test("structural: conversation-context.ts never references accountFindings, evidence claims, or the DB (outside comments)", () => {
    const f = join(ROOT, "services", "support", "conversation-context.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    for (const forbidden of ["accountFindings", "prisma", "agentRunRepository", ".claim", "evidenceId"]) {
      assert.ok(!src.includes(forbidden), `conversation-context.ts must not reference "${forbidden}" (outside comments)`);
    }
  });

  await test("structural: conversation-context.ts never imports services/knowledge-loop/** (INV-1)", () => {
    const f = join(ROOT, "services", "support", "conversation-context.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    assert.doesNotMatch(src, /\bfrom\s+["'][^"']*knowledge-loop[^"']*["']/);
  });

  // ----------------------------------------------------------------
  // Integration: conversation history actually reaches the generation
  // prompt - and ONLY the generation prompt (deterministic paths untouched,
  // proven separately by Phase A's own unmodified test suite).
  // ----------------------------------------------------------------

  await test("multi-turn: turn 2's generation prompt includes turn 1's question and answer summary", async () => {
    const conversationId = `conv-multiturn-${Date.now()}`;
    const rt1 = harness(KB_WEAK_HIT);
    const turn1 = await runSupportAgent({ userId: TEST_USER, goal: { question: "how do I export my trade history" }, runtime: rt1 });
    assert.equal(turn1?.status, "succeeded");
    await tagConversation(turn1!.id, conversationId);
    const gen1 = capturingSlot("t1", () => "AT24 does not currently document a trade-history export feature.");
    const r1 = await generateSupportAnswerForRun(turn1!.id, TEST_USER, [gen1.slot]);
    assert.equal(r1, true);

    const rt2 = harness(KB_WEAK_HIT);
    const turn2 = await runSupportAgent({ userId: TEST_USER, goal: { question: "what about CSV specifically" }, runtime: rt2 });
    assert.equal(turn2?.status, "succeeded");
    await tagConversation(turn2!.id, conversationId);
    const gen2 = capturingSlot("t2", () => "Still no documented CSV export.");
    const r2 = await generateSupportAnswerForRun(turn2!.id, TEST_USER, [gen2.slot]);
    assert.equal(r2, true);

    const promptText = gen2.lastRequestText();
    assert.match(promptText, /Earlier in this conversation/);
    assert.match(promptText, /how do I export my trade history/);
    assert.match(promptText, /trade-history export feature/);
    assert.match(promptText, /what about CSV specifically/, "the CURRENT question must still be present");
  });

  await test("backward compatible: a run with NO conversation metadata generates exactly like Phase A (no history block)", async () => {
    const rt = harness(KB_WEAK_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "does AT24 support MT4" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    // deliberately NOT tagged with any conversation id - simulates a
    // pre-Phase-B run / a non-conversational start.
    const gen = capturingSlot("solo", () => "AT24 supports MT5; MT4 is not documented.");
    const r = await generateSupportAnswerForRun(final!.id, TEST_USER, [gen.slot]);
    assert.equal(r, true);
    assert.doesNotMatch(gen.lastRequestText(), /Earlier in this conversation/);
  });

  await test("bounded window: generation prompt includes only the most recent MAX_TURNS prior turns, oldest dropped", async () => {
    const conversationId = `conv-bounded-${Date.now()}`;
    const priorRunIds: string[] = [];
    for (let i = 0; i < SUPPORT_CONVERSATION_MAX_TURNS + 2; i++) {
      const rt = harness(KB_NO_HIT);
      const run = await runSupportAgent({ userId: TEST_USER, goal: { question: `unique-marker-question-${i}` }, runtime: rt });
      assert.equal(run?.status, "succeeded");
      await tagConversation(run!.id, conversationId);
      priorRunIds.push(run!.id);
    }

    const rtFinal = harness(KB_WEAK_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "final follow-up question" }, runtime: rtFinal });
    assert.equal(final?.status, "succeeded");
    await tagConversation(final!.id, conversationId);
    const gen = capturingSlot("bounded", () => "answer");
    const r = await generateSupportAnswerForRun(final!.id, TEST_USER, [gen.slot]);
    assert.equal(r, true);

    const promptText = gen.lastRequestText();
    assert.doesNotMatch(promptText, /unique-marker-question-0\b/, "the OLDEST prior turn must have been dropped");
    assert.match(
      promptText,
      new RegExp(`unique-marker-question-${SUPPORT_CONVERSATION_MAX_TURNS + 1}\\b`),
      "the MOST RECENT prior turn must be present",
    );
    void priorRunIds;
  });

  await test("isolation: a colliding conversationId across two different users never leaks the other user's turns", async () => {
    const sharedConversationId = "shared-guessed-id";
    const rtA = harness(KB_WEAK_HIT);
    const userATurn = await runSupportAgent({
      userId: TEST_USER,
      goal: { question: "user-A-only-secret-question-marker" },
      runtime: rtA,
    });
    assert.equal(userATurn?.status, "succeeded");
    await tagConversation(userATurn!.id, sharedConversationId);

    const rtB = harness(KB_WEAK_HIT);
    const userBTurn = await runSupportAgent({
      userId: TEST_USER_2,
      goal: { question: "user-B-follow-up-question" },
      runtime: rtB,
    });
    assert.equal(userBTurn?.status, "succeeded");
    await tagConversation(userBTurn!.id, sharedConversationId);

    const gen = capturingSlot("isolated", () => "answer for B");
    const r = await generateSupportAnswerForRun(userBTurn!.id, TEST_USER_2, [gen.slot]);
    assert.equal(r, true);
    assert.doesNotMatch(gen.lastRequestText(), /user-A-only-secret-question-marker/, "user B must never see user A's turn, even under a colliding conversationId");
  });

  await test("repository isolation: listRunsForConversation is scoped by userId even for the same conversationId", async () => {
    const conversationId = `conv-repo-isolation-${Date.now()}`;
    const rt = harness(KB_WEAK_HIT);
    const run = await runSupportAgent({ userId: TEST_USER, goal: { question: "repo isolation probe" }, runtime: rt });
    assert.equal(run?.status, "succeeded");
    await tagConversation(run!.id, conversationId);

    const ownRows = await agentRunRepository.listRunsForConversation(TEST_USER, conversationId);
    assert.equal(ownRows.length, 1);
    const otherRows = await agentRunRepository.listRunsForConversation(TEST_USER_2, conversationId);
    assert.equal(otherRows.length, 0, "a different user must see zero rows for someone else's conversation id");
  });

  await test("ordering: listRunsForConversation returns turns oldest-first", async () => {
    const conversationId = `conv-order-${Date.now()}`;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const rt = harness(KB_NO_HIT);
      const run = await runSupportAgent({ userId: TEST_USER, goal: { question: `order-${i}` }, runtime: rt });
      assert.equal(run?.status, "succeeded");
      await tagConversation(run!.id, conversationId);
      ids.push(run!.id);
    }
    const rows = await agentRunRepository.listRunsForConversation(TEST_USER, conversationId);
    assert.deepEqual(rows.map((r) => r.id), ids, "must come back in creation order, oldest first");
  });

  // ----------------------------------------------------------------
  // startAgentRun (agent-run-service.ts) - the real API-facing entry point.
  // Runs stay "queued" (no tool execution needed to test id issuance).
  // ----------------------------------------------------------------

  await test("startAgentRun: a SUPPORT run gets a fresh conversationId, tagged onto its own metadata", async () => {
    const { runId, conversationId } = await startAgentRun({
      userId: TEST_USER,
      agentType: "SUPPORT",
      goal: { question: "startAgentRun turn 1" },
    });
    assert.equal(typeof conversationId, "string");
    assert.ok(conversationId && conversationId.length > 0);
    const row = await agentRunRepository.getRun(runId);
    const md = (row?.metadata ?? {}) as {
      conversation?: { id?: string };
      definition?: { type?: string };
      contract?: string;
    };
    assert.equal(md.conversation?.id, conversationId);
    // ARCHITECTURE-INTEGRITY CHECK (owner-requested): the conversation patch
    // is additive, never a metadata overwrite - `definition`/`contract`
    // (written by agentRuntime.startRun BEFORE this patch runs) must still
    // be intact, or every other metadata.definition consumer
    // (advanceAgentRun's generation trigger, listAgentRuns, recordResolution
    // Confirmation's SUPPORT-type guard) would silently break for every
    // SUPPORT run created through the real API route.
    assert.equal(md.definition?.type, "SUPPORT", "startRun's own metadata.definition must survive the conversation patch");
    assert.equal(md.contract, "AF-v1", "startRun's own metadata.contract must survive the conversation patch");
  });

  await test("startAgentRun: passing a prior conversationId continues the SAME conversation", async () => {
    const first = await startAgentRun({ userId: TEST_USER, agentType: "SUPPORT", goal: { question: "continued turn 1" } });
    const second = await startAgentRun({
      userId: TEST_USER,
      agentType: "SUPPORT",
      goal: { question: "continued turn 2" },
      conversationId: first.conversationId,
    });
    assert.equal(second.conversationId, first.conversationId);
    const rows = await agentRunRepository.listRunsForConversation(TEST_USER, first.conversationId!);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.id), [first.runId, second.runId]);
  });

  await test("startAgentRun: a malformed conversationId is ignored - a fresh one is generated, not an error", async () => {
    const result = await startAgentRun({
      userId: TEST_USER,
      agentType: "SUPPORT",
      goal: { question: "malformed id turn" },
      conversationId: "not a valid / id !!",
    });
    assert.equal(typeof result.conversationId, "string");
    assert.notEqual(result.conversationId, "not a valid / id !!");
  });

  await test("startAgentRun: a non-SUPPORT agent type is completely untouched - no conversationId, no metadata.conversation", async () => {
    const { runId, conversationId } = await startAgentRun({
      userId: TEST_USER,
      agentType: "RESEARCH",
      goal: { question: "isolation probe - not a support run" },
    });
    assert.equal(conversationId, undefined);
    const row = await agentRunRepository.getRun(runId);
    const md = (row?.metadata ?? {}) as { conversation?: unknown };
    assert.equal(md.conversation, undefined);
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
