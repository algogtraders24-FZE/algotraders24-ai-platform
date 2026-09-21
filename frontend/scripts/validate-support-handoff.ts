// scripts/validate-support-handoff.ts
// AT24 Support Human Handoff MVP - AT24's first internal Support Ticket/
// Case system (SUPPORT_HUMAN_HANDOFF_ARCHITECTURE_LOCK.md).
//
// House style (node:assert/strict, tsx). Run: npm run validate:support-handoff
//
// Covers the implementation sprint's own test contract (§22) plus the
// Architecture Lock's §21: creation (both triggers), cardinality/race
// safety, historical-vs-active distinction, the full locked lifecycle
// (valid + invalid transitions, reassignment, reopen), authorization/
// isolation, human reply attribution, evidence/provenance, audit, and
// structural guarantees (no second escalation engine, no
// services/knowledge-loop coupling).

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
import {
  ensureSupportHandoff,
  getActiveHandoffForUserConversation,
  getSupportHandoffForUser,
  replyAsSupportUser,
  reopenSupportHandoffAsUser,
  getSupportHandoffDetailForAdmin,
  assignSupportHandoff,
  transitionSupportHandoffAsAdmin,
  replyAsSupportAdmin,
  isHandoffActive,
  HandoffNotFoundError,
  InvalidTransitionError,
  HandoffNotActiveError,
  NoConversationRunsError,
  USER_REQUEST_REASON,
} from "../services/support/handoff-service";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

const TEST_USER = `validate-support-handoff-${process.pid}-${Date.now().toString(36)}`;
const TEST_USER_2 = `validate-support-handoff-2-${process.pid}-${Date.now().toString(36)}`;
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
// Fixtures (same shape as validate-support-phase-a.ts / phase-b.ts)
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
            type: "derived", claim: 'Account plan tier is "pro", renews on the 1st.', source: "account:plan",
            sourceId: "account:plan", timestamp: now, data: { planId: "pro" }, relevance: 0.9,
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

/** Simulates what agent-run-service.ts's startAgentRun does for a SUPPORT
 *  run (tag `metadata.conversation.id`) - same technique Phase B's own
 *  test suite established, since runSupportAgent bypasses
 *  agent-run-service.ts entirely by design. */
async function tagConversation(runId: string, conversationId: string): Promise<void> {
  const row = await agentRunRepository.getRun(runId);
  const existing = (row?.metadata ?? {}) as Record<string, unknown>;
  await agentRunRepository.patchRun(runId, { metadata: { ...existing, conversation: { id: conversationId } } });
}

/** A guaranteed escalation with ZERO evidence - no generation is even
 *  attempted (Phase A: "no weak hits at all -> must not attempt
 *  generation"), so the run's escalate:true is stable and deterministic,
 *  never racing a live LLM call. Used for every handoff test that doesn't
 *  specifically need evidence to reference. */
async function escalatedRun(userId: string, question: string) {
  const rt = harness(KB_NO_HIT);
  const final = await runSupportAgent({ userId, goal: { question }, runtime: rt });
  if (final?.status !== "succeeded") throw new Error(`fixture run did not succeed: ${final?.status}`);
  const out = final.output as { escalate?: boolean };
  if (out.escalate !== true) throw new Error("fixture question did not escalate");
  return final;
}

async function cleanup(): Promise<void> {
  // Cascades to SupportHandoff -> SupportHandoffMessage via the FK's own
  // ON DELETE CASCADE (migration 20260919120000_add_support_handoff) - no
  // separate cleanup needed for the new tables.
  await agentRunRepository._deleteRunsForUser(TEST_USER);
  await agentRunRepository._deleteRunsForUser(TEST_USER_2);
}

async function main(): Promise<void> {
  console.log("\nAT24 Support Human Handoff MVP validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // Unit
  // ----------------------------------------------------------------

  await test("isHandoffActive: OPEN/ASSIGNED/IN_PROGRESS true, RESOLVED/CANCELLED false", () => {
    assert.equal(isHandoffActive("OPEN"), true);
    assert.equal(isHandoffActive("ASSIGNED"), true);
    assert.equal(isHandoffActive("IN_PROGRESS"), true);
    assert.equal(isHandoffActive("RESOLVED"), false);
    assert.equal(isHandoffActive("CANCELLED"), false);
  });

  // ----------------------------------------------------------------
  // Structural: no second escalation engine, no INV-1 violation
  // ----------------------------------------------------------------

  await test("structural: handoff-service.ts never imports services/knowledge-loop/** (INV-1)", () => {
    const f = join(ROOT, "services", "support", "handoff-service.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    assert.doesNotMatch(src, /\bfrom\s+["'][^"']*knowledge-loop[^"']*["']/);
  });

  await test("structural: handoff-service.ts never reimplements escalation logic (no MUTATION_MARKERS-style regex, no ACCOUNT_MARKERS)", () => {
    const f = join(ROOT, "services", "support", "handoff-service.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    for (const forbidden of ["MUTATION_MARKERS", "ACCOUNT_MARKERS", "new RegExp"]) {
      assert.ok(!src.includes(forbidden), `handoff-service.ts must not reference "${forbidden}" - it consumes the specialist's own decision, never re-derives one (D3)`);
    }
  });

  await test("structural: handoff.repository.ts is the only place prisma.supportHandoff is written from within services/support", () => {
    const files = ["handoff-service.ts", "generate-answer.ts", "conversation-context.ts", "guest-knowledge-query.ts"];
    for (const name of files) {
      if (name === "handoff.repository.ts") continue;
      const f = join(ROOT, "services", "support", name);
      let src: string;
      try {
        src = stripComments(readFileSync(f, "utf8"));
      } catch {
        continue;
      }
      assert.ok(!src.includes("prisma.supportHandoff"), `${name} must go through handoffRepository, never prisma.supportHandoff directly`);
    }
  });

  // ----------------------------------------------------------------
  // Creation
  // ----------------------------------------------------------------

  await test("AI_ESCALATION: an escalated run creates an OPEN handoff, reason copied verbatim from the specialist's own output", async () => {
    const final = await escalatedRun(TEST_USER, "something entirely unrelated to AT24 handoff test");
    const out = final.output as { escalationReason?: string };
    await tagConversation(final.id, "conv-ai-escalation");
    const handoff = await ensureSupportHandoff({
      userId: TEST_USER,
      conversationId: "conv-ai-escalation",
      triggerSource: "AI_ESCALATION",
      reason: out.escalationReason ?? "unknown",
      agentRunId: final.id,
    });
    assert.equal(handoff.status, "OPEN");
    assert.equal(handoff.triggerSource, "AI_ESCALATION");
    assert.equal(handoff.reason, out.escalationReason);
    assert.equal(handoff.conversationId, "conv-ai-escalation");
    assert.equal(handoff.agentRunId, final.id);
  });

  await test("USER_REQUEST: creates a handoff anchored to the conversation's latest run, resolved server-side (never client-trusted)", async () => {
    const rt = harness(KB_WEAK_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "user request anchor test" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    await tagConversation(final!.id, "conv-user-request");
    const handoff = await ensureSupportHandoff({
      userId: TEST_USER,
      conversationId: "conv-user-request",
      triggerSource: "USER_REQUEST",
      reason: USER_REQUEST_REASON,
    });
    assert.equal(handoff.triggerSource, "USER_REQUEST");
    assert.equal(handoff.reason, USER_REQUEST_REASON);
    assert.equal(handoff.agentRunId, final!.id, "agentRunId must be resolved server-side to the real latest run");
  });

  await test("USER_REQUEST on a conversation with no prior runs -> NoConversationRunsError, not a fabricated handoff", async () => {
    await assert.rejects(
      () => ensureSupportHandoff({ userId: TEST_USER, conversationId: `conv-never-existed-${Date.now()}`, triggerSource: "USER_REQUEST", reason: USER_REQUEST_REASON }),
      NoConversationRunsError,
    );
  });

  await test("D1: repeated escalation in the SAME conversation reuses the SAME active handoff, never a duplicate", async () => {
    const final1 = await escalatedRun(TEST_USER, "dup test one");
    await tagConversation(final1.id, "conv-dup");
    const h1 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-dup", triggerSource: "AI_ESCALATION", reason: "r1", agentRunId: final1.id });

    const final2 = await escalatedRun(TEST_USER, "dup test two");
    await tagConversation(final2.id, "conv-dup");
    const h2 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-dup", triggerSource: "AI_ESCALATION", reason: "r2", agentRunId: final2.id });

    assert.equal(h2.id, h1.id, "must reuse the same active handoff, not create a second one");
    assert.equal(h2.reason, "r1", "the ORIGINAL handoff is untouched by the second escalation attempt");
    const rows = await prisma.supportHandoff.findMany({ where: { conversationId: "conv-dup" } });
    assert.equal(rows.length, 1, "exactly one row must exist for this conversation");
  });

  await test("D1: a human request on an already-active (AI-escalated) handoff reuses the SAME ticket, original trigger preserved", async () => {
    const final = await escalatedRun(TEST_USER, "mix trigger test");
    await tagConversation(final.id, "conv-mix");
    const h1 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-mix", triggerSource: "AI_ESCALATION", reason: "auto", agentRunId: final.id });
    const h2 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-mix", triggerSource: "USER_REQUEST", reason: USER_REQUEST_REASON });
    assert.equal(h2.id, h1.id);
    assert.equal(h2.triggerSource, "AI_ESCALATION", "reuse never overwrites the original trigger");
  });

  // ----------------------------------------------------------------
  // Cardinality / race safety (D1)
  // ----------------------------------------------------------------

  await test("D1: concurrent escalation attempts on one conversation resolve to exactly ONE active handoff (DB-level race safety)", async () => {
    const final = await escalatedRun(TEST_USER, "race safety test");
    await tagConversation(final.id, "conv-race");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-race", triggerSource: "AI_ESCALATION", reason: "race", agentRunId: final.id }),
      ),
    );
    const ids = new Set(results.map((r) => r.id));
    assert.equal(ids.size, 1, "all concurrent attempts must resolve to exactly ONE handoff id");
    const rows = await prisma.supportHandoff.findMany({ where: { conversationId: "conv-race" } });
    assert.equal(rows.length, 1, "the database must contain exactly one row - the partial unique index, not just application logic, is what guarantees this");
  });

  await test("D1: a NEW escalation after the existing handoff is terminal creates a NEW handoff; both remain historically queryable", async () => {
    const final1 = await escalatedRun(TEST_USER, "terminal distinction test one");
    await tagConversation(final1.id, "conv-terminal");
    const h1 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-terminal", triggerSource: "AI_ESCALATION", reason: "r1", agentRunId: final1.id });
    await transitionSupportHandoffAsAdmin({ id: h1.id, toStatus: "CANCELLED", actingAdminUserId: "test-admin" });

    const final2 = await escalatedRun(TEST_USER, "terminal distinction test two");
    await tagConversation(final2.id, "conv-terminal");
    const h2 = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-terminal", triggerSource: "AI_ESCALATION", reason: "r2", agentRunId: final2.id });

    assert.notEqual(h2.id, h1.id, "a fresh handoff must be created once the prior one is terminal, never reused automatically");
    const rows = await prisma.supportHandoff.findMany({ where: { conversationId: "conv-terminal" } });
    assert.equal(rows.length, 2, "both the historical (cancelled) and the new (open) handoff remain queryable");
  });

  // ----------------------------------------------------------------
  // Lifecycle (D4 - exact locked matrix)
  // ----------------------------------------------------------------

  await test("lifecycle: OPEN -> ASSIGNED (via assignment) -> IN_PROGRESS -> RESOLVED -> OPEN (user reopen)", async () => {
    const final = await escalatedRun(TEST_USER, "full lifecycle test");
    await tagConversation(final.id, "conv-lifecycle");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-lifecycle", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });

    const assigned = await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" });
    assert.equal(assigned.status, "ASSIGNED");
    assert.equal(assigned.assignedAdminUserId, "admin-1");

    const inProgress = await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "IN_PROGRESS", actingAdminUserId: "admin-1" });
    assert.equal(inProgress.status, "IN_PROGRESS");

    const resolved = await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "RESOLVED", actingAdminUserId: "admin-1" });
    assert.equal(resolved.status, "RESOLVED");
    assert.ok(resolved.resolvedAt, "resolvedAt must be set on RESOLVED");

    const reopened = await reopenSupportHandoffAsUser(h.id, TEST_USER);
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.resolvedAt, null, "resolvedAt must be cleared on reopen");
  });

  await test("lifecycle: reassignment updates assignedAdminUserId WITHOUT changing status (D4's own answer)", async () => {
    const final = await escalatedRun(TEST_USER, "reassignment test");
    await tagConversation(final.id, "conv-reassign");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-reassign", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" });
    const reassigned = await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-2", actingAdminUserId: "admin-2" });
    assert.equal(reassigned.status, "ASSIGNED", "status unchanged on reassignment");
    assert.equal(reassigned.assignedAdminUserId, "admin-2");
  });

  await test("lifecycle: invalid transitions are rejected server-side (OPEN->RESOLVED and ASSIGNED->RESOLVED directly are NOT in the locked matrix)", async () => {
    const final = await escalatedRun(TEST_USER, "invalid transition test");
    await tagConversation(final.id, "conv-invalid");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-invalid", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });

    await assert.rejects(
      () => transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "RESOLVED", actingAdminUserId: "admin-1" }),
      InvalidTransitionError,
      "OPEN -> RESOLVED is not a locked transition",
    );

    await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" });
    await assert.rejects(
      () => transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "RESOLVED", actingAdminUserId: "admin-1" }),
      InvalidTransitionError,
      "ASSIGNED -> RESOLVED directly is deliberately NOT in the locked matrix (skip-intermediate-state left UNKNOWN by the Architecture Lock, not invented here)",
    );
  });

  await test("lifecycle: CANCELLED is a true dead-end - no admin OR user reopen path exists", async () => {
    const final = await escalatedRun(TEST_USER, "cancelled dead-end test");
    await tagConversation(final.id, "conv-cancel");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-cancel", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "CANCELLED", actingAdminUserId: "admin-1" });
    await assert.rejects(() => transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "OPEN", actingAdminUserId: "admin-1" }), InvalidTransitionError);
    await assert.rejects(() => reopenSupportHandoffAsUser(h.id, TEST_USER), InvalidTransitionError);
  });

  await test("lifecycle: assignment is rejected on a terminal (CANCELLED) handoff", async () => {
    const final = await escalatedRun(TEST_USER, "assign terminal test");
    await tagConversation(final.id, "conv-assign-terminal");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-assign-terminal", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "CANCELLED", actingAdminUserId: "admin-1" });
    await assert.rejects(() => assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" }), InvalidTransitionError);
  });

  // ----------------------------------------------------------------
  // Authorization / isolation (§18)
  // ----------------------------------------------------------------

  await test("isolation: User A cannot read User B's handoff via getSupportHandoffForUser (IDOR)", async () => {
    const final = await escalatedRun(TEST_USER, "isolation read test");
    await tagConversation(final.id, "conv-isolation");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-isolation", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await assert.rejects(() => getSupportHandoffForUser(h.id, TEST_USER_2), HandoffNotFoundError);
  });

  await test("isolation: getActiveHandoffForUserConversation never leaks another user's handoff, even under a colliding conversationId", async () => {
    const final = await escalatedRun(TEST_USER, "shared conversationId guess test");
    await tagConversation(final.id, "conv-shared-guess");
    await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-shared-guess", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    const seenByOther = await getActiveHandoffForUserConversation(TEST_USER_2, "conv-shared-guess");
    assert.equal(seenByOther, null, "a different user must see nothing, never the real handoff");
  });

  await test("isolation: replyAsSupportUser rejects a non-owning user (IDOR on the message-write path)", async () => {
    const final = await escalatedRun(TEST_USER, "reply isolation test");
    await tagConversation(final.id, "conv-reply-isolation");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-reply-isolation", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await assert.rejects(() => replyAsSupportUser(h.id, TEST_USER_2, "not mine"), HandoffNotFoundError);
  });

  await test("isolation: reopenSupportHandoffAsUser rejects a non-owning user", async () => {
    const final = await escalatedRun(TEST_USER, "reopen isolation test");
    await tagConversation(final.id, "conv-reopen-isolation");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-reopen-isolation", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "CANCELLED", actingAdminUserId: "admin-1" });
    // even ignoring the CANCELLED-dead-end rule, ownership must be checked first
    await assert.rejects(() => reopenSupportHandoffAsUser(h.id, TEST_USER_2), HandoffNotFoundError);
  });

  await test("D11: replyAsSupportUser rejects once the handoff is terminal - the server-side backstop behind the widget's own routing", async () => {
    const final = await escalatedRun(TEST_USER, "not active test");
    await tagConversation(final.id, "conv-not-active");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-not-active", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "CANCELLED", actingAdminUserId: "admin-1" });
    await assert.rejects(() => replyAsSupportUser(h.id, TEST_USER, "too late"), HandoffNotActiveError);
  });

  // ----------------------------------------------------------------
  // Human Reply (D10)
  // ----------------------------------------------------------------

  await test("human reply: admin reply is attributed to the real admin, visible to both admin and the owning user, in the SAME conversation", async () => {
    const final = await escalatedRun(TEST_USER, "reply attribution test");
    await tagConversation(final.id, "conv-reply");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-reply", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });

    const detail = await replyAsSupportAdmin({ id: h.id, adminUserId: "admin-99", content: "We are looking into this." });
    const humanMsg = detail.messages.find((m) => m.authorType === "HUMAN");
    assert.ok(humanMsg, "a HUMAN-authored message must exist");
    assert.equal(humanMsg!.authorUserId, "admin-99");
    assert.equal(humanMsg!.content, "We are looking into this.");
    assert.equal(detail.conversationId, "conv-reply", "the reply belongs to the SAME conversation, never a forked thread");

    const userView = await getSupportHandoffForUser(h.id, TEST_USER);
    assert.ok(
      userView.messages.some((m) => m.content === "We are looking into this." && m.authorType === "HUMAN"),
      "the owning user must see the same reply",
    );
  });

  await test("human reply: a user's own active-handoff message is authorType USER, visible to the admin view too", async () => {
    const final = await escalatedRun(TEST_USER, "user reply visibility test");
    await tagConversation(final.id, "conv-user-reply");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-user-reply", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    const updated = await replyAsSupportUser(h.id, TEST_USER, "Still need help with this");
    assert.ok(updated.messages.some((m) => m.content === "Still need help with this" && m.authorType === "USER"));
    const adminView = await getSupportHandoffDetailForAdmin(h.id);
    assert.ok(adminView.messages.some((m) => m.content === "Still need help with this" && m.authorType === "USER" && m.authorUserId === TEST_USER));
  });

  // ----------------------------------------------------------------
  // Evidence / provenance (D7)
  // ----------------------------------------------------------------

  await test("evidence: evidenceIds reference only REAL AgentEvidence rows from the escalating run, never fabricated", async () => {
    const rt = harness(KB_WEAK_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "evidence reference test" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    await tagConversation(final!.id, "conv-evidence");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-evidence", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final!.id });
    assert.ok(h.evidenceIds.length > 0, "the weak KB hit's evidence must be referenced");
    const trace = await agentRunRepository.getRunTrace(final!.id);
    const realIds = new Set(trace.evidence.map((e) => e.id));
    for (const id of h.evidenceIds) assert.ok(realIds.has(id), "every referenced evidenceId must be a real row from the escalating run");
  });

  await test("evidence: admin case detail surfaces real account findings verbatim (D6/D13's deliberate un-redaction for staff)", async () => {
    const rt = harness(KB_WEAK_HIT);
    // account-flavored + escalating: a mutation-intent question guarantees
    // escalate:true even though account_read also runs (ACCOUNT_MARKERS
    // matches "subscription").
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "please cancel my subscription and downgrade my plan" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    const out = final!.output as { escalate?: boolean; accountFindings?: unknown[] };
    assert.equal(out.escalate, true, "mutation intent must escalate");
    assert.ok((out.accountFindings?.length ?? 0) > 0, "fixture sanity check - account findings must actually exist");
    await tagConversation(final!.id, "conv-account-context");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-account-context", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final!.id });
    const detail = await getSupportHandoffDetailForAdmin(h.id);
    const turn = detail.conversationTurns.find((t) => t.runId === final!.id);
    assert.ok(turn, "the escalating turn must appear in the admin conversation view");
    assert.ok(turn!.accountFindings.length > 0, "the admin view must surface the REAL account finding, not hide it");
    assert.match(turn!.accountFindings[0].claim, /pro/i, "the real claim text must be present, never fabricated or redacted for staff");
  });

  // ----------------------------------------------------------------
  // Audit (D13)
  // ----------------------------------------------------------------

  await test("audit: creation, assignment, status change, reopen, and human reply each produce the expected AuditLog action", async () => {
    const final = await escalatedRun(TEST_USER, "audit trail test");
    await tagConversation(final.id, "conv-audit");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-audit", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "IN_PROGRESS", actingAdminUserId: "admin-1" });
    await replyAsSupportAdmin({ id: h.id, adminUserId: "admin-1", content: "working on it" });
    await transitionSupportHandoffAsAdmin({ id: h.id, toStatus: "RESOLVED", actingAdminUserId: "admin-1" });
    await reopenSupportHandoffAsUser(h.id, TEST_USER);

    const logs = await prisma.auditLog.findMany({ where: { targetType: "SupportHandoff", targetId: h.id }, orderBy: { createdAt: "asc" } });
    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes("support_handoff.created"));
    assert.ok(actions.includes("support_handoff.assigned"));
    assert.ok(actions.includes("support_handoff.status_changed"));
    assert.ok(actions.includes("support_handoff.human_reply_added"));
    assert.ok(actions.includes("support_handoff.reopened"));
  });

  await test("audit: reassignment produces support_handoff.reassigned, not support_handoff.assigned again", async () => {
    const final = await escalatedRun(TEST_USER, "reassign audit test");
    await tagConversation(final.id, "conv-reassign-audit");
    const h = await ensureSupportHandoff({ userId: TEST_USER, conversationId: "conv-reassign-audit", triggerSource: "AI_ESCALATION", reason: "r", agentRunId: final.id });
    await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-1", actingAdminUserId: "admin-1" });
    await assignSupportHandoff({ id: h.id, targetAdminUserId: "admin-2", actingAdminUserId: "admin-2" });
    const logs = await prisma.auditLog.findMany({ where: { targetType: "SupportHandoff", targetId: h.id, action: "support_handoff.reassigned" } });
    assert.equal(logs.length, 1);
  });

  // ----------------------------------------------------------------
  // Guest boundary (D9) - guest handoff stays disabled
  // ----------------------------------------------------------------

  await test("guest: services/support/guest-knowledge-query.ts is untouched and never references the handoff domain", () => {
    const f = join(ROOT, "services", "support", "guest-knowledge-query.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    assert.ok(!src.includes("handoff"), "guest-knowledge-query.ts must not reference the handoff domain at all - guest handoff is out of scope (D9)");
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
