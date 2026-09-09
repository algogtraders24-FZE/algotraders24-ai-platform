// scripts/validate-knowledge-loop-freshness.ts
// Sprint K2-C — AT24 AI Assistant Knowledge Loop: freshness sweep.
// Offline — InMemoryKnowledgeBackend + FakeEmbedder. ZERO DB, ZERO Gemini.
//
// Run: npm run validate:knowledge-loop-freshness
//
// Proves KNOWLEDGE_CONTRACT.md §5 + transition table §4.4:
//   - fresh knowledge is untouched
//   - PERIODIC past review-due is FLAGGED, never auto-deprecated
//   - DYNAMIC past `expiresAt` is auto-deprecated (reason `expired`) and the
//     version fingerprint is bumped
//   - missing expiry / deprecated / superseded rows are handled safely
//   - the sweep NEVER touches KnowledgeCandidate, NEVER transitions to active
//   - a swept-deprecated row is then ineligible for retrieval (INV-1 preserved)

import assert from "node:assert/strict";

import {
  InMemoryKnowledgeBackend,
  FakeEmbedder,
} from "../services/knowledge-loop/knowledge/in-memory-backend";
import {
  runFreshnessSweep,
  FRESHNESS_SWEEP_ACTOR,
} from "../services/knowledge-loop/knowledge/freshness-sweep";
import { KnowledgeService } from "../services/knowledge-loop/knowledge/knowledge-service";
import type { SeedKnowledge } from "../services/knowledge-loop/knowledge/in-memory-backend";

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

const NOW = new Date("2026-09-09T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const prov = () => ({ origin: "admin-authored" as const, createdBy: "a", createdAt: NOW.toISOString() });
const embed = new FakeEmbedder();

function seed(over: Partial<SeedKnowledge> & { chunks?: string[] }): SeedKnowledge {
  return {
    userId: "sys", title: "t", knowledgeType: "faq", scope: "assistant",
    visibility: "public", source: "admin", sourceType: "admin_authored",
    provenance: prov(), freshnessClass: "STATIC", lifecycleStatus: "active",
    approvedAt: NOW, chunks: over.chunks ?? ["content"], ...over,
  };
}

async function main(): Promise<void> {
  console.log("\nK2-C - Knowledge Loop freshness sweep\n");

  await test("STATIC + fresh PERIODIC + within-window DYNAMIC are all left untouched", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(seed({ id: "static1", freshnessClass: "STATIC" }), embed);
    await b.seed(seed({ id: "periodicFresh", freshnessClass: "PERIODIC", freshnessReviewEveryDays: 90, lastReviewedAt: daysAgo(10) }), embed);
    await b.seed(seed({ id: "dynFuture", freshnessClass: "DYNAMIC", expiresAt: new Date(NOW.getTime() + 60_000) }), embed);
    const fp0 = await b.getVersionFingerprint();
    const r = await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.equal(r.scannedActive, 3);
    assert.equal(r.dynamicExpiredDeprecated.length, 0);
    assert.equal(r.periodicReviewDue.length, 0);
    assert.equal(r.versionFingerprint, fp0, "no transition → fingerprint unchanged");
    for (const id of ["static1", "periodicFresh", "dynFuture"]) {
      assert.equal((await b.getById(id))!.lifecycleStatus, "active");
    }
  });

  await test("PERIODIC past review-due → FLAGGED only (still active, retrieval demotes it at query time)", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(seed({ id: "pd", freshnessClass: "PERIODIC", freshnessReviewEveryDays: 30, lastReviewedAt: daysAgo(200) }), embed);
    const fp0 = await b.getVersionFingerprint();
    const r = await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.equal(r.periodicReviewDue.length, 1);
    assert.equal(r.periodicReviewDue[0].knowledgeId, "pd");
    assert.equal(r.periodicReviewDue[0].longOverdue, true, "200d past a 30d cadence is long overdue");
    assert.equal(r.dynamicExpiredDeprecated.length, 0);
    assert.equal((await b.getById("pd"))!.lifecycleStatus, "active", "PERIODIC must NOT be auto-deprecated");
    assert.equal(r.versionFingerprint, fp0, "flag-only → no fingerprint bump");
  });

  await test("DYNAMIC past expiresAt → auto-deprecated (reason expired) + fingerprint bump + system actor", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const k = await b.seed(seed({ id: "dx", freshnessClass: "DYNAMIC", expiresAt: daysAgo(2) }), embed);
    const fp0 = Number(await b.getVersionFingerprint());
    const r = await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.equal(r.dynamicExpiredDeprecated.length, 1);
    assert.equal(r.dynamicExpiredDeprecated[0].knowledgeId, "dx");
    assert.equal(Number(r.versionFingerprint), fp0 + 1, "an auto-deprecation bumps the fingerprint (§7.4)");
    const row = await b.getById(k.id);
    assert.equal(row!.lifecycleStatus, "deprecated");
    assert.equal(row!.deprecatedBy, FRESHNESS_SWEEP_ACTOR);
  });

  await test("DYNAMIC with NO expiresAt is never deprecated by the sweep", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(seed({ id: "dn", freshnessClass: "DYNAMIC", expiresAt: null }), embed);
    const r = await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.equal(r.dynamicExpiredDeprecated.length, 0);
    assert.equal((await b.getById("dn"))!.lifecycleStatus, "active");
  });

  await test("already-deprecated / archived / superseded rows are skipped (sweep only scans active)", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(seed({ id: "dep", lifecycleStatus: "deprecated", freshnessClass: "DYNAMIC", expiresAt: daysAgo(5) }), embed);
    await b.seed(seed({ id: "arc", lifecycleStatus: "archived", freshnessClass: "DYNAMIC", expiresAt: daysAgo(5) }), embed);
    await b.seed(seed({ id: "sup", lifecycleStatus: "active", supersededById: "x", freshnessClass: "DYNAMIC", expiresAt: daysAgo(5) }), embed);
    const r = await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.equal(r.scannedActive, 1, "only the 'sup' row is lifecycleStatus=active");
    assert.equal(r.dynamicExpiredDeprecated.length, 0, "a superseded row is guarded and not transitioned again");
    assert.equal((await b.getById("dep"))!.lifecycleStatus, "deprecated");
    assert.equal((await b.getById("arc"))!.lifecycleStatus, "archived");
  });

  await test("the sweep NEVER touches KnowledgeCandidate and NEVER transitions to active/draft", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seedCandidate({ id: "c1", canonicalQuestion: "q", proposedAnswer: "a", status: "candidate" });
    await b.seed(seed({ id: "draftRow", lifecycleStatus: "draft" }), embed);
    await b.seed(seed({ id: "dx", freshnessClass: "DYNAMIC", expiresAt: daysAgo(1) }), embed);
    await runFreshnessSweep({ store: b, clock: () => NOW });
    assert.deepEqual(await b.listCandidateIds(), ["c1"], "candidate still present, untouched");
    assert.equal((await b.getById("draftRow"))!.lifecycleStatus, "draft", "a draft row is never activated");
    // dx got deprecated (the only allowed transition) — never active
    assert.equal((await b.getById("dx"))!.lifecycleStatus, "deprecated");
  });

  await test("maxDeprecations safety valve caps auto-deprecations per run", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    for (let i = 0; i < 5; i += 1) {
      await b.seed(seed({ id: `dx${i}`, freshnessClass: "DYNAMIC", expiresAt: daysAgo(1) }), embed);
    }
    const r = await runFreshnessSweep({ store: b, clock: () => NOW, maxDeprecations: 2 });
    assert.equal(r.dynamicExpiredDeprecated.length, 2);
    const stillActive = (await b.list({ lifecycleStatus: "active" })).length;
    assert.equal(stillActive, 3, "3 expired rows left for the next run");
  });

  await test("INV-1: a sweep-deprecated row is immediately ineligible for retrieval", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const k = await b.seed(seed({ id: "dx", freshnessClass: "DYNAMIC", expiresAt: daysAgo(1), chunks: ["the current flimflam rate is nineteen dollars per unit"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, clock: () => NOW });
    // NB: retrieval already excludes it (expiresAt < now) — prove the sweep
    // makes that permanent without ever making it MORE reachable.
    await runFreshnessSweep({ store: b, clock: () => NOW });
    const r = await svc.retrieve("current flimflam rate per unit", { callerUserId: "u", callerRole: "customer", scopes: ["assistant", "shared"] });
    assert.ok(!r.hits.some((h) => h.knowledgeId === k.id), "a swept row surfaced in retrieval");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
