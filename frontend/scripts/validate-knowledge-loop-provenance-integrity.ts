// scripts/validate-knowledge-loop-provenance-integrity.ts
// Sprint K3-C (C4) — provenance integrity as HARD invariants
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.6). Pure, ZERO I/O, ZERO LLM.
//
// Run: npm run validate:knowledge-loop-provenance-integrity
//
// Locks:
//   - usedInAnswer = ACTUAL contribution, not "was retrieved"
//     (knowledge: AT24_KNOWLEDGE only; web: actually cited only)
//   - sourceClass from evidence, never provider identity
//   - providerUsed = the real winner; a failed/abandoned provider never
//     becomes the evidence source
//   - fallback-provider wins preserve truthful provenance
//   - webSearchFailed (operational) ⟂ webSearchRequestedButUnavailable (evidence)
//   - NO raw query/answer/history/secret in the row (sanitised)
//   - empty/failed persistence never manufactures a successful provenance id
//   - exactly-one provenance input per turn
//   - account-specific → retrievalSufficiency "SKIPPED"

import assert from "node:assert/strict";
import {
  buildProvenance,
  sanitizeProvenanceText,
  type ProvenanceFacts,
  type ProvenanceOutcome,
} from "../services/knowledge-loop/orchestrator/build-provenance";
import { InMemoryProvenanceStore } from "../services/knowledge-loop/orchestrator/provenance-store";
import type {
  AnswerProviderAttempt,
  AIWebSource,
  Classification,
  Sufficiency,
} from "../types/knowledge-loop";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => { passed += 1; console.log(`  ok - ${name}`); },
        (err) => { failed += 1; console.error(`  FAIL - ${name}\n    ${err instanceof Error ? err.message : String(err)}`); },
      );
    }
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── fixtures ──────────────────────────────────────────────────────────
const cls = (over: Partial<Classification> = {}): Classification => ({
  intent: "other",
  freshnessNeed: "PERIODIC",
  privacyClass: "public",
  explicitFreshnessRequest: false,
  ...over,
});

const hit = (over: Partial<ProvenanceFacts["retrieval"]["hits"][number]> = {}) => ({
  knowledgeId: "k1",
  chunkId: "k1:c0",
  chunkIndex: 0,
  similarity: 0.7,
  content: "AT24 supports MT5 and MT4.",
  freshnessClass: "PERIODIC" as string | null,
  ...over,
});

const webSrc = (over: Partial<AIWebSource> = {}): AIWebSource => ({
  url: "https://example.com/a",
  title: "A",
  citedTexts: ["cited fact"],
  ...over,
});

function facts(over: {
  classification?: Partial<Classification>;
  sufficiency?: Sufficiency;
  bestSimilarity?: number;
  hits?: Array<Partial<ProvenanceFacts["retrieval"]["hits"][number]>>;
  contextBlockNonEmpty?: boolean;
  skipped?: boolean;
  webSearchOffered?: boolean;
  gateReason?: string;
  outcome?: Partial<Extract<ProvenanceOutcome, { kind: "generated" }>> | ProvenanceOutcome;
  attempts?: AnswerProviderAttempt[];
} = {}): ProvenanceFacts {
  const hits = (over.hits ?? [{}]).map((h) => hit(h));
  let outcome: ProvenanceOutcome;
  if (over.outcome && "kind" in over.outcome && over.outcome.kind) {
    outcome = over.outcome as ProvenanceOutcome;
  } else {
    outcome = {
      kind: "generated",
      providerUsed: "claude",
      webSources: [],
      searchCount: 0,
      webSearchUsed: false,
      webSearchFailed: false,
      webSearchPartialFailure: false,
      continuationCount: 0,
      continuationBudgetExhausted: false,
      truncated: false,
      ...(over.outcome ?? {}),
    };
  }
  return {
    turn: { requestId: "req1", callerUserId: "u1", conversationId: "c1", messageId: "m1" },
    classification: cls(over.classification),
    retrieval: {
      sufficiency: over.sufficiency ?? "SUFFICIENT",
      bestSimilarity: over.bestSimilarity ?? 0.7,
      contextBlockNonEmpty: over.contextBlockNonEmpty ?? true,
      conflict: null,
      skipped: over.skipped ?? false,
      hits,
    },
    decision: {
      webSearchOffered: over.webSearchOffered ?? false,
      gateReason: over.gateReason ?? "not-needed",
    },
    outcome,
    attempts: over.attempts ?? [{ provider: "claude", attempted: true, ok: true, latencyMs: 10 }],
    latencyMs: 42,
  };
}

async function main(): Promise<void> {
  console.log("\nK3-C C4 — provenance integrity (§12.6)\n");

  // ── usedInAnswer = actual contribution, across the 4 sourceClasses ────
  await test("AT24_KNOWLEDGE: knowledge usedInAnswer=true, web empty", () => {
    const b = buildProvenance(facts({ sufficiency: "SUFFICIENT" }));
    assert.equal(b.provenanceInput.sourceClass, "AT24_KNOWLEDGE");
    assert.equal(b.provenanceInput.knowledgeContributions[0].usedInAnswer, true);
    assert.equal(b.provenanceInput.webContributions.length, 0);
  });

  await test("MIXED: knowledge recorded but usedInAnswer=false (similarity kept); cited web=true", () => {
    const b = buildProvenance(
      facts({
        sufficiency: "LOW",
        hits: [{ similarity: 0.31 }],
        outcome: { webSources: [webSrc()], searchCount: 1, webSearchUsed: true },
        webSearchOffered: true,
        gateReason: "insufficient",
      }),
    );
    assert.equal(b.provenanceInput.sourceClass, "MIXED");
    const k = b.provenanceInput.knowledgeContributions[0];
    assert.equal(k.usedInAnswer, false, "MIXED must not claim per-chunk usage");
    assert.equal(k.similarity, 0.31, "weak-hit similarity preserved");
    assert.equal(b.provenanceInput.webContributions[0].usedInAnswer, true);
  });

  await test("CLAUDE_REASONING: knowledge recorded, usedInAnswer=false; web empty", () => {
    const b = buildProvenance(
      facts({ sufficiency: "INSUFFICIENT", hits: [{ similarity: 0.2 }], contextBlockNonEmpty: true }),
    );
    assert.equal(b.provenanceInput.sourceClass, "CLAUDE_REASONING");
    assert.equal(b.provenanceInput.knowledgeContributions[0].usedInAnswer, false);
  });

  await test("CLAUDE_WEB_SEARCH: knowledge usedInAnswer=false; cited web=true", () => {
    const b = buildProvenance(
      facts({
        sufficiency: "INSUFFICIENT",
        hits: [{ similarity: 0.2 }],
        outcome: { webSources: [webSrc()], searchCount: 1, webSearchUsed: true },
        webSearchOffered: true,
      }),
    );
    assert.equal(b.provenanceInput.sourceClass, "CLAUDE_WEB_SEARCH");
    assert.equal(b.provenanceInput.knowledgeContributions[0].usedInAnswer, false);
    assert.equal(b.provenanceInput.webContributions[0].usedInAnswer, true);
  });

  // ── web attribution = ACTUAL citation, not presence ──────────────────
  await test("web source with NO citedTexts → usedInAnswer=false even in MIXED", () => {
    const b = buildProvenance(
      facts({
        sufficiency: "LOW",
        outcome: {
          webSources: [webSrc({ url: "https://cited.example", citedTexts: ["fact"] }), webSrc({ url: "https://uncited.example", citedTexts: [] })],
          searchCount: 1,
          webSearchUsed: true,
        },
        webSearchOffered: true,
      }),
    );
    assert.equal(b.provenanceInput.sourceClass, "MIXED");
    const cited = b.provenanceInput.webContributions.find((w) => w.url === "https://cited.example");
    const uncited = b.provenanceInput.webContributions.find((w) => w.url === "https://uncited.example");
    assert.equal(cited?.usedInAnswer, true);
    assert.equal(uncited?.usedInAnswer, false, "a retrieved-but-uncited result is NOT a contribution");
  });

  // ── providerUsed ⟂ sourceClass ──────────────────────────────────────
  await test("fallback: gemini wins → providerUsed='gemini', sourceClass from EVIDENCE", () => {
    const attempts: AnswerProviderAttempt[] = [
      { provider: "claude", attempted: true, ok: false, failure: "boom", latencyMs: 5 },
      { provider: "gemini", attempted: true, ok: true, latencyMs: 8 },
    ];
    const b = buildProvenance(
      facts({ sufficiency: "SUFFICIENT", attempts, outcome: { providerUsed: "gemini", webSources: [], webSearchUsed: false } }),
    );
    assert.equal(b.provenanceInput.providerUsed, "gemini", "the real winner");
    assert.equal(b.provenanceInput.sourceClass, "AT24_KNOWLEDGE", "evidence, not provider identity");
  });

  await test("sourceClass is identical whether claude or gemini won (same evidence)", () => {
    const base = { sufficiency: "SUFFICIENT" as Sufficiency, outcome: { webSources: [webSrc()], searchCount: 1, webSearchUsed: true }, webSearchOffered: true };
    const c = buildProvenance(facts({ ...base, outcome: { ...base.outcome, providerUsed: "claude" } }));
    const g = buildProvenance(facts({ ...base, outcome: { ...base.outcome, providerUsed: "gemini" } }));
    assert.equal(c.provenanceInput.sourceClass, g.provenanceInput.sourceClass);
    assert.notEqual(c.provenanceInput.providerUsed, g.provenanceInput.providerUsed);
  });

  // ── failed/abandoned providers never become the evidence source ──────
  await test("abandoned provider's evidence never leaks into the row", () => {
    const attempts: AnswerProviderAttempt[] = [
      { provider: "claude", attempted: true, ok: false, failure: "forbidden-language: Guaranteed Profit", forbiddenLanguage: true },
      { provider: "gemini", attempted: true, ok: true },
    ];
    const b = buildProvenance(
      facts({ attempts, outcome: { providerUsed: "gemini", webSources: [webSrc({ url: "https://gemini-src.example" })], searchCount: 1, webSearchUsed: true }, webSearchOffered: true, sufficiency: "INSUFFICIENT", hits: [{ similarity: 0.1 }] }),
    );
    assert.equal(b.provenanceInput.webContributions.length, 1);
    assert.equal(b.provenanceInput.webContributions[0].url, "https://gemini-src.example");
    assert.equal(b.provenanceInput.providerUsed, "gemini");
    // every attempt still recorded, claude marked not-ok
    assert.equal(b.provenanceInput.providerAttempts.length, 2);
    assert.equal(b.provenanceInput.providerAttempts[0].ok, false);
    assert.equal(b.provenanceInput.turnMeta?.failureCategory, "forbidden-language");
  });

  // ── webSearchFailed ⟂ webSearchRequestedButUnavailable ──────────────
  const g = (o: Partial<Extract<ProvenanceOutcome, { kind: "generated" }>>) =>
    facts({ webSearchOffered: true, gateReason: "dynamic-need", sufficiency: "INSUFFICIENT", hits: [{ similarity: 0.1 }], outcome: o });

  await test("combo: clean web → failed=false, requestedButUnavailable=false", () => {
    const b = buildProvenance(g({ webSources: [webSrc()], searchCount: 1, webSearchUsed: true }));
    assert.equal(b.provenanceInput.turnMeta?.webSearchFailed, false);
    assert.equal(b.provenanceInput.webSearchRequestedButUnavailable, false);
  });
  await test("combo: search errored, not grounded → failed=true, requestedButUnavailable=true", () => {
    const b = buildProvenance(g({ webSources: [], searchCount: 1, webSearchUsed: false, webSearchFailed: true }));
    assert.equal(b.provenanceInput.turnMeta?.webSearchFailed, true);
    assert.equal(b.provenanceInput.webSearchRequestedButUnavailable, true);
  });
  await test("combo: non-web fallback wins a web-required turn → failed=false, requestedButUnavailable=TRUE (C5-a fix)", () => {
    const b = buildProvenance(g({ providerUsed: "gemini", webSources: [], searchCount: 0, webSearchUsed: false, webSearchFailed: false }));
    assert.equal(b.provenanceInput.turnMeta?.webSearchFailed, false, "gemini ran no search — no operational failure");
    assert.equal(b.provenanceInput.webSearchRequestedButUnavailable, true, "but the answer is not web-grounded on a web-required turn");
  });
  await test("combo: 1 search failed + 1 ok, grounded → failed=true, requestedButUnavailable=false", () => {
    const b = buildProvenance(g({ webSources: [webSrc()], searchCount: 2, webSearchUsed: true, webSearchFailed: true, webSearchPartialFailure: true }));
    assert.equal(b.provenanceInput.turnMeta?.webSearchFailed, true);
    assert.equal(b.provenanceInput.turnMeta?.webSearchPartialFailure, true);
    assert.equal(b.provenanceInput.webSearchRequestedButUnavailable, false);
  });

  // ── NO raw content in the row ───────────────────────────────────────
  await test("no raw query / answer / history field anywhere in the row", () => {
    const b = buildProvenance(facts({ hits: [{ content: "KNOWLEDGE-SNIPPET-MARKER: AT24 uses MT5." }] }));
    const json = JSON.stringify(b.provenanceInput);
    // the sanctioned ≤180-char KNOWLEDGE excerpt IS allowed:
    assert.ok(json.includes("KNOWLEDGE-SNIPPET-MARKER"), "knowledge excerpt is the only text permitted");
    // structural: the input type has no such keys
    const keys = Object.keys(b.provenanceInput);
    for (const forbidden of ["message", "query", "answerText", "text", "history", "prompt"]) {
      assert.ok(!keys.includes(forbidden), `row must not carry a '${forbidden}' field`);
    }
  });

  await test("provider failure strings are secret/PII-redacted", () => {
    const attempts: AnswerProviderAttempt[] = [
      { provider: "claude", attempted: true, ok: false, failure: "auth failed for key sk-ant-abcdef1234567890 belonging to bob.smith@example.com card 4111111111111111" },
      { provider: "gemini", attempted: true, ok: true },
    ];
    const b = buildProvenance(facts({ attempts, outcome: { providerUsed: "gemini" } }));
    const f = b.provenanceInput.providerAttempts[0].failure ?? "";
    assert.ok(!/sk-ant-abcdef1234567890/.test(f), "API key redacted");
    assert.ok(!/bob\.smith@example\.com/.test(f), "email redacted");
    assert.ok(!/4111111111111111/.test(f), "card number redacted");
    assert.ok(f.includes("REDACTED"));
  });

  await test("sanitizeProvenanceText: truncates + redacts", () => {
    assert.equal(sanitizeProvenanceText("x".repeat(500)).length, 300);
    assert.ok(sanitizeProvenanceText("token bearer abcdefghijklmnop1234").includes("REDACTED"));
  });

  // ── account-specific → SKIPPED sentinel ─────────────────────────────
  await test("account-specific → retrievalSufficiency 'SKIPPED', no sources, no web", () => {
    const b = buildProvenance(
      facts({
        classification: { intent: "account-specific", privacyClass: "user-specific" },
        skipped: true,
        hits: [],
        outcome: { kind: "deterministic", reason: "account-specific" },
        attempts: [],
      }),
    );
    assert.equal(b.provenanceInput.retrievalSufficiency, "SKIPPED");
    assert.equal(b.provenanceInput.sourceClass, "DETERMINISTIC");
    assert.equal(b.provenanceInput.providerUsed, "deterministic");
    assert.equal(b.provenanceInput.knowledgeContributions.length, 0);
    assert.equal(b.provenanceInput.webContributions.length, 0);
    assert.equal(b.provenanceInput.webSearchUsed, false);
    assert.equal(b.provenanceInput.turnMeta?.failureCategory, null);
  });

  await test("chain-exhausted deterministic → integrityPassed=false, failureCategory 'chain-exhausted'", () => {
    const b = buildProvenance(
      facts({
        outcome: { kind: "deterministic", reason: "chain-exhausted" },
        attempts: [
          { provider: "claude", attempted: true, ok: false, failure: "network" },
          { provider: "gemini", attempted: true, ok: false, failure: "network" },
        ],
        webSearchOffered: true,
      }),
    );
    assert.equal(b.provenanceInput.integrityPassed, false);
    assert.equal(b.provenanceInput.turnMeta?.failureCategory, "chain-exhausted");
    // web was required, deterministic answer is not web-grounded:
    assert.equal(b.provenanceInput.webSearchRequestedButUnavailable, true);
  });

  await test("generated + clean winner → integrityPassed=true", () => {
    const b = buildProvenance(facts({}));
    assert.equal(b.provenanceInput.integrityPassed, true);
  });

  // ── exactly-one write + persistence-failure honesty ─────────────────
  await test("exactly one provenance input per buildProvenance; store 1:1", async () => {
    const store = new InMemoryProvenanceStore();
    const b1 = buildProvenance(facts({}));
    const b2 = buildProvenance(facts({ sufficiency: "INSUFFICIENT", hits: [] }));
    const id1 = await store.write(b1.provenanceInput);
    const id2 = await store.write(b2.provenanceInput);
    assert.equal(store.rows.length, 2);
    assert.equal(typeof id1, "string");
    assert.equal(typeof id2, "string");
  });

  await test("failed persistence → write returns null, no fabricated id", async () => {
    const store = new InMemoryProvenanceStore();
    store.failWrites = true;
    const b = buildProvenance(facts({}));
    const id = await store.write(b.provenanceInput);
    assert.equal(id, null);
    assert.equal(store.rows.length, 1, "the attempt is still recorded");
    // buildProvenance output itself carries no id / success flag
    assert.equal("provenanceId" in b.provenanceInput, false);
    assert.equal("id" in b.provenanceInput, false);
  });

  // ── turnMeta shape ─────────────────────────────────────────────────
  await test("turnMeta carries only primitives (no raw content)", () => {
    const b = buildProvenance(facts({ webSearchOffered: true, gateReason: "dynamic-need" }));
    const m = b.provenanceInput.turnMeta!;
    for (const [k, v] of Object.entries(m)) {
      assert.ok(
        v === null || ["boolean", "number", "string"].includes(typeof v),
        `turnMeta.${k} must be a primitive, got ${typeof v}`,
      );
    }
    assert.equal(m.gateReason, "dynamic-need");
    assert.equal(m.knowledgeHitCount, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
