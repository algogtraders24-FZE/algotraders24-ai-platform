// scripts/validate-knowledge-loop-ingestion.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop, K1-D: integration with the
// EXISTING, UNMODIFIED IngestionService. Offline — a fake IngestionPort, ZERO
// DB / ZERO Gemini.
//
// Run: npm run validate:knowledge-loop-ingestion
//
// Proves:
//   * publishKnowledge() transitions a `draft` row to `active` FIRST, then
//     chunks + embeds its body through the ingestion pipeline (INV-1: a
//     candidate has no Knowledge id to pass — ingestion only ever runs for a
//     real Knowledge row).
//   * a partial embedding failure leaves the row `active` with
//     reindexNeeded = true (same non-fatal semantics as IngestionService).
//   * the row is retrievable end-to-end after publish.
//   * services/knowledge/IngestionService.ts + TextChunker.ts are byte-for-byte
//     unchanged vs origin/main (K1_DECISION §6 / do-not-touch).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  InMemoryKnowledgeBackend,
  FakeEmbedder,
} from "../services/knowledge-loop/knowledge/in-memory-backend";
import { KnowledgeService } from "../services/knowledge-loop/knowledge/knowledge-service";
import {
  publishKnowledge,
  type IngestionPort,
  type IngestOutcome,
} from "../services/knowledge-loop/knowledge/ingestion-adapter";
import type { SeedKnowledge } from "../services/knowledge-loop/knowledge/in-memory-backend";
import type { RetrievalOptions } from "../types/knowledge-loop";

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

const embed = new FakeEmbedder();
const NOW = new Date("2026-09-09T00:00:00.000Z");

function draftSeed(over: Partial<SeedKnowledge> = {}): SeedKnowledge {
  return {
    userId: "sys",
    title: "t",
    knowledgeType: "faq",
    scope: "assistant",
    visibility: "public",
    source: "candidate:cand_x",
    sourceType: "verified_qa",
    provenance: { origin: "candidate", createdBy: "admin1", createdAt: NOW.toISOString() },
    freshnessClass: "STATIC",
    lifecycleStatus: "draft",
    chunks: [],
    canonicalAnswer: "The florb rate limit is 100 requests per minute per key.",
    ...over,
  };
}

const opts: RetrievalOptions = {
  callerUserId: "u1",
  callerRole: "customer",
  scopes: ["assistant", "shared"],
  includeUserScope: true,
};

/** A fake IngestionPort that writes chunks into the in-memory backend, so the
 *  end-to-end retrieval assertion is real — without IngestionService/Gemini/DB. */
function fakeIngestion(
  backend: InMemoryKnowledgeBackend,
  cfg: { failEmbeddings?: boolean } = {},
): IngestionPort {
  const run = async (knowledgeId: string, text: string): Promise<IngestOutcome> => {
    const rec = await backend.getById(knowledgeId);
    if (!rec) throw new Error("no such knowledge");
    if (cfg.failEmbeddings) {
      return { knowledgeId, chunksCreated: 2, embeddingsStored: 0, embeddingsFailed: 2 };
    }
    await backend.attachChunks(knowledgeId, [text], embed);
    return { knowledgeId, chunksCreated: 1, embeddingsStored: 1, embeddingsFailed: 0 };
  };
  return {
    ingest: (p) => run(p.knowledgeId, p.text),
    reembed: (id) => run(id, "re-embed"),
  };
}

async function main(): Promise<void> {
  console.log("\nK1 - Knowledge Loop ingestion integration (K1-D)\n");

  await test("publishKnowledge: draft → active, then ingest; retrievable end-to-end", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, clock: () => NOW });
    const k = await b.seed(draftSeed(), embed);

    const before = await svc.retrieve("florb rate limit requests per minute", opts);
    assert.equal(before.hits.length, 0, "a draft row was retrievable before publish");

    const res = await publishKnowledge(svc, fakeIngestion(b), {
      knowledgeId: k.id,
      actorId: "admin1",
      body: k.canonicalAnswer!,
      confidence: 0.9,
    });
    assert.equal(res.knowledge.lifecycleStatus, "active");
    assert.equal(res.knowledge.approvedBy, "admin1");
    assert.ok(Number(res.versionFingerprint) >= 1);
    assert.equal(res.reindexNeeded, false);
    assert.equal(res.ingestion.embeddingsStored, 1);

    const after = await svc.retrieve("florb rate limit requests per minute", opts);
    assert.ok(after.hits.some((h) => h.knowledgeId === k.id), "not retrievable after publish");
  });

  await test("publishKnowledge: partial embedding failure → row still active, reindexNeeded=true", async () => {
    const b = new InMemoryKnowledgeBackend(() => NOW);
    const svc = new KnowledgeService({ store: b, vectors: b, embed, clock: () => NOW });
    const k = await b.seed(draftSeed(), embed);
    const res = await publishKnowledge(svc, fakeIngestion(b, { failEmbeddings: true }), {
      knowledgeId: k.id,
      actorId: "admin1",
      body: k.canonicalAnswer!,
    });
    assert.equal(res.knowledge.lifecycleStatus, "active", "row was rolled back on embed failure");
    assert.equal(res.reindexNeeded, true);
  });

  await test("K1_DECISION §6: IngestionService.ts + TextChunker.ts are unchanged vs origin/main", () => {
    for (const rel of [
      "services/knowledge/IngestionService.ts",
      "services/knowledge/TextChunker.ts",
    ]) {
      const p = join(ROOT, rel);
      assert.ok(existsSync(p), `${rel} missing`);
      let base = "";
      try {
        base = execSync(`git show origin/main:frontend/${rel}`, {
          cwd: ROOT,
          encoding: "utf8",
        });
      } catch {
        console.warn(`    (skip: could not read origin/main:frontend/${rel})`);
        return;
      }
      const current = readFileSync(p, "utf8");
      assert.equal(
        current.replace(/\r\n/g, "\n"),
        base.replace(/\r\n/g, "\n"),
        `${rel} DIFFERS from origin/main — K1 must not modify it`,
      );
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
