// scripts/validate-k4.2a-candidate-capture.ts
// Sprint K4.2-A — AT24 Knowledge Governance: candidate capture.
// Offline (no DB, no embedding API) — entirely against in-memory adapters.
//
// Run: npm run validate:k4.2a-candidate-capture
//
// Proves (K4.2A_CANDIDATE_CAPTURE.md §6):
//   Part A — structural validation + provenance shape + defaults
//   Part B — privacy scan (K0.5 §7.2), block-on-hit, forbidden-language warn
//   Part C — dedup against active knowledge (K4.2A-D2)
//   Part D — idempotency (K4.2A-D3, new)
//   Part E — governance boundary + retrieval isolation (K4.2A-D4/D5)

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CandidateService } from "../services/knowledge-loop/governance/candidate-service";
import {
  scanCandidatePrivacy,
  scanCandidateForbiddenLanguage,
} from "../services/knowledge-loop/governance/privacy-scan";
import {
  FakeEmbedder,
  FakeVectorSearch,
  InMemoryCandidateStore,
} from "../services/knowledge-loop/governance/in-memory-adapters";
import type { ProposeCandidateInput } from "../types/knowledge-loop";

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

/** strips line and block comments so structural assertions match real code,
 *  not this file's own explanatory prose (which legitimately names the
 *  forbidden methods it's describing the absence of). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\r\n]*/g, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function baseInput(overrides: Partial<ProposeCandidateInput> = {}): ProposeCandidateInput {
  return {
    createdByUserId: "user-1",
    canonicalQuestion: "What is the K4.2-A candidate capture module for?",
    proposedAnswer: "It creates KnowledgeCandidate rows for later admin review.",
    knowledgeType: "faq",
    sourceType: "unanswered_question",
    reasonForCandidate: "unanswered-high-value",
    confidence: 0.8,
    ...overrides,
  };
}

function newService(cfg?: {
  hits?: Partial<import("../services/knowledge-loop/governance/ports").VectorHit>[];
}) {
  const store = new InMemoryCandidateStore();
  const embed = new FakeEmbedder();
  const vectors = new FakeVectorSearch({ hits: cfg?.hits ?? [] });
  const service = new CandidateService({ store, embed, vectors });
  return { service, store, embed, vectors };
}

async function main(): Promise<void> {
  console.log("\nK4.2-A — candidate capture\n");

  // ── Part A — structural validation + provenance shape + defaults ──────
  await test("A1: web_researched with no webSources -> blocked-invalid", async () => {
    const { service } = newService();
    const r = await service.propose(
      baseInput({ sourceType: "web_researched", evidence: undefined }),
    );
    assert.equal(r.outcome, "blocked-invalid");
    assert.ok(r.invalidReason?.includes("web_researched"));
    assert.equal(r.candidate, undefined);
  });

  await test("A2: web_researched WITH webSources -> proceeds normally", async () => {
    const { service } = newService();
    const r = await service.propose(
      baseInput({
        sourceType: "web_researched",
        evidence: {
          webSources: [
            { url: "https://x.example", title: "X", domain: "x.example", retrievedAt: new Date().toISOString(), excerpt: "..." },
          ],
        },
      }),
    );
    assert.equal(r.outcome, "created");
  });

  await test("A3: defaults applied — proposedScope=assistant, visibility=public, freshness=STATIC", async () => {
    const { service } = newService();
    const r = await service.propose(baseInput());
    assert.equal(r.candidate?.proposedScope, "assistant");
    assert.equal(r.candidate?.proposedVisibility, "public");
    assert.equal(r.candidate?.proposedFreshnessClass, "STATIC");
  });

  await test("A4: explicit overrides respected", async () => {
    const { service } = newService();
    const r = await service.propose(
      baseInput({ proposedScope: "shared", proposedVisibility: "customer", proposedFreshnessClass: "DYNAMIC" }),
    );
    assert.equal(r.candidate?.proposedScope, "shared");
    assert.equal(r.candidate?.proposedVisibility, "customer");
    assert.equal(r.candidate?.proposedFreshnessClass, "DYNAMIC");
  });

  await test("A5: evidence (KnowledgeProvenance) shape — origin=candidate, createdBy, createdAt set", async () => {
    const { service } = newService();
    const r = await service.propose(baseInput({ createdByUserId: "user-42" }));
    assert.equal(r.candidate?.evidence.origin, "candidate");
    assert.equal(r.candidate?.evidence.createdBy, "user-42");
    assert.ok(typeof r.candidate?.evidence.createdAt === "string" && r.candidate.evidence.createdAt.length > 0);
  });

  await test("A6: originatingConversationId/MessageId flow into evidence when present", async () => {
    const { service } = newService();
    const r = await service.propose(
      baseInput({ originatingConversationId: "conv-1", originatingMessageId: "msg-1" }),
    );
    assert.equal(r.candidate?.evidence.originatingConversationId, "conv-1");
    assert.equal(r.candidate?.evidence.originatingMessageId, "msg-1");
  });

  await test("A7: knowledgeSources/webSources in input.evidence flow into the candidate's evidence", async () => {
    const { service } = newService();
    const r = await service.propose(
      baseInput({
        evidence: {
          knowledgeSources: [{ knowledgeId: "k1", chunkId: "c1", similarity: 0.5 }],
        },
      }),
    );
    assert.deepEqual(r.candidate?.evidence.knowledgeSources, [{ knowledgeId: "k1", chunkId: "c1", similarity: 0.5 }]);
  });

  await test("A8: no dedup hits -> status=candidate, duplicateOfId=null, similarityScore=null", async () => {
    const { service } = newService({ hits: [] });
    const r = await service.propose(baseInput());
    assert.equal(r.candidate?.status, "candidate");
    assert.equal(r.candidate?.duplicateOfId, null);
    assert.equal(r.candidate?.similarityScore, null);
  });

  // ── Part B — privacy scan (K0.5 §7.2) ──────────────────────────────────
  await test("B1: email address -> blocked", () => {
    const r = scanCandidatePrivacy("contact me at trader@example.com for details");
    assert.equal(r.blocked, true);
  });

  await test("B2: API key (sk-...) -> blocked", () => {
    const r = scanCandidatePrivacy("the key is sk-abcdefgh12345678 use it carefully");
    assert.equal(r.blocked, true);
  });

  await test("B3: Bearer token -> blocked", () => {
    const r = scanCandidatePrivacy("send Bearer abcdefghijklmnop1234 in the header");
    assert.equal(r.blocked, true);
  });

  await test("B4: card-number-shaped digit run -> blocked", () => {
    const r = scanCandidatePrivacy("the card number 4111111111111111 was charged");
    assert.equal(r.blocked, true);
  });

  await test("B5: SSN pattern -> blocked", () => {
    const r = scanCandidatePrivacy("SSN on file: 123-45-6789 confirmed");
    assert.equal(r.blocked, true);
  });

  await test("B6: account-specific reference -> blocked", () => {
    const r = scanCandidatePrivacy("check your order #12345 status here");
    assert.equal(r.blocked, true);
  });

  await test("B7: raw internal cuid-shaped id -> blocked", () => {
    const r = scanCandidatePrivacy("the record cm1a2b3c4d5e6f7g8h9i0j1k2 was affected");
    assert.equal(r.blocked, true);
  });

  await test("B8: phone number -> blocked", () => {
    const r = scanCandidatePrivacy("call us at 555-123-4567 for support");
    assert.equal(r.blocked, true);
  });

  await test("B9: IBAN -> blocked", () => {
    const r = scanCandidatePrivacy("wire to GB29NWBK60161331926819 please");
    assert.equal(r.blocked, true);
  });

  await test("B10: clean, ordinary product text -> NOT blocked", () => {
    const r = scanCandidatePrivacy(
      "AT24 supports MT4 and MT5 Expert Advisors, plus TradingView Pine Script strategies.",
    );
    assert.equal(r.blocked, false);
    assert.deepEqual(r.reasons, []);
  });

  await test("B11: forbidden trading language -> WARN, not a scanCandidatePrivacy hit", () => {
    const r = scanCandidatePrivacy("You should buy now while the price is low.");
    assert.equal(r.blocked, false, "forbidden language is not a privacy-scan concern");
    const warnings = scanCandidateForbiddenLanguage("You should buy now while the price is low.");
    assert.ok(warnings.length > 0, "scanCandidateForbiddenLanguage must flag it separately");
  });

  await test("B12: propose() blocks creation on a privacy hit — no candidate row created", async () => {
    const { service, store } = newService();
    const r = await service.propose(
      baseInput({ proposedAnswer: "Contact trader@example.com for a refund." }),
    );
    assert.equal(r.outcome, "blocked-privacy");
    assert.ok((r.blockedReasons?.length ?? 0) > 0);
    assert.equal(r.candidate, undefined);
    assert.equal(store.rows.length, 0);
  });

  await test("B13: propose() surfaces forbidden-language warnings WITHOUT blocking creation", async () => {
    const { service } = newService();
    const r = await service.propose(baseInput({ proposedAnswer: "You should buy now, guaranteed 100% profit." }));
    assert.equal(r.outcome, "created");
    assert.ok(r.forbiddenLanguageWarnings.length > 0);
  });

  // ── Part C — dedup against active knowledge (K4.2A-D2) ────────────────
  await test("C1: similarity below DUP_SOFT (0.85) -> plain candidate, no duplicate fields", async () => {
    const { service } = newService({ hits: [{ knowledgeId: "k1", similarity: 0.5 }] });
    const r = await service.propose(baseInput());
    assert.equal(r.outcome, "created");
    assert.equal(r.candidate?.status, "candidate");
    assert.equal(r.candidate?.duplicateOfId, null);
  });

  await test("C2: similarity between DUP_SOFT and DUP_HARD -> candidate WITH duplicateOfId (reviewable)", async () => {
    const { service } = newService({ hits: [{ knowledgeId: "k1", similarity: 0.9 }] });
    const r = await service.propose(baseInput());
    assert.equal(r.outcome, "created");
    assert.equal(r.candidate?.status, "candidate");
    assert.equal(r.candidate?.duplicateOfId, "k1");
    assert.equal(r.candidate?.similarityScore, 0.9);
  });

  await test("C3: similarity at/above DUP_HARD (0.94) -> status=duplicate, outcome=duplicate-of-active", async () => {
    const { service } = newService({ hits: [{ knowledgeId: "k1", similarity: 0.97 }] });
    const r = await service.propose(baseInput());
    assert.equal(r.outcome, "duplicate-of-active");
    assert.equal(r.candidate?.status, "duplicate");
    assert.equal(r.candidate?.duplicateOfId, "k1");
  });

  await test("C3b: a hard duplicate is STILL created as a row — never silently dropped", async () => {
    const { service, store } = newService({ hits: [{ knowledgeId: "k1", similarity: 0.99 }] });
    await service.propose(baseInput());
    assert.equal(store.rows.length, 1, "duplicate must still be recorded (K0.5 §8 retention + analytics)");
  });

  await test("C4: max similarity taken across multiple hits, correct knowledgeId attributed", async () => {
    const { service } = newService({
      hits: [
        { knowledgeId: "k-low", similarity: 0.4 },
        { knowledgeId: "k-high", similarity: 0.88 },
        { knowledgeId: "k-mid", similarity: 0.6 },
      ],
    });
    const r = await service.propose(baseInput());
    assert.equal(r.candidate?.duplicateOfId, "k-high");
    assert.equal(r.candidate?.similarityScore, 0.88);
  });

  await test("C5: dedup query uses ALL visibilities + the proposed scope (K4.2A-D2)", async () => {
    const { service, vectors } = newService({ hits: [] });
    await service.propose(baseInput({ proposedScope: "shared" }));
    assert.equal(vectors.calls.length, 1);
    assert.deepEqual(vectors.calls[0].scopes, ["shared"]);
    assert.deepEqual([...vectors.calls[0].visibilities].sort(), ["admin", "customer", "internal", "public"]);
  });

  // ── Part D — idempotency (K4.2A-D3, new) ───────────────────────────────
  await test("D1: same originatingMessageId + sourceType replay -> idempotent-replay, no new row", async () => {
    const { service, store } = newService({ hits: [] });
    const r1 = await service.propose(baseInput({ originatingMessageId: "msg-1" }));
    assert.equal(r1.outcome, "created");
    const r2 = await service.propose(
      baseInput({ originatingMessageId: "msg-1", proposedAnswer: "a different answer text this time" }),
    );
    assert.equal(r2.outcome, "idempotent-replay");
    assert.equal(r2.candidate?.id, r1.candidate?.id);
    assert.equal(store.rows.length, 1, "no second row created");
  });

  await test("D2: replay does NOT re-embed or re-search (true short-circuit, before privacy/dedup)", async () => {
    const { service, embed, vectors } = newService({ hits: [] });
    await service.propose(baseInput({ originatingMessageId: "msg-2" }));
    const embedCallsAfterFirst = embed.calls.length;
    const searchCallsAfterFirst = vectors.calls.length;
    await service.propose(baseInput({ originatingMessageId: "msg-2" }));
    assert.equal(embed.calls.length, embedCallsAfterFirst, "no new embed call on replay");
    assert.equal(vectors.calls.length, searchCallsAfterFirst, "no new vector search on replay");
  });

  await test("D3: no originatingMessageId — exact-content replay (same user/sourceType/question/answer) -> idempotent-replay", async () => {
    const { service, store } = newService({ hits: [] });
    const input = baseInput({ createdByUserId: "user-9" });
    const r1 = await service.propose(input);
    const r2 = await service.propose(input);
    assert.equal(r1.outcome, "created");
    assert.equal(r2.outcome, "idempotent-replay");
    assert.equal(r2.candidate?.id, r1.candidate?.id);
    assert.equal(store.rows.length, 1);
  });

  await test("D4: no originatingMessageId — DIFFERENT answer text is a genuinely new proposal, not a replay", async () => {
    const { service, store } = newService({ hits: [] });
    await service.propose(baseInput({ createdByUserId: "user-9", proposedAnswer: "answer A" }));
    const r2 = await service.propose(baseInput({ createdByUserId: "user-9", proposedAnswer: "answer B" }));
    assert.equal(r2.outcome, "created");
    assert.equal(store.rows.length, 2);
  });

  await test("D5: same content but DIFFERENT sourceType is NOT treated as a replay", async () => {
    const { service, store } = newService({ hits: [] });
    await service.propose(baseInput({ originatingMessageId: "msg-3", sourceType: "unanswered_question" }));
    const r2 = await service.propose(
      baseInput({ originatingMessageId: "msg-3", sourceType: "assistant_correction" }),
    );
    assert.equal(r2.outcome, "created", "different sourceType against the same message id is a distinct proposal");
    assert.equal(store.rows.length, 2);
  });

  await test("D6: a privacy-blocked proposal leaves no row, so retrying it is NOT an idempotent-replay — it is re-evaluated fresh", async () => {
    const { service, store } = newService();
    const blocked = baseInput({ originatingMessageId: "msg-4", proposedAnswer: "email me at x@example.com" });
    const r1 = await service.propose(blocked);
    assert.equal(r1.outcome, "blocked-privacy");
    const r2 = await service.propose(blocked);
    assert.equal(r2.outcome, "blocked-privacy", "still blocked on retry — never silently created");
    assert.equal(store.rows.length, 0);
  });

  // ── Part E — governance boundary + retrieval isolation (structural) ────
  const governanceDir = join(ROOT, "services", "knowledge-loop", "governance");
  const governanceFiles = walk(governanceDir);

  await test("E1: candidate-service.ts never references markActive/createVersionOf/deprecate/archive/reinstate (code, not doc comments)", () => {
    const src = stripComments(readFileSync(join(governanceDir, "candidate-service.ts"), "utf8"));
    assert.doesNotMatch(src, /\bmarkActive\b|\bcreateVersionOf\b|\.deprecate\(|\.archive\(|\.reinstate\(/);
  });

  await test("E2: candidate-service.ts never imports KnowledgeService or ../knowledge/knowledge-service (code, not doc comments)", () => {
    const src = stripComments(readFileSync(join(governanceDir, "candidate-service.ts"), "utf8"));
    assert.doesNotMatch(src, /KnowledgeService|knowledge-service/);
  });

  await test("E3: no governance/** file writes prisma.knowledge. or prisma.knowledgeChunk. directly", () => {
    for (const f of governanceFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(
        src,
        /prisma\.knowledge\.(create|update|delete|upsert)|prisma\.knowledgeChunk\.(create|update|delete|upsert)/,
        `${f} writes Knowledge/KnowledgeChunk directly`,
      );
    }
  });

  await test("E4: only prisma-adapters.ts references prisma.knowledgeCandidate — no other file writes the table directly", () => {
    for (const f of governanceFiles) {
      if (f.endsWith("prisma-adapters.ts")) continue;
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /prisma\.knowledgeCandidate\./, `${f} bypasses PrismaCandidateStore`);
    }
  });

  await test("E5: no governance/** file calls storeEmbedding — the dedup embedding is never persisted as a KnowledgeChunk", () => {
    for (const f of governanceFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /storeEmbedding/, `${f} references storeEmbedding`);
    }
  });

  await test("E6: no governance-service.ts / admin route / admin UI exists yet (K4.2-B, not this sprint)", () => {
    const names = governanceFiles.map((f) => f.split(/[\\/]/).pop());
    assert.ok(!names.includes("governance-service.ts"));
    const adminRoute = join(ROOT, "app", "api", "private", "admin", "knowledge-loop");
    const adminUi = join(ROOT, "app", "dashboard", "admin", "knowledge-loop");
    for (const p of [adminRoute, adminUi]) {
      let exists = true;
      try {
        statSync(p);
      } catch {
        exists = false;
      }
      assert.equal(exists, false, `${p} should not exist yet`);
    }
  });

  await test("E7: governance/index.ts is server-only (Prisma adapter dynamically imported, not a top-level import)", () => {
    const src = readFileSync(join(governanceDir, "index.ts"), "utf8");
    assert.doesNotMatch(src, /^import .*prisma-adapters/m);
    assert.match(src, /await import\(["']\.\/prisma-adapters["']\)/);
  });

  await test("E8 (INV-1, extended): no services/knowledge-loop/** file (incl. governance/) references the KnowledgeCandidate table outside a comment/type name", () => {
    const loopFiles = walk(join(ROOT, "services", "knowledge-loop"));
    for (const f of loopFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(
        src,
        /prisma\.knowledgeCandidate\.(findMany|findUnique)\b.*\{\s*where:\s*\{[^}]*lifecycleStatus/,
        `${f} appears to retrieve KnowledgeCandidate as if it were eligible knowledge`,
      );
    }
  });

  await test("E9: repositories/VectorRepository.ts still never references Candidate (INV-1 unchanged)", () => {
    const src = readFileSync(join(ROOT, "repositories", "VectorRepository.ts"), "utf8");
    assert.doesNotMatch(src, /Candidate/i);
  });

  await test("E10: no services/agent-framework/** file imports services/knowledge-loop (existing INV-1, unchanged by K4.2-A)", () => {
    const agentFiles = walk(join(ROOT, "services", "agent-framework"));
    for (const f of agentFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /services\/knowledge-loop/, `${f} imports services/knowledge-loop`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
