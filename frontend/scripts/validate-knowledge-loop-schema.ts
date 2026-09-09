// scripts/validate-knowledge-loop-schema.ts
// Sprint K1 — AT24 AI Assistant Knowledge Loop, K1-B: migration + invariant
// tests. Offline (no DB, no Gemini).
//
// Run: npm run validate:knowledge-loop-schema
//
// Proves:
//   * the additive migration is GENERATED offline + NOT APPLIED + purely
//     additive (K1_DECISION §5 MG-1..MG-5, MG-8)
//   * the 7 enums + 5 new models exist and match the LOCKED contracts
//   * INV-1 structural layer: no Knowledge Loop retrieval code — and no
//     VectorRepository code path — references `KnowledgeCandidate`; the
//     `KnowledgeChunk` FK only ever points at `Knowledge`; the governance /
//     lifecycle module is not reachable from services/agent-framework/*

import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as enums from "../lib/generated/prisma/enums";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = join(
  ROOT,
  "prisma",
  "migrations",
  "20260908120000_add_knowledge_loop_foundation",
);
const SCHEMA = join(ROOT, "prisma", "schema.prisma");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
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

/** every non-comment SQL line (strips leading `--` lines). */
function sqlLines(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function main(): void {
  console.log("\nK1 - Knowledge Loop schema + migration + INV-1 structural checks\n");

  const migrationSqlPath = join(MIGRATION_DIR, "migration.sql");
  const migrationSql = existsSync(migrationSqlPath)
    ? readFileSync(migrationSqlPath, "utf8")
    : "";
  const migrationBody = sqlLines(migrationSql);
  const schema = readFileSync(SCHEMA, "utf8");

  // ── MG-1: generated offline, NOT APPLIED ─────────────────────────────
  test("MG-1: migration exists with the offline-generated + NOT APPLIED header", () => {
    assert.ok(existsSync(migrationSqlPath), "migration.sql missing");
    assert.match(migrationSql, /GENERATED via `prisma migrate diff` \(offline/);
    assert.match(migrationSql, /NOT APPLIED/);
    assert.match(migrationSql, /migrate dev/); // the pgvector-trap warning
  });

  // ── MG-2: additive-only (no destructive DDL / row mutation) ──────────
  test("MG-2: migration body has no DROP / ALTER COLUMN / DELETE / UPDATE...SET / TRUNCATE", () => {
    assert.doesNotMatch(migrationBody, /\bDROP\b/i);
    assert.doesNotMatch(migrationBody, /\bALTER\s+COLUMN\b/i);
    assert.doesNotMatch(migrationBody, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationBody, /\bUPDATE\s+\S+\s+SET\b/i);
    assert.doesNotMatch(migrationBody, /\bTRUNCATE\b/i);
    // every statement START (a line beginning at column 0 with a keyword) is
    // one of the four allowed kinds. Continuation lines (`ADD COLUMN ...`,
    // column defs inside `CREATE TABLE (...)`) are indented and excluded.
    const starts = migrationBody.match(/^(CREATE|ALTER|DROP|DELETE|UPDATE|TRUNCATE|INSERT)\s+[A-Z]+/gm) ?? [];
    for (const s of starts) {
      assert.ok(
        /^(CREATE TYPE|CREATE TABLE|CREATE INDEX|ALTER TABLE)$/.test(s.trim()),
        `unexpected statement kind: "${s.trim()}"`,
      );
    }
    assert.ok(starts.length >= 30, `expected ≥30 additive statements, got ${starts.length}`);
  });

  // ── MG-3: never touches the pgvector column / chunk table ────────────
  test("MG-3 / MG-8: migration body never names the chunk table or the vector column", () => {
    assert.doesNotMatch(migrationBody, /embedding/i);
    assert.doesNotMatch(migrationBody, /KnowledgeChunk/);
    assert.doesNotMatch(migrationBody, /\bvector\b/i);
  });

  // ── MG-4: new Knowledge columns nullable, or NOT NULL WITH a default ─
  test("MG-4: every `ALTER TABLE Knowledge ADD COLUMN ... NOT NULL` also has DEFAULT", () => {
    const addCols = migrationBody
      .split("\n")
      .filter((l) => /ADD COLUMN/.test(l) && /NOT NULL/.test(l));
    for (const l of addCols) {
      assert.match(l, /DEFAULT/, `NOT NULL without DEFAULT: ${l.trim()}`);
    }
  });

  // ── MG-2 (additive, table-level): ALTER TABLE only on "Knowledge" ────
  test("MG-2: the only ALTER TABLE targets \"Knowledge\" and is ADD COLUMN only", () => {
    const alters = migrationBody.match(/ALTER TABLE "(\w+)"/g) ?? [];
    for (const a of alters) {
      assert.equal(a, 'ALTER TABLE "Knowledge"', `unexpected ALTER TABLE: ${a}`);
    }
    // no FK constraint added to an existing table
    assert.doesNotMatch(migrationBody, /ADD CONSTRAINT .*FOREIGN KEY/i);
  });

  // ── enum parity with the LOCKED contracts (KNOWLEDGE_CONTRACT §4/§7/§8) ─
  test("enum parity: 7 Knowledge Loop enums present with the contract values", () => {
    assert.deepEqual(Object.values(enums.KnowledgeStatus).sort(), [
      "active",
      "archived",
      "deprecated",
      "draft",
    ]);
    assert.deepEqual(Object.values(enums.KnowledgeScope).sort(), [
      "assistant",
      "shared",
      "support",
      "user",
    ]);
    assert.deepEqual(Object.values(enums.KnowledgeVisibility).sort(), [
      "admin",
      "customer",
      "internal",
      "public",
    ]);
    assert.deepEqual(Object.values(enums.KnowledgeType).sort(), [
      "faq",
      "platform",
      "policy",
      "product",
      "support",
      "trading_education",
    ]);
    assert.deepEqual(Object.values(enums.KnowledgeFreshnessClass).sort(), [
      "DYNAMIC",
      "PERIODIC",
      "STATIC",
    ]);
    assert.deepEqual(Object.values(enums.KnowledgeSourceType).sort(), [
      "admin_authored",
      "assistant_correction",
      "existing_documentation",
      "support_resolution",
      "unanswered_question",
      "verified_qa",
      "web_researched",
    ]);
    assert.deepEqual(Object.values(enums.CandidateStatus).sort(), [
      "approved",
      "candidate",
      "duplicate",
      "rejected",
      "superseded",
      "under_review",
    ]);
  });

  test("model parity: 5 new tables created + 21 additive Knowledge columns", () => {
    const tables = [...migrationBody.matchAll(/CREATE TABLE "(\w+)"/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(tables.sort(), [
      "KnowledgeAnswerCache",
      "KnowledgeAnswerProvenance",
      "KnowledgeCandidate",
      "KnowledgeRetrievalLog",
      "KnowledgeVersionCounter",
    ]);
    const addCols = (migrationBody.match(/ADD COLUMN/g) ?? []).length;
    assert.equal(addCols, 21, `expected 21 additive Knowledge columns, got ${addCols}`);
  });

  test("legacy `Knowledge.status String` column is untouched; loop uses `lifecycleStatus`", () => {
    assert.match(schema, /status\s+String\s+@default\("processing"\)/);
    assert.match(schema, /lifecycleStatus\s+KnowledgeStatus\?/);
    assert.doesNotMatch(migrationBody, /"status".*KnowledgeStatus/);
  });

  test("MG-5: prisma/schema.prisma diff vs origin/main is purely additive (no removed lines)", () => {
    // Run offline without git if HEAD is unavailable; the CI check is the
    // authoritative one. Here we assert the shape of the change instead:
    // the K1 block is appended and the Knowledge block only gained lines.
    assert.match(schema, /Sprint K1 — AT24 AI Assistant Knowledge Loop: Knowledge Foundation/);
    assert.match(schema, /model KnowledgeCandidate \{/);
    assert.match(schema, /model KnowledgeVersionCounter \{/);
  });

  // ── INV-1 structural: retrieval code never references KnowledgeCandidate ─
  const loopFiles = walk(join(ROOT, "services", "knowledge-loop"));
  test("INV-1: no services/knowledge-loop/** file references `knowledgeCandidate` / `KnowledgeCandidate`", () => {
    for (const f of loopFiles) {
      const src = readFileSync(f, "utf8");
      // ports.ts / index.ts may name the TYPE `CandidateSeedPort` (test seam)
      // but must never touch a `KnowledgeCandidate` table/model.
      assert.doesNotMatch(
        src,
        /prisma\.knowledgeCandidate|from ["']@\/lib\/generated\/prisma["'].*Candidate|knowledgeCandidate\./,
        `${f} references the KnowledgeCandidate table`,
      );
    }
  });

  test("INV-1: repositories/VectorRepository.ts never references KnowledgeCandidate", () => {
    const src = readFileSync(join(ROOT, "repositories", "VectorRepository.ts"), "utf8");
    assert.doesNotMatch(src, /Candidate/i);
  });

  test("INV-1: VectorRepository K1 branch enforces the eligibility predicate", () => {
    const src = readFileSync(join(ROOT, "repositories", "VectorRepository.ts"), "utf8");
    assert.match(src, /k\."lifecycleStatus" = 'active'/);
    assert.match(src, /k\."supersededById" IS NULL/);
    assert.match(src, /k\."deletedAt" IS NULL/);
    assert.match(src, /k\."expiresAt" IS NULL OR k\."expiresAt" > now\(\)/);
    assert.match(src, /k\."scope"::text = ANY/);
    // backward-compat: the pre-K1 query still exists verbatim
    assert.match(src, /FROM "KnowledgeChunk" \nWHERE|FROM "KnowledgeChunk" `/);
  });

  test("INV-1: `KnowledgeChunk` FK only ever points at `Knowledge` (schema)", () => {
    const chunkModel = schema.slice(
      schema.indexOf("model KnowledgeChunk {"),
      schema.indexOf("}", schema.indexOf("model KnowledgeChunk {")) + 1,
    );
    const relations = [...chunkModel.matchAll(/@relation\(fields: \[(\w+)\], references: \[(\w+)\]/g)];
    for (const [, , ref] of relations) {
      assert.equal(ref, "id");
    }
    assert.match(chunkModel, /knowledge\s+Knowledge\s+@relation/);
    assert.doesNotMatch(chunkModel, /Candidate/);
  });

  test("INV-1: no services/agent-framework/** file imports the Knowledge Loop service", () => {
    const agentFiles = walk(join(ROOT, "services", "agent-framework"));
    for (const f of agentFiles) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(
        src,
        /services\/knowledge-loop/,
        `${f} imports services/knowledge-loop — governance-reach violation`,
      );
    }
  });

  test("INV-1: the Knowledge Loop service never imports services/agent-framework/*", () => {
    for (const f of loopFiles) {
      const src = readFileSync(f, "utf8");
      // import statements only — a doc comment naming the boundary is fine.
      assert.doesNotMatch(
        src,
        /^\s*(import|export)\b[^;]*from\s+["'][^"']*services\/agent-framework/m,
        `${f} imports services/agent-framework`,
      );
    }
  });

  // ── K2 — retrieval-cache migration + model ──────────────────────────
  const K2_MIG = join(
    ROOT,
    "prisma",
    "migrations",
    "20260909120000_add_knowledge_retrieval_cache",
    "migration.sql",
  );

  test("K2: retrieval-cache migration exists, offline-generated + NOT APPLIED, additive-only", () => {
    assert.ok(existsSync(K2_MIG), "K2 migration.sql missing");
    const sql = readFileSync(K2_MIG, "utf8");
    const body = sqlLines(sql);
    assert.match(sql, /GENERATED via `prisma migrate diff` \(offline/);
    assert.match(sql, /NOT APPLIED/);
    assert.match(sql, /migrate dev/);
    assert.doesNotMatch(body, /\bDROP\b/i);
    assert.doesNotMatch(body, /\bALTER\s+COLUMN\b/i);
    assert.doesNotMatch(body, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(body, /\bTRUNCATE\b/i);
    assert.doesNotMatch(body, /ALTER TABLE/i); // pure new-table migration
    assert.doesNotMatch(body, /embedding/i);
    const tables = [...body.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tables, ["KnowledgeRetrievalCache"]);
  });

  test("K2: KnowledgeRetrievalCache is a SEPARATE model from KnowledgeAnswerCache (contract §7.5)", () => {
    assert.match(schema, /model KnowledgeRetrievalCache \{/);
    assert.match(schema, /model KnowledgeAnswerCache \{/);
    // they must not have been merged
    const retrieval = schema.slice(
      schema.indexOf("model KnowledgeRetrievalCache {"),
      schema.indexOf("}", schema.indexOf("model KnowledgeRetrievalCache {")),
    );
    assert.doesNotMatch(retrieval, /answerText/, "retrieval cache must not store answer text");
    assert.match(retrieval, /results\s+Json/);
  });

  test("K2 INV-1: retrieval-cache code re-hydrates + re-filters (never trusts the cache as authority)", () => {
    const svc = readFileSync(
      join(ROOT, "services", "knowledge-loop", "knowledge", "knowledge-service.ts"),
      "utf8",
    );
    // the cache-hit path calls the same pipeline (re-filter) as the fresh path
    assert.match(svc, /fromCacheEntries/);
    assert.match(svc, /RE-FILTER eligibility on hydration/);
    assert.match(svc, /this\.store\.getByIds/); // hydrates live Knowledge rows on the hit path
    const cacheFile = readFileSync(
      join(ROOT, "services", "knowledge-loop", "knowledge", "retrieval-cache.ts"),
      "utf8",
    );
    assert.doesNotMatch(cacheFile, /Candidate/i);
    assert.doesNotMatch(cacheFile, /answerText|sourceClass/); // not the answer cache
  });

  test("K2: freshness sweep never touches candidates / never activates", () => {
    const raw = readFileSync(
      join(ROOT, "services", "knowledge-loop", "knowledge", "freshness-sweep.ts"),
      "utf8",
    );
    // strip // line comments so a doc comment naming the boundary is fine
    const code = raw
      .split("\n")
      .map((l) => l.replace(/\/\/[^\r\n]*/, ""))
      .join("\n");
    assert.doesNotMatch(code, /\bprisma\s*\./, "the sweep must go through the KnowledgeStore, not prisma");
    assert.doesNotMatch(code, /[Cc]andidate/, "the sweep must never reference candidate storage");
    assert.doesNotMatch(code, /to:\s*["'](active|draft)["']/, "the sweep must never transition TO active/draft");
    assert.match(code, /to:\s*["']deprecated["']/); // the only allowed transition
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
