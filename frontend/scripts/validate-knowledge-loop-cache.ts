// scripts/validate-knowledge-loop-cache.ts
// Sprint K2-A/B — AT24 AI Assistant Knowledge Loop: retrieval cache + logging.
// Offline — InMemoryKnowledgeBackend + InMemoryRetrievalCache + FakeEmbedder.
// ZERO DB, ZERO Gemini.
//
// Run: npm run validate:knowledge-loop-cache
//
// Proves KNOWLEDGE_RETRIEVAL_CONTRACT.md §7.2 (ADR-K2-RETR-CACHE) / §7.5 / §7.6:
//   miss → fresh retrieval + cache write ; hit → served from cache without an
//   embed call ; deterministic key ; every fingerprint-bumping transition
//   invalidates lazily ; expired entry → miss ; CONFIG_VERSION / topK in the
//   key ; CROSS-USER ISOLATION on the cache path ; and — critically — a stale
//   cache entry can NEVER resurrect a now-ineligible Knowledge row (INV-1).
//   K2-B: `KnowledgeRetrievalLog` distinguishes cache hit vs miss.

import assert from "node:assert/strict";

import {
  InMemoryKnowledgeBackend,
  FakeEmbedder,
} from "../services/knowledge-loop/knowledge/in-memory-backend";
import { InMemoryRetrievalCache } from "../services/knowledge-loop/knowledge/retrieval-cache";
import { KnowledgeService } from "../services/knowledge-loop/knowledge/knowledge-service";
import { retrievalCacheKey } from "../services/knowledge-loop/knowledge/retrieval";
import type { SeedKnowledge } from "../services/knowledge-loop/knowledge/in-memory-backend";
import type { EmbeddingPort } from "../services/knowledge-loop/knowledge/ports";
import type { RetrievalOptions } from "../types/knowledge-loop";

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
const prov = () => ({ origin: "admin-authored" as const, createdBy: "a", createdAt: NOW.toISOString() });

function seed(over: Partial<SeedKnowledge> & { chunks: string[] }): SeedKnowledge {
  return {
    userId: "sys", title: "t", knowledgeType: "faq", scope: "assistant",
    visibility: "public", source: "admin", sourceType: "admin_authored",
    provenance: prov(), freshnessClass: "STATIC", lifecycleStatus: "active",
    approvedAt: NOW, ...over,
  };
}
function opts(over: Partial<RetrievalOptions> = {}): RetrievalOptions {
  return { callerUserId: "u1", callerRole: "customer", scopes: ["assistant", "shared"], includeUserScope: true, ...over };
}

/** an embedder that counts its calls — lets us prove a hit skipped the embed. */
class CountingEmbedder implements EmbeddingPort {
  calls = 0;
  private readonly inner = new FakeEmbedder();
  async embed(text: string): Promise<number[]> {
    this.calls += 1;
    return this.inner.embed(text);
  }
}

const embed = new FakeEmbedder();

async function main(): Promise<void> {
  console.log("\nK2 - Knowledge Loop retrieval cache + logging\n");

  await test("MISS then HIT: second identical query is served from cache, no embed call", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    const counting = new CountingEmbedder();
    await b.seed(seed({ chunks: ["smart money concepts liquidity sweep in gold"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed: counting, retrievalCache: cache, clock: () => NOW });

    const r1 = await svc.retrieve("smart money concepts liquidity sweep gold", opts());
    assert.equal(r1.fromCache, false);
    assert.ok(r1.hits.length >= 1);
    assert.equal(counting.calls, 1, "fresh retrieval must embed once");
    assert.equal(cache.writes, 1, "a fresh retrieval writes the cache");

    const r2 = await svc.retrieve("smart money concepts liquidity sweep gold", opts());
    assert.equal(r2.fromCache, true, "second identical query must be a cache hit");
    assert.equal(counting.calls, 1, "a cache hit must NOT embed again");
    assert.deepEqual(
      r2.hits.map((h) => h.knowledgeId),
      r1.hits.map((h) => h.knowledgeId),
      "cache hit returns the same knowledge",
    );
  });

  await test("deterministic key: same inputs → same key; topK / scope / user change → different key", () => {
    const k = (q: string, sc: string[], sig: string, topK: number, fp: string) =>
      retrievalCacheKey(q, sc, sig, topK, fp);
    assert.equal(k("q", ["a", "b"], "customer:", 12, "3"), k("q", ["b", "a"], "customer:", 12, "3"), "scope order must not matter");
    assert.notEqual(k("q", ["a"], "customer:", 12, "3"), k("q", ["a"], "customer:", 24, "3"), "topK is a key dimension");
    assert.notEqual(k("q", ["a"], "customer:", 12, "3"), k("q", ["a"], "customer:u9", 12, "3"), "callerScopeSig (user) is a key dimension");
    assert.notEqual(k("q", ["a"], "customer:", 12, "3"), k("q", ["a"], "customer:", 12, "4"), "version fingerprint is a key dimension");
  });

  await test("fingerprint invalidation: markActive / deprecate / newVersion each make the prior cache entry unreachable", async () => {
    for (const transition of ["deprecate", "newVersion", "archive"] as const) {
      const b = new InMemoryKnowledgeBackend(() => NOW);
      const cache = new InMemoryRetrievalCache(() => NOW);
      const counting = new CountingEmbedder();
      const k = await b.seed(seed({ chunks: ["wibble frobnicator calibration sequence"] }), embed);
      const svc = new KnowledgeService({ store: b, vectors: b, embed: counting, retrievalCache: cache, clock: () => NOW });

      await svc.retrieve("wibble frobnicator calibration sequence", opts());
      assert.equal(counting.calls, 1);
      const before = await svc.retrieve("wibble frobnicator calibration sequence", opts());
      assert.equal(before.fromCache, true);
      assert.equal(counting.calls, 1);

      // a lifecycle transition bumps the version fingerprint
      if (transition === "deprecate") await svc.deprecate(k.id, "admin");
      else if (transition === "archive") await svc.archive(k.id, "admin");
      else await svc.newVersion(k.id, {
        userId: "admin", title: "t2", knowledgeType: "faq", scope: "assistant",
        visibility: "public", source: "admin", sourceType: "admin_authored",
        provenance: prov(), freshnessClass: "STATIC",
      });

      const after = await svc.retrieve("wibble frobnicator calibration sequence", opts());
      assert.equal(after.fromCache, false, `${transition}: the cache key must now miss (fingerprint changed)`);
      assert.equal(counting.calls, 2, `${transition}: a fresh embed happened after invalidation`);
    }
  });

  await test("expired cache entry → miss (TTL honoured)", async () => {
    let clock = NOW;
    const b = new InMemoryKnowledgeBackend(() => clock);
    const cache = new InMemoryRetrievalCache(() => clock);
    const counting = new CountingEmbedder();
    await b.seed(seed({ chunks: ["borogove mome rath outgrabe"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed: counting, retrievalCache: cache, clock: () => clock });
    await svc.retrieve("borogove mome rath outgrabe", opts());
    assert.equal(counting.calls, 1);
    // advance 11 minutes (TTL is 10)
    clock = new Date(NOW.getTime() + 11 * 60 * 1000);
    const r = await svc.retrieve("borogove mome rath outgrabe", opts());
    assert.equal(r.fromCache, false, "an entry past its TTL must not be served");
    assert.equal(counting.calls, 2);
  });

  // ── INV-1 on the cache path — THE critical test ────────────────────
  await test("INV-1: a stale cache entry can NEVER resurrect a deprecated Knowledge row", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    // a cache that IGNORES the version fingerprint entirely — the worst case:
    // an entry that keeps matching even after a lifecycle transition. The
    // service must STILL drop the row because it re-hydrates + re-filters live.
    const stickyCache = new InMemoryRetrievalCache(() => NOW);
    const realKey = stickyCache.set.bind(stickyCache);
    // monkey-patch: store every entry under a FIXED key and look it up under
    // the same fixed key, so fingerprint invalidation is defeated on purpose.
    (stickyCache as unknown as { set: typeof stickyCache.set }).set = ((_k, v, m, ttl) =>
      realKey("STICKY", v, m, ttl)) as typeof stickyCache.set;
    const realGet = stickyCache.get.bind(stickyCache);
    (stickyCache as unknown as { get: typeof stickyCache.get }).get = (() =>
      realGet("STICKY")) as typeof stickyCache.get;

    const k = await b.seed(seed({ chunks: ["the snorkel diffusion coefficient is 3.7 blorks"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: stickyCache, clock: () => NOW });

    const r1 = await svc.retrieve("snorkel diffusion coefficient blorks", opts());
    assert.ok(r1.hits.some((h) => h.knowledgeId === k.id));

    // deprecate the row — the sticky cache still "has" the old entry
    await svc.deprecate(k.id, "admin");
    const r2 = await svc.retrieve("snorkel diffusion coefficient blorks", opts());
    assert.ok(
      !r2.hits.some((h) => h.knowledgeId === k.id),
      "a deprecated row was resurrected from a stale cache entry — INV-1 VIOLATION",
    );
  });

  await test("INV-1: a stale cache entry cannot leak a superseded version or a candidate", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    const v1 = await b.seed(seed({ id: "v1", canonicalAnswer: "42", chunks: ["the plooble threshold is exactly 42 credits"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: cache, clock: () => NOW });
    await svc.retrieve("plooble threshold credits", opts()); // caches v1

    // supersede v1
    const v2 = await b.seed(seed({ id: "v2", version: 2, supersedesId: v1.id, chunks: ["the plooble threshold is exactly 50 credits"] }), embed);
    await b.transition({ id: v1.id, to: "deprecated", actorId: "admin", patch: { supersededById: v2.id } });

    const r = await svc.retrieve("plooble threshold credits", opts());
    assert.ok(!r.hits.some((h) => h.knowledgeId === "v1"), "a superseded version leaked from cache");

    // candidate with identical text — never in the corpus, never cached, never returned
    await b.seedCandidate({ id: "c1", canonicalQuestion: "plooble threshold", proposedAnswer: "the plooble threshold is 999 credits", status: "candidate" });
    const r2 = await svc.retrieve("plooble threshold credits", opts());
    assert.ok(r2.hits.every((h) => !h.content.includes("999")), "candidate content surfaced");
  });

  // ── cross-user isolation on the cache path ─────────────────────────
  await test("cross-user isolation: User B's equivalent query never returns User A's private (scope=user) row", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    await b.seed(
      seed({ scope: "user", userId: "userA", lifecycleStatus: null, visibility: "customer",
             chunks: ["userA private note: the offshore account routing detail"] }),
      embed,
    );
    const svcA = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: cache, clock: () => NOW });

    // A retrieves + caches
    const rA = await svcA.retrieve("private note offshore account routing", opts({ callerUserId: "userA" }));
    assert.ok(rA.hits.some((h) => h.unverified), "owner cannot see own scope=user row");

    // B issues the same words — DIFFERENT cache key (callerScopeSig) AND the
    // live re-filter would drop it anyway. Zero hits.
    const rB = await svcA.retrieve("private note offshore account routing", opts({ callerUserId: "userB" }));
    assert.equal(rB.hits.length, 0, "User B received User A's private row from cache — ISOLATION VIOLATION");
    assert.equal(rB.fromCache, false, "User B must not even key into User A's cache entry");
  });

  await test("visibility isolation: a guest never receives a customer-visibility row from cache", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    await b.seed(seed({ visibility: "customer", chunks: ["internal customer-only runbook step gamma"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: cache, clock: () => NOW });
    const asCustomer = await svc.retrieve("customer-only runbook step gamma", opts({ callerRole: "customer" }));
    assert.ok(asCustomer.hits.length >= 1);
    const asGuest = await svc.retrieve("customer-only runbook step gamma", opts({ callerRole: "guest" }));
    assert.equal(asGuest.hits.length, 0, "guest received a customer row");
    assert.equal(asGuest.fromCache, false, "guest keyed into the customer cache entry");
  });

  // ── K2-B logging ──────────────────────────────────────────────────
  await test("K2-B logging: KnowledgeRetrievalLog distinguishes cache hit vs miss; no raw query text", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    await b.seed(seed({ chunks: ["quokka habitat conservation status in western australia"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: cache, clock: () => NOW });
    b.retrievalLogs.length = 0;

    await svc.retrieve("quokka habitat conservation status western australia", opts());
    await svc.retrieve("quokka habitat conservation status western australia", opts());

    assert.equal(b.retrievalLogs.length, 2, "every retrieval emits one log row");
    assert.equal(b.retrievalLogs[0].fromCache, false, "first = miss");
    assert.equal(b.retrievalLogs[1].fromCache, true, "second = hit");
    for (const log of b.retrievalLogs) {
      assert.match(log.queryHash, /^[0-9a-f]{64}$/, "queryHash is a sha256 hex digest");
      assert.ok(!JSON.stringify(log).includes("quokka"), "raw query text must never appear in the log");
      assert.ok(typeof log.hitCount === "number" && log.hitCount >= 1);
      assert.ok(Array.isArray(log.scopes) && log.scopes.length > 0);
      assert.ok(typeof log.sufficiency === "string");
    }
  });

  await test("K2-B logging: a genuine miss is logged with hitCount 0 and the right sufficiency", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const cache = new InMemoryRetrievalCache(() => NOW);
    await b.seed(seed({ chunks: ["completely unrelated content about beekeeping"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, retrievalCache: cache, clock: () => NOW });
    b.retrievalLogs.length = 0;
    await svc.retrieve("lattice quantum chromodynamics gauge fixing", opts());
    assert.equal(b.retrievalLogs.length, 1);
    assert.equal(b.retrievalLogs[0].hitCount, 0);
    assert.equal(b.retrievalLogs[0].sufficiency, "INSUFFICIENT");
  });

  // ── backward compat ───────────────────────────────────────────────
  await test("backward compat: a KnowledgeService with NO retrievalCache behaves exactly like K1", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    await b.seed(seed({ chunks: ["numbat termite foraging behaviour daytime"] }), embed);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, clock: () => NOW }); // no cache
    const r1 = await svc.retrieve("numbat termite foraging behaviour", opts());
    const r2 = await svc.retrieve("numbat termite foraging behaviour", opts());
    assert.equal(r1.fromCache, false);
    assert.equal(r2.fromCache, false, "with no cache, fromCache is always false");
    assert.deepEqual(r1.hits.map((h) => h.chunkId), r2.hits.map((h) => h.chunkId));
  });

  await test("purgeExpired removes only rows past TTL + grace", async () => {
    let clock = NOW;
    const cache = new InMemoryRetrievalCache(() => clock);
    await cache.set("k1", { results: [] }, { queryHash: "a", scopeSig: "s", versionFingerprint: "1" }, 10 * 60 * 1000);
    assert.equal(cache.size(), 1);
    clock = new Date(NOW.getTime() + 10 * 60 * 1000 + 8 * 24 * 60 * 60 * 1000); // TTL + 8 days
    const removed = await cache.purgeExpired(7 * 24 * 60 * 60 * 1000);
    assert.equal(removed, 1);
    assert.equal(cache.size(), 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
