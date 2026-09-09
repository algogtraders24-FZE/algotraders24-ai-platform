// scripts/validate-knowledge-loop-orchestrator.ts
// Sprint K3-B-2 — the KnowledgeAnswerOrchestrator (AI_ASSISTANT_ORCHESTRATION_
// CONTRACT.md §1–§8 / K3_PREFLIGHT §6.1). Runs entirely against in-memory
// doubles — ZERO DB, ZERO LLM, ZERO network.
//
// Run: npm run validate:knowledge-loop-orchestrator
//
// Proves:
//   - knowledge-first: retrieval ALWAYS runs first; a SUFFICIENT retrieval →
//     sourceClass AT24_KNOWLEDGE, web search NOT requested
//   - INSUFFICIENT + current-info → web search requested → CLAUDE_WEB_SEARCH
//   - knowledge + web both contribute → MIXED, per-source usedInAnswer recorded
//   - provider fall-through: claude throws → gemini; all throw → deterministic
//   - forbidden-language on a candidate → next slot
//   - account-specific → deterministic pointer, NO provider call, web forbidden
//   - retrieval failure is absorbed (still answers)
//   - the assistant retrieves against exactly ["assistant","shared"]
//   - EXACTLY one KnowledgeAnswerProvenance row per turn; best-effort on failure

import assert from "node:assert/strict";
import { KnowledgeAnswerOrchestrator } from "../services/knowledge-loop/orchestrator/knowledge-answer-orchestrator";
import {
  FakeRetrieval,
  FakeProviderSlot,
  InMemoryProvenanceStore,
} from "../services/knowledge-loop/orchestrator/in-memory-adapters";
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
  requestId: "req_1",
  callerUserId: "user_1",
  callerRole: "user",
  conversationId: "conv_1",
  messageId: "msg_1",
  message: "What is a moving average?",
  ...over,
});

async function main(): Promise<void> {
  console.log("\nK3-B-2 — KnowledgeAnswerOrchestrator\n");

  await test("knowledge-first: SUFFICIENT retrieval → AT24_KNOWLEDGE, no web", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ knowledgeId: "k1", content: "An MA is the mean price over N bars." }],
      contextBlock: "An MA is the mean price over N bars.",
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "A moving average is the average price over a window." });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.sourceClass, "AT24_KNOWLEDGE");
    assert.equal(r.providerUsed, "claude");
    assert.equal(r.webSearchUsed, false);
    assert.equal(claude.calls.length, 1);
    assert.equal(claude.calls[0].webSearchEnabled, false, "web search must NOT be enabled");
    assert.ok(claude.calls[0].knowledgeBlock.includes("mean price"), "knowledge block handed to provider");
    assert.equal(prov.rows.length, 1, "exactly one provenance row");
    assert.equal(prov.rows[0].sourceClass, "AT24_KNOWLEDGE");
    assert.equal(prov.rows[0].knowledgeContributions.length, 1);
    assert.equal(prov.rows[0].knowledgeContributions[0].usedInAnswer, true);
    assert.equal(r.provenanceId, "prov_mem_1");
  });

  await test("retrieval always runs first, against ['assistant','shared']", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });
    await orch.answer(turn({ message: "Tell me about the platform" }));
    assert.deepEqual(retrieval.lastScopes, ["assistant", "shared"]);
    assert.equal(retrieval.lastQuery, "Tell me about the platform");
  });

  await test("INSUFFICIENT + current-info → web requested → CLAUDE_WEB_SEARCH", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT", hits: [] });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      reply: () => ({
        text: "The latest Node.js LTS is 24.x.",
        webSources: [{ url: "https://nodejs.org/en/about/releases", title: "Releases", citedTexts: ["Node.js 24 entered LTS"] }],
        searchCount: 1,
      }),
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "What is the latest Node.js LTS version right now?" }));
    assert.equal(claude.calls[0].webSearchEnabled, true, "web search enabled for a current-info + insufficient turn");
    assert.equal(r.sourceClass, "CLAUDE_WEB_SEARCH");
    assert.equal(r.webSearchUsed, true);
    assert.equal(r.sources.filter((s) => s.kind === "web").length, 1);
    assert.equal(r.sources.find((s) => s.kind === "web")?.usedInAnswer, true);
    assert.equal(prov.rows[0].webContributions.length, 1);
    assert.equal(prov.rows[0].webSearchUsed, true);
  });

  await test("knowledge + web both contribute → MIXED", async () => {
    const retrieval = new FakeRetrieval({
      sufficiency: "LOW",
      hits: [{ knowledgeId: "k9", content: "AT24 supports MT5 and MT4." }],
      contextBlock: "AT24 supports MT5 and MT4.",
    });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      reply: () => ({
        text: "AT24 supports MT5/MT4; the latest MT5 build is 4xxx.",
        webSources: [{ url: "https://www.metatrader5.com/en/releasenotes", title: "MT5 release notes", citedTexts: ["build 4xxx"] }],
        searchCount: 1,
      }),
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "Does AT24 support MT5 and what is the latest MT5 build?" }));
    assert.equal(r.sourceClass, "MIXED");
    const kRef = r.sources.find((s) => s.kind === "knowledge");
    // MIXED: the retrieved chunk is recorded (id + similarity preserved) but
    // NOT asserted as used — we have no per-chunk attribution.
    assert.equal(kRef?.usedInAnswer, false, "MIXED must not claim per-chunk usage");
    assert.equal(kRef?.knowledgeId, "k9", "the retrieved chunk is still recorded");
    assert.equal(typeof kRef?.similarity, "number", "similarity metadata preserved");
    // web source WAS cited (citedTexts non-empty) → genuinely used.
    assert.equal(r.sources.find((s) => s.kind === "web")?.usedInAnswer, true);
    assert.equal(prov.rows[0].sourceClass, "MIXED");
    assert.equal(
      (prov.rows[0].knowledgeContributions[0] as { usedInAnswer: boolean }).usedInAnswer,
      false,
      "provenance row carries the honest attribution",
    );
  });

  await test("MIXED with a weak, irrelevant knowledge hit → chunk NOT marked used (Rust/MT5 case)", async () => {
    // Regression for the live-smoke finding: a weak retrieval hit (similarity
    // just over the floor) on an unrelated question was previously marked
    // usedInAnswer=true just because the turn was MIXED.
    const retrieval = new FakeRetrieval({
      sufficiency: "LOW",
      hits: [{ knowledgeId: "kmt", chunkId: "kmt:c0", similarity: 0.31, content: "AT24 supports the MT5 and MT4 trading platforms." }],
      contextBlock: "AT24 supports the MT5 and MT4 trading platforms.",
    });
    const claude = new FakeProviderSlot({
      name: "claude",
      supportsWebSearch: true,
      reply: () => ({
        text: "That's outside AT24's product scope. From the web: the latest stable Rust is 1.9x.",
        webSources: [
          { url: "https://blog.rust-lang.org/", title: "Rust blog", citedTexts: ["Rust 1.9x released"] },
          { url: "https://doc.rust-lang.org/", title: "Rust docs", citedTexts: [] }, // retrieved, not cited
        ],
        searchCount: 1,
      }),
    });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "What is the latest stable version of the Rust language right now?" }));
    assert.equal(r.sourceClass, "MIXED");
    const kRef = r.sources.find((s) => s.kind === "knowledge");
    assert.equal(kRef?.usedInAnswer, false, "the weak MT5 hit must NOT be claimed as used");
    assert.equal(kRef?.knowledgeId, "kmt", "but it IS still recorded as retrieved evidence");
    assert.equal(kRef?.similarity, 0.31, "with its real similarity");
    const webRefs = r.sources.filter((s) => s.kind === "web");
    assert.equal(webRefs.find((s) => s.url === "https://blog.rust-lang.org/")?.usedInAnswer, true, "cited web source → used");
    assert.equal(webRefs.find((s) => s.url === "https://doc.rust-lang.org/")?.usedInAnswer, false, "uncited web source → not used");
  });

  await test("provider fall-through: claude throws → gemini answers", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, throwError: true });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "A general answer from Gemini." });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "gemini");
    assert.equal(r.text, "A general answer from Gemini.");
    assert.equal(prov.rows[0].providerAttempts.length, 2);
    assert.equal(prov.rows[0].providerAttempts[0].ok, false);
    assert.equal(prov.rows[0].providerAttempts[1].ok, true);
  });

  await test("all providers throw → deterministic fallback, still one provenance row", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, throwError: true });
    const gemini = new FakeProviderSlot({ name: "gemini", throwError: true });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.sourceClass, "DETERMINISTIC");
    assert.equal(r.providerUsed, "deterministic");
    assert.ok(r.text.length > 0 && !/guaranteed|buy now/i.test(r.text));
    assert.equal(prov.rows.length, 1);
    assert.equal(prov.rows[0].sourceClass, "DETERMINISTIC");
  });

  await test("unavailable slot is skipped (isAvailable=false)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", available: false, supportsWebSearch: true });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "gemini answer" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "gemini");
    assert.equal(claude.calls.length, 0, "an unavailable slot is never constructed/called");
    assert.equal(prov.rows[0].providerAttempts[0].attempted, false);
  });

  await test("forbidden-language answer → next slot", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "This strategy is a guaranteed profit." });
    const gemini = new FakeProviderSlot({ name: "gemini", text: "This strategy carries risk and past results don't predict the future." });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude, gemini], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.providerUsed, "gemini");
    assert.equal(r.integrityPassed, true);
    assert.equal(prov.rows[0].providerAttempts[0].forbiddenLanguage, true);
  });

  await test("account-specific → deterministic pointer, NO provider call, web forbidden", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }] });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "should never run" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn({ message: "When does my subscription renew and what did you charge my card?" }));
    assert.equal(r.sourceClass, "DETERMINISTIC");
    assert.equal(claude.calls.length, 0, "no LLM call for an account-specific question");
    assert.equal(retrieval.lastQuery, null, "retrieval is skipped for account-specific");
    assert.equal(r.webSearchUsed, false);
    assert.equal(r.classification.intent, "account-specific");
    assert.equal(prov.rows[0].privacyClass, "user-specific");
  });

  await test("retrieval failure is absorbed — still answers", async () => {
    const retrieval = new FakeRetrieval({ throwError: true });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "answer despite retrieval outage" });
    const prov = new InMemoryProvenanceStore();
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.text, "answer despite retrieval outage");
    assert.equal(r.retrievalSufficiency, "INSUFFICIENT");
    assert.equal(prov.rows.length, 1);
  });

  await test("provenance write failure is best-effort (answer unaffected)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "fine answer" });
    const prov = new InMemoryProvenanceStore();
    prov.failWrites = true;
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const r = await orch.answer(turn());
    assert.equal(r.text, "fine answer");
    assert.equal(r.provenanceId, undefined, "no id when the write fails");
    assert.equal(prov.rows.length, 1, "the row was still attempted");
  });

  await test("history is trimmed to the configured window", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "INSUFFICIENT" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });
    const history = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: `turn ${i}` }));
    await orch.answer(turn({ history }));
    assert.ok(claude.calls[0].history.length <= 8, `history window <= 8, got ${claude.calls[0].history.length}`);
    assert.equal(claude.calls[0].history.at(-1)?.content, "turn 19", "keeps the most recent turns");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
