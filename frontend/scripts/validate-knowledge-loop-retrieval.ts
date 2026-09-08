// scripts/validate-knowledge-loop-retrieval.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop, K1-E: retrieval-readiness +
// INV-1 proof. Offline — InMemoryKnowledgeBackend + FakeEmbedder, ZERO DB,
// ZERO Gemini (K1_DECISION §8).
//
// Run: npm run validate:knowledge-loop-retrieval
//
// Proves K1_DECISION acceptance criteria A-3..A-11 + INV-1 obligation 2:
//   pipeline · threshold · scope isolation · status filtering · supersede
//   de-dup · freshness · authority weighting · user-scope no-leak · version
//   fingerprint · and — the invariant — a rejected / pending candidate whose
//   text trivially matches the query returns ZERO hits, and no candidate
//   content is ever embedded into the retrievable corpus.

import assert from "node:assert/strict";

import {
  InMemoryKnowledgeBackend,
  FakeEmbedder,
} from "../services/knowledge-loop/knowledge/in-memory-backend";
import { KnowledgeService } from "../services/knowledge-loop/knowledge/knowledge-service";
import type { SeedKnowledge } from "../services/knowledge-loop/knowledge/in-memory-backend";
import type {
  RetrievalOptions,
  CreateKnowledgeInput,
} from "../types/knowledge-loop";
import {
  authorityWeightFor,
  isPeriodicStale,
  normalizeQuery,
} from "../services/knowledge-loop/knowledge/retrieval";

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
    console.error(
      err instanceof Error ? `    ${err.stack ?? err.message}` : `    ${String(err)}`,
    );
  }
}

const embed = new FakeEmbedder();
const NOW = new Date("2026-09-09T00:00:00.000Z");

function provenance() {
  return {
    origin: "admin-authored" as const,
    createdBy: "admin1",
    createdAt: NOW.toISOString(),
  };
}

function baseSeed(over: Partial<SeedKnowledge> & { chunks: string[] }): SeedKnowledge {
  return {
    userId: "sys",
    title: "t",
    knowledgeType: "platform",
    scope: "assistant",
    visibility: "public",
    source: "admin",
    sourceType: "admin_authored",
    provenance: provenance(),
    freshnessClass: "STATIC",
    lifecycleStatus: "active",
    approvedAt: NOW,
    ...over,
  };
}

function opts(over: Partial<RetrievalOptions> = {}): RetrievalOptions {
  return {
    callerUserId: "u1",
    callerRole: "customer",
    scopes: ["assistant", "shared"],
    includeUserScope: true,
    ...over,
  };
}

function svc(backend: InMemoryKnowledgeBackend): KnowledgeService {
  return new KnowledgeService({
    store: backend,
    vectors: backend,
    embed,
    clock: () => NOW,
  });
}

const createInput = (over: Partial<CreateKnowledgeInput> = {}): CreateKnowledgeInput => ({
  userId: "sys",
  title: "t",
  knowledgeType: "platform",
  scope: "assistant",
  visibility: "public",
  source: "admin",
  sourceType: "admin_authored",
  provenance: provenance(),
  freshnessClass: "STATIC",
  ...over,
});

async function main(): Promise<void> {
  console.log("\nK1 - Knowledge Loop retrieval readiness + INV-1\n");

  // ── pure helpers ────────────────────────────────────────────────────
  await test("normalizeQuery: trims, collapses whitespace, rejects empty", () => {
    assert.deepEqual(normalizeQuery("  hello   world  "), {
      normalized: "hello world",
      lower: "hello world",
    });
    assert.equal(normalizeQuery("   "), null);
    assert.equal(normalizeQuery(""), null);
  });

  await test("authorityWeightFor: policy → 1.0, user scope → 0.5, sourceType table", () => {
    assert.equal(
      authorityWeightFor({ scope: "assistant", knowledgeType: "policy", sourceType: "verified_qa" } as never),
      1.0,
    );
    assert.equal(
      authorityWeightFor({ scope: "user", knowledgeType: "faq", sourceType: "verified_qa" } as never),
      0.5,
    );
    assert.equal(
      authorityWeightFor({ scope: "assistant", knowledgeType: "faq", sourceType: "web_researched" } as never),
      0.75,
    );
  });

  await test("isPeriodicStale: PERIODIC past review-due is stale; STATIC never", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    assert.equal(
      isPeriodicStale(
        { freshnessClass: "PERIODIC", freshnessReviewEveryDays: 30, lastReviewedAt: old, approvedAt: old, createdAt: old } as never,
        NOW,
      ),
      true,
    );
    assert.equal(
      isPeriodicStale(
        { freshnessClass: "STATIC", lastReviewedAt: old, approvedAt: old, createdAt: old } as never,
        NOW,
      ),
      false,
    );
  });

  // ── pipeline: a matching active row is retrieved ────────────────────
  await test("pipeline: a matching active assistant row is retrieved with a context block", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(
      baseSeed({ chunks: ["To reset your workspace layout open Settings then Workspace then Reset."] }),
      embed,
    );
    const r = await svc(b).retrieve("how do I reset my workspace layout", opts());
    assert.equal(r.reason, "ok");
    assert.ok(r.hits.length >= 1);
    assert.ok(r.contextBlock.includes("reset"));
    assert.ok(r.bestSimilarity >= 0.3);
    assert.ok(["SUFFICIENT", "LOW"].includes(r.sufficiency));
  });

  // ── threshold ──────────────────────────────────────────────────────
  await test("threshold: an unrelated query returns 0 hits (INSUFFICIENT / below-threshold)", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(baseSeed({ chunks: ["Bananas are yellow and grow in bunches."] }), embed);
    const r = await svc(b).retrieve("quantum chromodynamics lattice gauge theory", opts());
    assert.equal(r.hits.length, 0);
    assert.equal(r.sufficiency, "INSUFFICIENT");
  });

  await test("empty query → INSUFFICIENT reason=empty-query; embedding failure → embedding-failed", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const r1 = await svc(b).retrieve("   ", opts());
    assert.equal(r1.reason, "empty-query");
    const failing = new KnowledgeService({
      store: b,
      vectors: b,
      embed: { embed: async () => { throw new Error("gemini down"); } },
      clock: () => NOW,
    });
    await b.seed(baseSeed({ chunks: ["anything"] }), embed);
    const r2 = await failing.retrieve("real question here", opts());
    assert.equal(r2.reason, "embedding-failed");
    assert.equal(r2.sufficiency, "INSUFFICIENT");
  });

  // ── scope isolation ────────────────────────────────────────────────
  await test("scope isolation: assistant query does NOT return support-only rows; shared is visible to both", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const text = "The gizmo widget calibration procedure requires three steps.";
    await b.seed(baseSeed({ scope: "support", chunks: [text] }), embed);
    await b.seed(baseSeed({ scope: "shared", chunks: [text + " Shared copy."] }), embed);

    const asAssistant = await svc(b).retrieve("gizmo widget calibration procedure steps", opts({ scopes: ["assistant", "shared"] }));
    assert.ok(asAssistant.hits.every((h) => h.scope !== "support"), "support row leaked to assistant scope");
    assert.ok(asAssistant.hits.some((h) => h.scope === "shared"), "shared row not visible to assistant");

    const asSupport = await svc(b).retrieve("gizmo widget calibration procedure steps", opts({ scopes: ["support", "shared"] }));
    assert.ok(asSupport.hits.some((h) => h.scope === "support"));
    assert.ok(asSupport.hits.some((h) => h.scope === "shared"));
  });

  // ── status filtering ───────────────────────────────────────────────
  await test("status filtering: draft / deprecated / archived are NEVER returned", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const text = "Zorptext frobnicator manual override sequence delta seven.";
    for (const st of ["draft", "deprecated", "archived"] as const) {
      await b.seed(baseSeed({ lifecycleStatus: st, chunks: [text] }), embed);
    }
    const r = await svc(b).retrieve("zorptext frobnicator manual override sequence", opts());
    assert.equal(r.hits.length, 0, "a non-active row was returned");
  });

  // ── supersede de-dup ───────────────────────────────────────────────
  await test("supersede: only the current version of a chain is returned", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const text = "The plooble threshold for a snarf account is exactly 42 credits.";
    const v1 = await b.seed(baseSeed({ id: "kv1", canonicalAnswer: "42 credits", chunks: [text] }), embed);
    // publish v2 (in-memory createVersionOf) — but it needs its own chunks; seed then link
    const v2 = await b.seed(
      baseSeed({ id: "kv2", version: 2, supersedesId: v1.id, canonicalAnswer: "50 credits", chunks: [text.replace("42", "50")] }),
      embed,
    );
    // mark v1 superseded/deprecated (what createVersionOf does)
    await b.transition({ id: v1.id, to: "deprecated", actorId: "admin1", patch: { supersededById: v2.id } });

    const r = await svc(b).retrieve("plooble threshold snarf account credits", opts());
    assert.ok(r.hits.length >= 1);
    assert.ok(r.hits.every((h) => h.knowledgeId === "kv2"), "a superseded version was returned");
  });

  // ── freshness ──────────────────────────────────────────────────────
  await test("freshness: DYNAMIC past expiresAt is excluded; PERIODIC past review-due is penalised (stale)", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const text = "The current promotional flimflam price is nineteen dollars.";
    await b.seed(
      baseSeed({ freshnessClass: "DYNAMIC", expiresAt: new Date("2026-08-01T00:00:00Z"), chunks: [text] }),
      embed,
    );
    const expired = await svc(b).retrieve("current promotional flimflam price", opts());
    assert.equal(expired.hits.length, 0, "an expired DYNAMIC row was returned");

    const b2 = new InMemoryKnowledgeBackend(() => NOW);
    await b2.seed(
      baseSeed({
        freshnessClass: "PERIODIC",
        freshnessReviewEveryDays: 30,
        lastReviewedAt: new Date("2026-01-01T00:00:00Z"),
        chunks: ["The wibble policy allows two transfers per month."],
      }),
      embed,
    );
    const stalePeriodic = await svc(b2).retrieve("wibble policy transfers per month", opts());
    assert.ok(stalePeriodic.hits.length >= 1);
    assert.equal(stalePeriodic.hits[0].stale, true, "review-due PERIODIC row not flagged stale");
  });

  // ── authority weighting order ──────────────────────────────────────
  await test("authority weighting: admin_authored outranks web_researched at near-equal similarity", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    // near-identical (so both survive text de-dup) but same token bag → same
    // cosine to the query; only authorityWeight separates them.
    await b.seed(
      baseSeed({ id: "kadmin", sourceType: "admin_authored", chunks: ["kerfuffle module concurrent sessions four supported"] }),
      embed,
    );
    await b.seed(
      baseSeed({ id: "kweb", sourceType: "web_researched", chunks: ["concurrent kerfuffle sessions module supported four"] }),
      embed,
    );
    const r = await svc(b).retrieve("kerfuffle module concurrent sessions supported four", opts());
    assert.ok(r.hits.length >= 2, `expected 2 hits, got ${r.hits.length}`);
    assert.equal(r.hits[0].knowledgeId, "kadmin", "web row outranked the admin row");
    assert.ok(r.hits[0].finalScore >= r.hits[1].finalScore);
  });

  // ── user-scope no-leak ─────────────────────────────────────────────
  await test("user-scope: a scope=user row is returned to its owner, NEVER to another user", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const text = "My private note: the vault code is stored under the mattress metaphor.";
    await b.seed(
      baseSeed({ scope: "user", userId: "owner", lifecycleStatus: null, visibility: "customer", chunks: [text] }),
      embed,
    );
    const asOwner = await svc(b).retrieve("private note vault code mattress", opts({ callerUserId: "owner" }));
    assert.ok(asOwner.hits.some((h) => h.unverified === true), "owner cannot see own scope=user row");

    const asOther = await svc(b).retrieve("private note vault code mattress", opts({ callerUserId: "intruder" }));
    assert.equal(asOther.hits.length, 0, "scope=user row leaked to another user");

    const excluded = await svc(b).retrieve(
      "private note vault code mattress",
      opts({ callerUserId: "owner", includeUserScope: false }),
    );
    assert.equal(excluded.hits.length, 0, "includeUserScope:false still returned a user row");
  });

  // ── version fingerprint ────────────────────────────────────────────
  await test("version fingerprint: increments on markActive / deprecate / archive / reinstate / newVersion", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const s = svc(b);
    const k = await b.seed(baseSeed({ lifecycleStatus: "draft", chunks: ["x"] }), embed);
    const f0 = Number(await b.getVersionFingerprint());
    const a = await s.markActive(k.id, "admin1");
    assert.equal(Number(a.versionFingerprint), f0 + 1);
    const d = await s.deprecate(k.id, "admin1");
    assert.equal(Number(d.versionFingerprint), f0 + 2);
    const ar = await s.archive(k.id, "admin1");
    assert.equal(Number(ar.versionFingerprint), f0 + 3);
    const re = await s.reinstate(k.id, "admin1");
    assert.equal(Number(re.versionFingerprint), f0 + 4);
    const nv = await s.newVersion(k.id, createInput({ userId: "admin1" }));
    assert.equal(Number(nv.versionFingerprint), f0 + 5);
    assert.equal(nv.deprecated.supersededById, nv.created.id);
    assert.equal(nv.created.version, k.version + 1);
  });

  // ── INV-1 — the invariant ──────────────────────────────────────────
  await test("INV-1: a rejected candidate whose text trivially matches the query returns ZERO hits", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seedCandidate({
      id: "cand_rejected",
      canonicalQuestion: "what is the snorkel diffusion coefficient",
      proposedAnswer: "The snorkel diffusion coefficient is 3.7 blorks per fathom.",
      status: "rejected",
    });
    await b.seedCandidate({
      id: "cand_pending",
      canonicalQuestion: "what is the snorkel diffusion coefficient",
      proposedAnswer: "The snorkel diffusion coefficient is 3.7 blorks per fathom.",
      status: "candidate",
    });
    const s = svc(b);
    const r = await s.retrieve("snorkel diffusion coefficient blorks per fathom", opts());
    assert.equal(r.hits.length, 0, "candidate content was retrieved");
    assert.equal(r.contextBlock, "");
    // and no candidate content is in the chunk corpus at all
    const allChunks = await b.getChunks(
      (await b.list({ includeDeleted: true })).map((k) => k.id),
    );
    assert.ok(
      allChunks.every((c) => !c.content.includes("blorks per fathom")),
      "candidate answer text leaked into KnowledgeChunk",
    );
    assert.deepEqual((await b.listCandidateIds()).sort(), ["cand_pending", "cand_rejected"]);
  });

  await test("INV-1: after an approved candidate becomes active Knowledge + is ingested, it IS retrievable", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    // simulate Governance.approve() (K4): create a draft Knowledge FROM the
    // candidate, then markActive + ingest (K1-D publishKnowledge does this).
    const k = await b.seed(
      baseSeed({
        lifecycleStatus: "draft",
        source: "candidate:cand_ok",
        sourceType: "verified_qa",
        knowledgeType: "faq",
        canonicalQuestion: "what is the wobble constant",
        canonicalAnswer: "The wobble constant is 12 grondles.",
        chunks: ["The wobble constant is 12 grondles per tick."],
      }),
      embed,
    );
    const s = svc(b);
    const before = await s.retrieve("wobble constant grondles per tick", opts());
    assert.equal(before.hits.length, 0, "a draft row was retrievable");
    await s.markActive(k.id, "admin1", 0.9);
    const after = await s.retrieve("wobble constant grondles per tick", opts());
    assert.ok(after.hits.some((h) => h.knowledgeId === k.id), "approved+active row not retrievable");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
