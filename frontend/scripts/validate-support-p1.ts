// scripts/validate-support-p1.ts
// AT24 Support - P1 (AUTONOMOUS_SUPPORT_P1_CONTRACT.md, commit 4d9d21a;
// implementation edf5e47; merge-blocker remediation for the P1 Merge Review).
//
// House style (node:assert/strict, tsx). Run: npm run validate:support-p1
//
// MERGE-BLOCKER FIXES covered here (P1 Merge Review, applied to edf5e47):
//   1. Guest transcript disappeared from the widget the instant `mode`
//      flipped to "authenticated" (session probe on mount/focus) - a
//      contract SS6/SS12 violation ("the visible transcript stays on
//      screen"). Fixed by rendering guestTurns unconditionally.
//   2. Guest rate limiter derived client IP from X-Forwarded-For's FIRST
//      (client-spoofable) hop instead of the LAST (trusted-edge-appended)
//      one - trivially bypassable. Fixed in clientIpFromHeaders().
//   3. recordResolutionConfirmation had no SUPPORT-type guard, so any other
//      terminal agent run (RESEARCH/MARKET_INTELLIGENCE/STRATEGY_RESEARCH)
//      silently passed the coverage/escalate eligibility check (those
//      fields are simply undefined on their output). Fixed with an
//      explicit `metadata.definition.type === "SUPPORT"` guard.
//
// Covers the P1 implementation surface at the service layer (route-level
// HTTP behavior + visual/UX behavior are covered by the production smoke
// pass, SS19 of the contract - this script proves the underlying logic the
// routes are thin wrappers over):
//
//   - guest rate limiter: allows up to the window budget, rejects the next
//     request, a new window resets it (SS14.3)
//   - structural: the guest support surface (guest-knowledge-query.ts) never
//     imports support-account-read.tool.ts, never references
//     prisma.user/subscription/purchase, never reads a session - not a
//     runtime check that could be bypassed, a source-shape guarantee (SS6/
//     SS11, test #12/#18 of the contract's matrix)
//   - structural: the guest path's visibility filter is hard-coded ["public"]
//     and the string "customer" never appears in the file (SS8/SS11 - the
//     narrower-than-CS1 guarantee, test #14)
//   - specialist constants (SUPPORT_STRONG_MATCH/SUPPORT_CITE_BAND/
//     MUTATION_MARKERS) are exported unchanged (SS17 non-behavioral
//     extraction)
//   - answerGuestQuestion(): mutation-intent -> escalate true with the
//     account-change reason, deterministically, independent of live KB/
//     embedding state (SS6 mutation guard, test #16)
//   - answerGuestQuestion(): best-effort real-corpus E2E - shape invariants
//     hold either way (never an account-shaped field, disclaimer present)
//   - resolution confirmation (recordResolutionConfirmation):
//       * eligible (kb-answered, not escalated) run -> confirmed:true
//         succeeds, metadata.resolutionConfirmation persisted (SS10, G5)
//       * escalated run -> confirmed:true throws ResolutionNotEligibleError
//       * no-coverage run -> confirmed:true throws ResolutionNotEligibleError
//       * confirmed:false is NEVER gated by eligibility (the negative case
//         cannot produce a false-positive metric, SS10)
//       * a non-terminal run -> throws RunNotTerminalError
//       * a run owned by a different user -> returns null (ownership,
//         identical primitive to advance/get)

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
  recordResolutionConfirmation,
  ResolutionNotEligibleError,
  RunNotTerminalError,
} from "../services/agent-framework/api/agent-run-service";
import { getAgentRun } from "../services/agent-framework/api/agent-run-service";
import {
  SUPPORT_STRONG_MATCH,
  SUPPORT_CITE_BAND,
  MUTATION_MARKERS,
} from "../services/agent-framework/supervisor/specialists/support.specialist";
import { answerGuestQuestion } from "../services/support/guest-knowledge-query";
import { checkGuestRateLimit, clientIpFromHeaders, _resetGuestRateLimitForTests } from "../services/support/guest-rate-limit";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

const TEST_USER = `validate-support-p1-${process.pid}-${Date.now().toString(36)}`;
const OTHER_USER = `validate-support-p1-other-${process.pid}-${Date.now().toString(36)}`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Strips // and /* */ comments before a structural substring/regex check, so
// a file's OWN explanatory comments (which necessarily name the very things
// they promise never to import/reference) can't produce a false positive.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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
// Fakes for the two support tools (same fixtures/shape as
// validate-agent-support.ts), used to produce real, terminal AgentRun rows
// with a controlled coverage/escalate outcome to exercise
// recordResolutionConfirmation against.
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
    handler: async () => ({ output: { snapshot: {}, domains: [] }, evidence: [] }),
  };
}

const KB_STRONG_HIT = [{ claim: "To change your plan, open Settings -> Billing.", topic: "faq", relevance: 0.83 }];
const KB_WEAK_HIT = [{ claim: "Contact support for account issues.", topic: "faq", relevance: 0.48 }];

function fakeRegistry(kb: typeof KB_STRONG_HIT): ToolRegistry {
  return new ToolRegistry().register(fakeKnowledgeTool(kb)).register(fakeAccountTool()).freeze();
}

function harness(kb: typeof KB_STRONG_HIT) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const store = new InMemoryEvaluationStore();
  const evaluation = new EvaluationService({ registry: fakeRegistry(kb), creditLedger: ledger, store });
  const rt = new AgentRuntime({ registry: fakeRegistry(kb), creditLedger: ledger, evaluation });
  return rt;
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
  await agentRunRepository._deleteRunsForUser(OTHER_USER);
}

async function main(): Promise<void> {
  console.log("\nAT24 Support P1 validation (contract 4d9d21a)\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. Guest rate limiter (pure unit, no DB)
  // ----------------------------------------------------------------

  await test("guest rate limiter: allows up to the window budget, rejects the next, a new window resets", () => {
    _resetGuestRateLimitForTests();
    const ip = "203.0.113.7";
    let t = 1_000_000;
    for (let i = 0; i < 10; i++) assert.equal(checkGuestRateLimit(ip, t), true, `request ${i + 1} within budget`);
    assert.equal(checkGuestRateLimit(ip, t), false, "11th request in the same window is rejected");
    assert.equal(checkGuestRateLimit("203.0.113.8", t), true, "a different IP has its own budget");
    t += 61_000; // past the 60s window
    assert.equal(checkGuestRateLimit(ip, t), true, "a new window resets the budget");
    _resetGuestRateLimitForTests();
  });

  await test("MERGE-BLOCKER FIX 2: clientIpFromHeaders trusts the LAST X-Forwarded-For hop, not the client-spoofable first one", () => {
    // A client can put ANYTHING in X-Forwarded-For; the trusted edge
    // appends the real socket peer as the LAST hop. Trusting the first
    // entry (the original bug) lets an attacker get a fresh bucket on
    // every request just by sending a different fake leftmost value.
    const spoofedButSameRealClient1 = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.99" });
    const spoofedButSameRealClient2 = new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.99" });
    assert.equal(clientIpFromHeaders(spoofedButSameRealClient1), "203.0.113.99");
    assert.equal(
      clientIpFromHeaders(spoofedButSameRealClient1),
      clientIpFromHeaders(spoofedButSameRealClient2),
      "two requests with different spoofed leftmost values but the same real edge-appended IP must land in the SAME rate-limit bucket",
    );
    // A single-hop chain (no client-supplied XFF, just what the edge itself set).
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.50" })), "203.0.113.50");
    // Whitespace around hops is trimmed.
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1 ,  203.0.113.7  " })), "203.0.113.7");
    // Falls back to x-real-ip, then "unknown" - never throws on absent headers.
    assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "203.0.113.88" })), "203.0.113.88");
    assert.equal(clientIpFromHeaders(new Headers()), "unknown");

    // End-to-end: prove the fix actually changes rate-limit OUTCOME, not
    // just the derived string. Same real client (last hop 203.0.113.99),
    // 10 requests each with a FRESH spoofed leftmost value - the 11th must
    // still be rejected because they all resolve to one bucket.
    _resetGuestRateLimitForTests();
    const t = 2_000_000;
    for (let i = 0; i < 10; i++) {
      const ip = clientIpFromHeaders(new Headers({ "x-forwarded-for": `10.0.0.${i}, 203.0.113.99` }));
      assert.equal(checkGuestRateLimit(ip, t), true, `spoofed request ${i + 1} within the real client's budget`);
    }
    const eleventhIp = clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.0.0.255, 203.0.113.99" }));
    assert.equal(checkGuestRateLimit(eleventhIp, t), false, "11th request from the SAME real client, new spoofed leftmost value, still rejected");
    _resetGuestRateLimitForTests();
  });

  // ----------------------------------------------------------------
  // 2. Structural: the guest path cannot reach account data (SS6/SS11)
  // ----------------------------------------------------------------

  await test("structural: guest-knowledge-query.ts never imports the account tool / prisma.user/subscription/purchase / any session helper", () => {
    const f = join(ROOT, "services", "support", "guest-knowledge-query.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    for (const forbidden of [
      "support-account-read",
      "prisma.user",
      "prisma.subscription",
      "prisma.purchase",
      "getUserOrNull",
      "requireUser",
      "sessionUser",
      "ctx.userId",
      "@/lib/prisma", // the guest path has no reason to touch prisma at all - retrieval goes through the shared core
    ]) {
      assert.ok(!src.includes(forbidden), `guest-knowledge-query.ts must not reference "${forbidden}" (outside comments)`);
    }
  });

  await test("structural: the guest API route never imports the account tool or a session helper", () => {
    const f = join(ROOT, "app", "api", "support", "guest", "route.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    for (const forbidden of ["support-account-read", "getUserOrNull", "sessionUser", "prisma"]) {
      assert.ok(!src.includes(forbidden), `app/api/support/guest/route.ts must not reference "${forbidden}" (outside comments)`);
    }
  });

  await test('structural: the guest path\'s visibility filter is hard-coded ["public"] - "customer" never appears in executable code', () => {
    const f = join(ROOT, "services", "support", "guest-knowledge-query.ts");
    const raw = readFileSync(f, "utf8");
    assert.match(raw, /GUEST_VISIBILITIES\s*=\s*\[\s*"public"\s*\]/, "visibility literal must be exactly [\"public\"]");
    const src = stripComments(raw);
    assert.ok(!src.includes("customer"), 'the guest module must never mention "customer" visibility outside comments');
  });

  await test("structural: the session probe route returns no PII, only { authenticated }", () => {
    const f = join(ROOT, "app", "api", "support", "session", "route.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    assert.match(src, /authenticated:\s*sessionUser\s*!==\s*null/, "boolean derivation, not a profile/user object");
    for (const forbidden of ["profile.email", "profile.id", "profile.name"]) {
      assert.ok(!src.includes(forbidden), `session probe must not reference "${forbidden}"`);
    }
  });

  await test("MERGE-BLOCKER FIX 1: SupportWidget renders guestTurns unconditionally - never gated on `mode` (contract SS6/SS12 transcript-preservation)", () => {
    const f = join(ROOT, "components", "support", "SupportWidget.tsx");
    const src = stripComments(readFileSync(f, "utf8"));
    // The original bug: guestTurns only rendered while mode !== "authenticated",
    // so the session probe flipping `mode` on login/focus made a guest's own
    // visible transcript disappear. Assert that exact buggy gate is gone...
    assert.ok(
      !/mode\s*!==\s*"authenticated"\s*&&\s*guestTurns/.test(src),
      "guestTurns must not be gated on mode !== \"authenticated\" (this is exactly the bug that made a guest's transcript vanish on login)",
    );
    // ...and the unconditional render is present.
    assert.match(
      src,
      /\{guestTurns\.map\(/,
      "guestTurns.map( must appear unconditionally (not wrapped in a mode check)",
    );
    // hasAnyTurn must also count guestTurns regardless of mode, or the
    // empty-state hint would render above a still-visible guest transcript.
    assert.match(
      src,
      /hasAnyTurn\s*=\s*\n?\s*guestTurns\.length\s*>\s*0/,
      "hasAnyTurn must OR in guestTurns.length > 0 unconditionally, not only inside the guest-mode branch",
    );
  });

  await test("structural: the new resolution route matches the existing runs/[id] routes' security posture (same check as validate-agent-api.ts SS6)", () => {
    const f = join(ROOT, "app", "api", "private", "agents", "framework", "runs", "[id]", "resolution", "route.ts");
    const src = stripComments(readFileSync(f, "utf8"));
    assert.match(src, /getUserOrNull\(\)/, "authenticates");
    assert.match(src, /sessionUser\.profile\.id/, "uses the session user id");
    assert.ok(!/body\.(userId|requesterId)|\buserId\b\s*:\s*(body|req)/.test(src), "must not read a userId from the body");
    for (const bad of ["new AgentRuntime", "SupervisorService", "authorization-service", "authorizationService", "tool-gateway", "invokeTool", "@/lib/ai"]) {
      assert.ok(!src.includes(bad), `must not import "${bad}" - delegate to the service`);
    }
  });

  // ----------------------------------------------------------------
  // 3. Extraction non-behavioral (SS17): constants unchanged
  // ----------------------------------------------------------------

  await test("specialist constants exported unchanged: SUPPORT_STRONG_MATCH=0.6, SUPPORT_CITE_BAND=0.1", () => {
    assert.equal(SUPPORT_STRONG_MATCH, 0.6);
    assert.equal(SUPPORT_CITE_BAND, 0.1);
    assert.ok(MUTATION_MARKERS.test("please cancel my subscription"));
    assert.ok(!MUTATION_MARKERS.test("how do I install an expert advisor"));
  });

  // ----------------------------------------------------------------
  // 4. answerGuestQuestion (SS6/SS14)
  // ----------------------------------------------------------------

  await test("answerGuestQuestion: mutation intent -> escalate true + account-change reason, independent of KB/embedding state", async () => {
    const answer = await answerGuestQuestion("Please cancel my subscription right now.");
    assert.equal(answer.escalate, true);
    assert.equal(answer.escalationReason, "requires-an-account-change-only-a-human-or-an-authorised-flow-can-make");
    assert.equal(typeof answer.disclaimer, "string");
    assert.ok(answer.disclaimer.length > 0);
  });

  await test("answerGuestQuestion: shape invariants hold against the real corpus (best-effort - embedding/DB may be unavailable)", async () => {
    const answer = await answerGuestQuestion("How do I install an Expert Advisor on MetaTrader 5?");
    assert.ok(["kb-answered", "no-coverage"].includes(answer.coverage));
    assert.equal(typeof answer.escalate, "boolean");
    assert.ok(Array.isArray(answer.citations));
    for (const c of answer.citations) {
      assert.deepEqual(Object.keys(c).sort(), ["content", "relevance", "title", "topic"]);
    }
    // never anything account-shaped, structurally - the type has no such field
    assert.ok(!("accountFindings" in answer));
    console.log(`      -> (live) ${answer.coverage}, ${answer.citations.length} citation(s), escalate=${answer.escalate}`);
  });

  // ----------------------------------------------------------------
  // 5. recordResolutionConfirmation (SS10, G5)
  // ----------------------------------------------------------------

  await test("recordResolutionConfirmation: eligible (kb-answered, not escalated) run -> confirmed:true succeeds and persists", async () => {
    const rt = harness(KB_STRONG_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "What is my subscription status?" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.coverage, "kb-answered");
    assert.equal(out.escalate, false);

    const result = await recordResolutionConfirmation(TEST_USER, final!.id, true);
    assert.ok(result, "confirmation accepted");
    const confirmation = (result!.observability.run!.metadata as { resolutionConfirmation?: { confirmed: boolean } })
      .resolutionConfirmation;
    assert.equal(confirmation?.confirmed, true);

    // Re-read via the same seam the route uses.
    const reread = await getAgentRun(TEST_USER, final!.id);
    assert.equal(
      (reread!.run!.metadata as { resolutionConfirmation?: { confirmed: boolean } }).resolutionConfirmation?.confirmed,
      true,
    );
  });

  await test("recordResolutionConfirmation: escalated run -> confirmed:true throws ResolutionNotEligibleError", async () => {
    const rt = harness(KB_STRONG_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "Please cancel my subscription now." }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    assert.equal((final!.output as Record<string, unknown>).escalate, true);

    await assert.rejects(
      () => recordResolutionConfirmation(TEST_USER, final!.id, true),
      ResolutionNotEligibleError,
    );
    // the negative case is NEVER gated - it can't produce a false-positive metric.
    const result = await recordResolutionConfirmation(TEST_USER, final!.id, false);
    assert.ok(result, "confirmed:false is always accepted on a terminal run");
    assert.equal(
      (result!.observability.run!.metadata as { resolutionConfirmation?: { confirmed: boolean } }).resolutionConfirmation
        ?.confirmed,
      false,
    );
  });

  await test("recordResolutionConfirmation: no-coverage run -> confirmed:true throws ResolutionNotEligibleError", async () => {
    const rt = harness(KB_WEAK_HIT); // below SUPPORT_STRONG_MATCH -> no-coverage
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "how do I export my trade history" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    assert.equal((final!.output as Record<string, unknown>).coverage, "no-coverage");

    await assert.rejects(
      () => recordResolutionConfirmation(TEST_USER, final!.id, true),
      ResolutionNotEligibleError,
    );
  });

  await test("recordResolutionConfirmation: a non-terminal run throws RunNotTerminalError", async () => {
    const row = await agentRunRepository.createRun({
      agentId: "support-agent",
      agentVersion: "1.0.0",
      userId: TEST_USER,
      trigger: "manual",
      input: { question: "still running" },
      limits: {},
      creditsEstimated: 0,
      metadata: {},
    });
    assert.equal(row.status, "queued");
    await assert.rejects(() => recordResolutionConfirmation(TEST_USER, row.id, true), RunNotTerminalError);
    await assert.rejects(() => recordResolutionConfirmation(TEST_USER, row.id, false), RunNotTerminalError);
  });

  await test("MERGE-BLOCKER FIX 3: recordResolutionConfirmation rejects a non-SUPPORT run for BOTH confirmed:true and confirmed:false", async () => {
    // Simulate a terminal RESEARCH-agent run: no `coverage`/`escalate` on its
    // output at all. Before the fix, the eligibility check silently no-op'd
    // for exactly this shape (undefined !== "no-coverage" is false) and
    // treated it as always-eligible for a positive confirmation.
    const row = await agentRunRepository.createRun({
      agentId: "research-agent",
      agentVersion: "1.0.0",
      userId: TEST_USER,
      trigger: "manual",
      input: { question: "unrelated research question" },
      limits: {},
      creditsEstimated: 0,
      metadata: { definition: { type: "RESEARCH" } },
    });
    await agentRunRepository.patchRun(row.id, {
      status: "succeeded",
      output: { kind: "research-answer", someField: "no coverage/escalate fields at all" },
      completedAt: new Date(),
    });

    await assert.rejects(
      () => recordResolutionConfirmation(TEST_USER, row.id, true),
      ResolutionNotEligibleError,
      "a non-SUPPORT run must reject confirmed:true",
    );
    await assert.rejects(
      () => recordResolutionConfirmation(TEST_USER, row.id, false),
      ResolutionNotEligibleError,
      "a non-SUPPORT run must ALSO reject confirmed:false - the whole concept is SUPPORT-specific",
    );

    // A run with no `definition` metadata at all (defensive: missing data
    // must fail closed, never be treated as an implicit SUPPORT run).
    const rowNoDefinition = await agentRunRepository.createRun({
      agentId: "unknown-agent",
      agentVersion: "1.0.0",
      userId: TEST_USER,
      trigger: "manual",
      input: {},
      limits: {},
      creditsEstimated: 0,
      metadata: {},
    });
    await agentRunRepository.patchRun(rowNoDefinition.id, { status: "succeeded", output: {}, completedAt: new Date() });
    await assert.rejects(() => recordResolutionConfirmation(TEST_USER, rowNoDefinition.id, true), ResolutionNotEligibleError);
  });

  await test("recordResolutionConfirmation: a run owned by a different user returns null (ownership, same primitive as advance/get)", async () => {
    const rt = harness(KB_STRONG_HIT);
    const final = await runSupportAgent({ userId: TEST_USER, goal: { question: "What is my subscription status?" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    const result = await recordResolutionConfirmation(OTHER_USER, final!.id, true);
    assert.equal(result, null, "cross-account confirmation attempt returns null, not the run");
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
