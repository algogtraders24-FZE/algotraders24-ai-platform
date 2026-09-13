// scripts/validate-knowledge-loop-c5-integration.ts
// Sprint K3-C (C5) — the SINGLE orchestrator integration
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12, K3C_DECISION D-K3C-10).
// Dedicated suite (owner-required) — distinct from the K3-B regression suite
// (`validate-knowledge-loop-orchestrator.ts`, still green, unchanged
// expectations). Runs entirely against in-memory doubles — ZERO DB, ZERO LLM.
//
// Proves the wiring itself, not just each module in isolation:
//   1.  AT24 Knowledge answer -> no web
//   2.  current-info -> web offered AND actually used
//   3.  other + borderline similarity (<0.50) -> web offered
//       (bestSimilarity now genuinely reaches the gate through the orchestrator)
//   4.  account-specific -> deterministic short-circuit, retrieval never called
//   5.  Claude clean -> Gemini/OpenAI never invoked
//   6.  Claude continuation exhaustion -> falls through (soft failure, §12.3)
//   7.  Claude single web failure, still answers -> NOT abandoned
//   8.  Gemini wins -> providerUsed=gemini, sourceClass from EVIDENCE
//   9.  web-required + non-web winner -> webSearchRequestedButUnavailable=true
//  10.  partial web failure + grounded winner -> webSearchFailed=true,
//       webSearchRequestedButUnavailable=false
//  11.  DYNAMIC live-figures guard -> deterministic safe response
//  12.  all providers fail -> safe failure, integrityPassed=false (§12.3 C5-d)
//  13.  provenance exactly once
//  14.  no raw-content leakage, END TO END through the real orchestrator
//  15.  the AnswerResult shape (route envelope) is unchanged
// + a structural check: the orchestrator source contains NO duplicate inline
//   decision/sourceClass logic beside the locked C3/C4 modules.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KnowledgeAnswerOrchestrator } from "../services/knowledge-loop/orchestrator/knowledge-answer-orchestrator";
import {
  FakeRetrieval,
  FakeProviderSlot,
  InMemoryProvenanceStore,
} from "../services/knowledge-loop/orchestrator/in-memory-adapters";
import { KNOWLEDGE_ANSWER_CONFIG } from "../config/knowledge-loop.config";
import type { AnswerTurn } from "../types/knowledge-loop";

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

const turn = (over: Partial<AnswerTurn> = {}): AnswerTurn => ({
  requestId: "req_c5",
  callerUserId: "user_c5",
  callerRole: "user",
  conversationId: "conv_c5",
  messageId: "msg_c5",
  message: "What is a moving average?",
  ...over,
});

async function main(): Promise<void> {
  console.log("\nK3-C C5 — single orchestrator integration\n");

  // ── 1. AT24 Knowledge answer -> no web ──────────────────────────────
  await test("1. AT24_KNOWLEDGE answer -> web NOT offered", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ knowledgeId: "k1", content: "An MA is the mean price over N bars." }],
      contextBlock: "An MA is the mean price over N bars.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "A moving average is the mean price over a window." });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.sourceClass, "AT24_KNOWLEDGE");
    assert.equal(claude.calls[0].webSearchEnabled, false);
    assert.equal(r.webSearchUsed, false);
  });

  // ── 2. current-info -> web offered AND used ─────────────────────────
  await test("2. current-info -> web offered and actually used -> CLAUDE_WEB_SEARCH", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT", hits: [] });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      reply: () => ({
        text: "The latest Node.js LTS is 24.x.",
        webSources: [{ url: "https://nodejs.org", title: "Node", citedTexts: ["Node 24 entered LTS"] }],
        searchCount: 1,
      }),
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "What is the latest Node.js LTS version right now?" }));
    assert.equal(claude.calls[0].webSearchEnabled, true, "web offered");
    assert.equal(r.webSearchUsed, true, "web actually used");
    assert.equal(r.sourceClass, "CLAUDE_WEB_SEARCH");
  });

  // ── 3. other + borderline similarity -> web offered (THE end-to-end wiring proof) ──
  await test("3. other intent + borderline SUFFICIENT (bestSimilarity<0.50) -> web offered", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      bestSimilarity: 0.46,
      hits: [{ knowledgeId: "k7", content: "Some tangentially related fact." }],
      contextBlock: "Some tangentially related fact.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "A plain answer." });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });

    const message = "Can you describe the widget layout options?"; // classifies as "other"
    const r = await orch.answer(turn({ message }));
    assert.equal(claude.calls[0].webSearchEnabled, true, "bestSimilarity reached the gate through the orchestrator");
    void r;
  });

  await test("3b. same intent, CONFIDENT similarity (0.9) -> web NOT offered (control)", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      bestSimilarity: 0.9,
      hits: [{ knowledgeId: "k7", content: "A confident fact." }],
      contextBlock: "A confident fact.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "A plain answer." });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });
    await orch.answer(turn({ message: "Can you describe the widget layout options?" }));
    assert.equal(claude.calls[0].webSearchEnabled, false, "confident hit does not need the borderline safety net");
  });

  // ── 4. account-specific -> deterministic, retrieval never called ───
  await test("4. account-specific -> deterministic short-circuit, retrieval never called", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }] });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "should never run" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "When does my subscription renew and what did you charge my card?" }));
    assert.equal(r.sourceClass, "DETERMINISTIC");
    assert.equal(retrieval.lastQuery, null, "retrieval never invoked");
    assert.equal(claude.calls.length, 0, "no LLM call");
    assert.equal(prov.rows[0].retrievalSufficiency, "SKIPPED");
  });

  // ── 5. Claude clean -> Gemini/OpenAI never invoked ─────────────────
  await test("5. Claude clean answer -> Gemini/OpenAI never called", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "clean answer" });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "should never run" });
    const openai = new FakeProviderSlot({ name: "openai", text: "should never run" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini, openai], provenance: new InMemoryProvenanceStore() });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "claude");
    assert.equal(gemini.calls.length, 0);
    assert.equal(openai.calls.length, 0);
  });

  // ── 6. continuation exhaustion -> falls through ─────────────────────
  await test("6. Claude continuation-budget-exhausted -> falls through to Gemini", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      text: "still searching…",
      continuationBudgetExhausted: true,
    });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "gemini's real answer" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "gemini", "a paused/placeholder body must never win");
    assert.equal(r.text, "gemini's real answer");
    assert.equal(prov.rows[0].providerAttempts[0].ok, false);
    assert.equal(prov.rows[0].providerAttempts[0].failure, "continuation-budget-exhausted");
  });

  // ── 7. single web failure, still answers -> NOT abandoned ───────────
  await test("7. Claude single web-search failure -> still wins (not a fall-through trigger)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      text: "Answering from my own knowledge since the search failed.",
      webSearchFailed: true,
      webSearchUnavailable: true,
    });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "should not be needed" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    // how-to -> freshnessNeed STATIC (web required via INSUFFICIENT, not
    // DYNAMIC) so the live-figures guard (test 11) cannot interfere here.
    const r = await orch.answer(turn({ message: "How do I check the newsletter feature status?" }));
    assert.equal(r.providerUsed, "claude", "a single web failure does not abandon the slot");
    assert.equal(gemini.calls.length, 0);
    assert.equal(prov.rows[0].turnMeta?.webSearchFailed, true);
  });

  // ── 8. Gemini wins -> truthful sourceClass ──────────────────────────
  await test("8. Gemini wins -> providerUsed=gemini, sourceClass from evidence", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ knowledgeId: "k1", content: "AT24 supports MT5." }],
      contextBlock: "AT24 supports MT5.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, throwError: true });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "AT24 supports MT5." });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "gemini");
    assert.equal(r.sourceClass, "AT24_KNOWLEDGE", "evidence-derived, not a 'claude-only' label");
    assert.equal(prov.rows[0].providerUsed, "gemini");
  });

  // ── 9. web-required + non-web winner -> requestedButUnavailable=true ──
  await test("9. web-required, non-web fallback wins -> webSearchRequestedButUnavailable=true (C5-a)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT", hits: [] });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, throwError: true });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "gemini's non-web answer" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    // how-to -> freshnessNeed STATIC (web required via INSUFFICIENT, not
    // DYNAMIC) so the live-figures guard (test 11) cannot interfere here.
    const r = await orch.answer(turn({ message: "How do I connect my broker account?" }));
    assert.equal(r.providerUsed, "gemini");
    assert.equal(r.webSearchUsed, false);
    assert.equal(r.webSearchRequestedButUnavailable, true, "web was required; the winner is not web-grounded");
    assert.equal(prov.rows[0].turnMeta?.webSearchFailed, false, "gemini performed no search operation");
  });

  // ── 10. partial web failure + grounded winner ───────────────────────
  await test("10. partial web failure but grounded -> webSearchFailed=true, requestedButUnavailable=false", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT", hits: [] });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      text: "Grounded answer despite one failed search.",
      webSources: [{ url: "https://a.example", title: "A", citedTexts: ["fact"] }],
      searchCount: 2,
      webSearchFailed: true,
      webSearchPartialFailure: true,
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "What is the latest status of the X protocol right now?" }));
    assert.equal(r.webSearchUsed, true);
    assert.equal(r.webSearchRequestedButUnavailable, false, "the answer IS web-grounded");
    assert.equal(prov.rows[0].turnMeta?.webSearchFailed, true, "one search still failed (operational fact)");
    assert.equal(prov.rows[0].turnMeta?.webSearchPartialFailure, true);
  });

  // ── 11. DYNAMIC live-figures guard ──────────────────────────────────
  await test("11. DYNAMIC + not web-grounded + no knowledge -> deterministic safe response", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT", hits: [] });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      text: "The price is probably around $2000 (from training data).",
      webSearchFailed: true,
      webSearchUnavailable: true,
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "What is the price of gold right now?" }));
    assert.equal(r.sourceClass, "DETERMINISTIC");
    assert.equal(r.providerUsed, "deterministic");
    assert.equal(r.text, KNOWLEDGE_ANSWER_CONFIG.DYNAMIC_UNVERIFIABLE_MESSAGE);
    assert.ok(!/\$2000|training data/i.test(r.text), "the stale model guess never reaches the user");
    // the LLM attempt is still honestly recorded as having succeeded:
    assert.equal(prov.rows[0].providerAttempts[0].ok, true, "claude did answer — we chose not to trust it");
    assert.equal(prov.rows[0].turnMeta?.failureCategory, "dynamic-unverifiable");
  });

  await test("11b. DYNAMIC but KNOWLEDGE-grounded -> the guard does NOT override", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ knowledgeId: "k1", content: "The Pro plan costs $49/month." }],
      contextBlock: "The Pro plan costs $49/month.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "The Pro plan costs $49/month." });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });

    const r = await orch.answer(turn({ message: "How much does the Pro plan cost?" }));
    assert.equal(r.sourceClass, "AT24_KNOWLEDGE", "knowledge-grounded DYNAMIC answers are NOT overridden");
  });

  // ── 12. all providers fail -> safe failure ──────────────────────────
  await test("12. all providers fail -> deterministic, integrityPassed=false (C5-d)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, throwError: true });
    const gemini = new FakeProviderSlot({ name: "gemini", throwError: true });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.sourceClass, "DETERMINISTIC");
    assert.ok(r.text.length > 0 && !/guaranteed|buy now/i.test(r.text), "never fabricates");
    assert.equal(r.integrityPassed, false, "K3-C intentional change: chain-exhausted is not an integrity pass");
    assert.equal(prov.rows[0].turnMeta?.failureCategory, "chain-exhausted");
  });

  // ── 13. provenance exactly once ──────────────────────────────────────
  await test("13. exactly one provenance row per turn", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });
    await orch.answer(turn());
    await orch.answer(turn({ requestId: "req_2" }));
    assert.equal(prov.rows.length, 2, "one row per answer() call, no duplicates, no drops");
  });

  // ── 14. no raw-content leakage, end to end ──────────────────────────
  await test("14. no raw message/answer text leaks into the persisted row (end-to-end)", async () => {
    const secretMarker = "USER-SECRET-QUERY-MARKER-77";
    const answerMarker = "ANSWER-TEXT-MARKER-88";
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ knowledgeId: "k1", content: "KNOWLEDGE-EXCERPT-MARKER: a fact." }],
      contextBlock: "KNOWLEDGE-EXCERPT-MARKER: a fact.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: `${answerMarker} — the answer.` });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    await orch.answer(turn({ message: `Tell me about the widget, ${secretMarker}` }));
    const json = JSON.stringify(prov.rows[0]);
    assert.ok(!json.includes(secretMarker), "raw user message must not reach provenance");
    assert.ok(!json.includes(answerMarker), "raw answer text must not reach provenance");
    assert.ok(json.includes("KNOWLEDGE-EXCERPT-MARKER"), "the sanctioned knowledge excerpt IS allowed");
  });

  // ── 15. AnswerResult shape (route envelope) unchanged ───────────────
  await test("15. AnswerResult shape is unchanged (route compatibility)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });
    const r = await orch.answer(turn());
    assert.deepEqual(
      Object.keys(r).sort(),
      [
        "classification",
        "fromCache",
        "integrityPassed",
        "latencyMs",
        "provenanceId",
        "providerUsed",
        "retrievalSufficiency",
        "sourceClass",
        "sources",
        "text",
        "webSearchRequestedButUnavailable",
        "webSearchUsed",
      ].sort(),
      "the route reads exactly these fields — no field was added, renamed, or removed",
    );
  });

  // ── structural — the old inline logic is NOT duplicated beside C3/C4 ──
  await test("structural: orchestrator delegates to decidePreGeneration/deriveSourceClass/liveFiguresGuardApplies/buildProvenance — no duplicate inline logic", () => {
    const src = readFileSync(
      join(__dirname, "..", "services", "knowledge-loop", "orchestrator", "knowledge-answer-orchestrator.ts"),
      "utf8",
    );
    assert.ok(/\bdecidePreGeneration\(classification/.test(src), "must call decidePreGeneration");
    // called twice: once pre-retrieval (account-specific), once post-retrieval (the real gate)
    assert.equal(
      (src.match(/\bdecidePreGeneration\(classification/g) ?? []).length,
      2,
      "decidePreGeneration is the ONE decision authority, called for both phases",
    );
    assert.ok(/\bderiveSourceClass\s*\(/.test(src), "must call deriveSourceClass (C3) — not re-derive sourceClass inline");
    assert.ok(/\bliveFiguresGuardApplies\s*\(/.test(src), "must call the C3 guard predicate");
    assert.ok(/\bbuildProvenance\s*\(/.test(src), "must call buildProvenance (C4) — the ONLY provenance constructor");
    // the old K3-B inline sourceClass ternary must be GONE:
    assert.ok(!/knowledgeCounted\s*\?\s*"MIXED"/.test(src), "no duplicate inline sourceClass derivation");
    // the account-specific intent must be tested ONLY inside decide-path.ts, never
    // re-implemented here as a second, independent condition:
    assert.ok(!/classification\.intent\s*===\s*["']account-specific["']/.test(src), "no duplicate account-specific check outside decidePreGeneration");
    // provenance must never be built as a raw object literal in this file:
    assert.ok(!/const\s+input\s*:\s*KnowledgeAnswerProvenanceInput/.test(src), "provenance is never hand-built here — always via buildProvenance");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
