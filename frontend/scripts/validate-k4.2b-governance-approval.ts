// scripts/validate-k4.2b-governance-approval.ts
// Sprint K4.2-B — AT24 Knowledge Governance: approve/reject/deprecate/
// archive/reinstate/publishNewVersion. Offline (no DB, no embedding API) —
// entirely against in-memory adapters, sharing the SAME candidate store
// instance CandidateService (K4.2-A) writes to.
//
// Run: npm run validate:k4.2b-governance-approval
//
// Proves (K4.2B_GOVERNANCE_APPROVAL.md §9):
//   Part A — authorization (admin / non-admin / nonexistent)
//   Part B — approve() happy path: Knowledge created active, candidate
//            updated, AuditLog written, provenance transfer, ingestion call
//   Part C — concurrency/idempotency/duplicate-promotion (the status guard)
//   Part D — reject()
//   Part E — deprecate/archive/reinstate
//   Part F — publishNewVersion()
//   Part G — retrieval isolation (structural)
//   Part H — governance boundary + atomicity mechanism (structural)

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CandidateService } from "../services/knowledge-loop/governance/candidate-service";
import { GovernanceService } from "../services/knowledge-loop/governance/governance-service";
import {
  FakeEmbedder,
  FakeIngestionPort,
  FakeVectorSearch,
  InMemoryCandidateStore,
  InMemoryGovernanceStore,
} from "../services/knowledge-loop/governance/in-memory-adapters";
import type { CandidateRecord, ProposeCandidateInput } from "../types/knowledge-loop";

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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const ADMIN = "admin-1";
const NON_ADMIN = "user-1";

function candidateInput(overrides: Partial<ProposeCandidateInput> = {}): ProposeCandidateInput {
  return {
    createdByUserId: "user-9",
    canonicalQuestion: "What is K4.2-B for?",
    proposedAnswer: "It promotes reviewed candidates into live Knowledge.",
    knowledgeType: "faq",
    sourceType: "unanswered_question",
    reasonForCandidate: "unanswered-high-value",
    confidence: 0.8,
    ...overrides,
  };
}

interface Rig {
  candidateStore: InMemoryCandidateStore;
  governanceStore: InMemoryGovernanceStore;
  candidateService: CandidateService;
  governanceService: GovernanceService;
  ingestion: FakeIngestionPort;
}

function newRig(ingestionCfg?: ConstructorParameters<typeof FakeIngestionPort>[0]): Rig {
  const candidateStore = new InMemoryCandidateStore();
  const governanceStore = new InMemoryGovernanceStore(candidateStore);
  governanceStore.adminIds.add(ADMIN);
  const candidateService = new CandidateService({
    store: candidateStore,
    embed: new FakeEmbedder(),
    vectors: new FakeVectorSearch({ hits: [] }),
  });
  const ingestion = new FakeIngestionPort(ingestionCfg);
  const governanceService = new GovernanceService({ store: governanceStore, ingestion });
  return { candidateStore, governanceStore, candidateService, governanceService, ingestion };
}

async function seedCandidate(rig: Rig, overrides: Partial<ProposeCandidateInput> = {}): Promise<CandidateRecord> {
  const r = await rig.candidateService.propose(candidateInput(overrides));
  assert.equal(r.outcome, "created", "test setup: candidate must be created");
  return r.candidate!;
}

async function main(): Promise<void> {
  console.log("\nK4.2-B — governance approval\n");

  // ── Part A — authorization ─────────────────────────────────────────────
  await test("A1: approve() by a non-admin -> unauthorized, no Knowledge row created", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, NON_ADMIN);
    assert.equal(r.outcome, "unauthorized");
    assert.equal(rig.governanceStore.knowledgeRows.length, 0);
  });

  await test("A2: approve() by a nonexistent adminId -> unauthorized", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, "ghost-user");
    assert.equal(r.outcome, "unauthorized");
  });

  await test("A3: reject()/deprecate() by a non-admin -> unauthorized, no write", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r1 = await rig.governanceService.reject(cand.id, NON_ADMIN, "no");
    assert.equal(r1.outcome, "unauthorized");
    const r2 = await rig.governanceService.deprecate("know-doesnt-matter", NON_ADMIN);
    assert.equal(r2.outcome, "unauthorized");
    assert.equal(rig.governanceStore.auditLog.length, 0);
  });

  // ── Part B — approve() happy path ──────────────────────────────────────
  await test("B1: approve() creates an active Knowledge row, updates the candidate, writes AuditLog, bumps the counter", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r.outcome, "approved");
    assert.ok(r.knowledgeId);
    const knowledge = rig.governanceStore.knowledgeRows.find((k) => k.id === r.knowledgeId);
    assert.equal(knowledge?.lifecycleStatus, "active");
    assert.equal(knowledge?.approvedBy, ADMIN);
    const updatedCandidate = rig.candidateStore.rows.find((c) => c.id === cand.id);
    assert.equal(updatedCandidate?.status, "approved");
    assert.equal(updatedCandidate?.finalKnowledgeId, r.knowledgeId);
    assert.ok(r.auditLogId);
    const audit = rig.governanceStore.auditLog.find((a) => a.id === r.auditLogId);
    assert.equal(audit?.action, "knowledge.approve");
    assert.equal(audit?.actorUserId, ADMIN);
    assert.ok(r.versionFingerprint);
  });

  await test("B2: provenance transfer — Knowledge.provenance built from candidate.evidence, editedByReviewer=false when unedited", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig, {
      originatingConversationId: "conv-1",
      evidence: { knowledgeSources: [{ knowledgeId: "k1", chunkId: "c1", similarity: 0.5 }] },
    });
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    const knowledge = rig.governanceStore.knowledgeRows.find((k) => k.id === r.knowledgeId)!;
    assert.equal(knowledge.provenance?.origin, "candidate");
    assert.equal(knowledge.provenance?.originatingConversationId, "conv-1");
    assert.deepEqual(knowledge.provenance?.knowledgeSources, [{ knowledgeId: "k1", chunkId: "c1", similarity: 0.5 }]);
    assert.notEqual(knowledge.provenance?.editedByReviewer, true);
  });

  await test("B3: editedAnswer sets editedByReviewer=true and reviewerNotes flows into provenance", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, ADMIN, {
      editedAnswer: "a materially different answer",
      reviewerNotes: "cleaned up phrasing",
    });
    const knowledge = rig.governanceStore.knowledgeRows.find((k) => k.id === r.knowledgeId)!;
    assert.equal(knowledge.canonicalAnswer, "a materially different answer");
    assert.equal(knowledge.provenance?.editedByReviewer, true);
    assert.equal(knowledge.provenance?.reviewerNotes, "cleaned up phrasing");
  });

  await test("B4: privacy re-scan at approval time blocks an edited answer that leaks PII — no Knowledge row created", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, ADMIN, {
      editedAnswer: "contact trader@example.com for details",
    });
    assert.equal(r.outcome, "blocked-privacy");
    assert.ok((r.blockedReasons?.length ?? 0) > 0);
    assert.equal(rig.governanceStore.knowledgeRows.length, 0);
    const stillCandidate = rig.candidateStore.rows.find((c) => c.id === cand.id);
    assert.equal(stillCandidate?.status, "candidate", "the candidate must be untouched, still reviewable");
  });

  await test("B5: reindexNeeded=true when ingestion reports a failed embed", async () => {
    const rig = newRig({ embeddingsFailed: 1, embeddingsStored: 0 });
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r.outcome, "approved", "approval itself still succeeds — embedding is best-effort");
    assert.equal(r.reindexNeeded, true);
  });

  await test("B6 (K4.2B-D4): a TOTAL ingestion failure (throw) does not fail an already-committed approval", async () => {
    const rig = newRig({ throwError: true });
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r.outcome, "approved", "the transaction already committed before ingestion ran");
    assert.equal(r.reindexNeeded, true);
    assert.equal(rig.governanceStore.knowledgeRows.length, 1, "the Knowledge row must still exist");
  });

  await test("B7: ingestion is called with the FINAL (possibly edited) answer text, not the original proposal", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig, { proposedAnswer: "original" });
    await rig.governanceService.approve(cand.id, ADMIN, { editedAnswer: "edited" });
    assert.equal(rig.ingestion.calls[0]?.text, "edited");
  });

  // ── Part C — concurrency / idempotency / duplicate promotion ──────────
  await test("C1: re-approving an already-approved candidate -> wrong-status, no second Knowledge row", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r1 = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r1.outcome, "approved");
    const r2 = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r2.outcome, "wrong-status", "the SAME conditional-update guard that makes concurrent approval race-safe also makes a replay a no-op");
    assert.equal(rig.governanceStore.knowledgeRows.length, 1);
  });

  await test("C2 (duplicate promotion): a status=duplicate candidate can never be approved", async () => {
    const rig = newRig();
    // force a hard duplicate via the dedup path (K4.2-A behavior, unmodified)
    const vectors = new FakeVectorSearch({ hits: [{ knowledgeId: "existing-k", similarity: 0.99 }] });
    const svc = new CandidateService({ store: rig.candidateStore, embed: new FakeEmbedder(), vectors });
    const propose = await svc.propose(candidateInput());
    assert.equal(propose.outcome, "duplicate-of-active");
    const r = await rig.governanceService.approve(propose.candidate!.id, ADMIN);
    assert.equal(r.outcome, "wrong-status");
    assert.equal(rig.governanceStore.knowledgeRows.length, 0);
  });

  await test("C3: a rejected candidate cannot be approved afterward", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    await rig.governanceService.reject(cand.id, ADMIN, "not useful");
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    assert.equal(r.outcome, "wrong-status");
  });

  await test("C4: approve() on a nonexistent candidateId -> not-found", async () => {
    const rig = newRig();
    const r = await rig.governanceService.approve("no-such-id", ADMIN);
    assert.equal(r.outcome, "not-found");
  });

  // ── Part D — reject() ───────────────────────────────────────────────────
  await test("D1: reject() default closeAs -> status=rejected, reviewNotes+auditLog written", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.reject(cand.id, ADMIN, "not accurate");
    assert.equal(r.outcome, "rejected");
    assert.equal(r.candidate?.status, "rejected");
    assert.equal(r.candidate?.reviewNotes, "not accurate");
    assert.ok(r.auditLogId);
  });

  await test("D2: reject(closeAs='duplicate') sets status=duplicate", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.reject(cand.id, ADMIN, "same as k1", "duplicate");
    assert.equal(r.candidate?.status, "duplicate");
  });

  await test("D3: reject(closeAs='superseded') sets status=superseded", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    const r = await rig.governanceService.reject(cand.id, ADMIN, "outdated", "superseded");
    assert.equal(r.candidate?.status, "superseded");
  });

  await test("D4: rejecting an already-decided candidate -> wrong-status (idempotent, no double-write)", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    await rig.governanceService.reject(cand.id, ADMIN, "first");
    const auditCountAfterFirst = rig.governanceStore.auditLog.length;
    const r2 = await rig.governanceService.reject(cand.id, ADMIN, "second");
    assert.equal(r2.outcome, "wrong-status");
    assert.equal(rig.governanceStore.auditLog.length, auditCountAfterFirst, "no new audit row on a no-op reject");
  });

  await test("D5: rejecting a nonexistent candidateId -> not-found", async () => {
    const rig = newRig();
    const r = await rig.governanceService.reject("ghost", ADMIN, "x");
    assert.equal(r.outcome, "not-found");
  });

  // ── Part E — deprecate / archive / reinstate ───────────────────────────
  let fixtureCounter = 0;
  async function approvedKnowledgeId(rig: Rig): Promise<string> {
    fixtureCounter += 1;
    const cand = await seedCandidate(rig, { canonicalQuestion: `What is fixture question number ${fixtureCounter}?` });
    const r = await rig.governanceService.approve(cand.id, ADMIN);
    return r.knowledgeId!;
  }

  await test("E1: deprecate() an active row -> lifecycleStatus=deprecated, deprecatedAt/By set, audit written", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    const r = await rig.governanceService.deprecate(id, ADMIN, "outdated");
    assert.equal(r.outcome, "deprecated");
    assert.equal(r.knowledge?.lifecycleStatus, "deprecated");
    assert.ok(r.knowledge?.deprecatedAt);
    assert.equal(r.knowledge?.deprecatedBy, ADMIN);
  });

  await test("E2: deprecate() a non-active row -> wrong-status", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    await rig.governanceService.deprecate(id, ADMIN);
    const r2 = await rig.governanceService.deprecate(id, ADMIN);
    assert.equal(r2.outcome, "wrong-status");
  });

  await test("E3: archive() a deprecated row -> archived", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    await rig.governanceService.deprecate(id, ADMIN);
    const r = await rig.governanceService.archive(id, ADMIN);
    assert.equal(r.outcome, "archived");
    assert.equal(r.knowledge?.lifecycleStatus, "archived");
  });

  await test("E4: archive() a non-deprecated (still active) row -> wrong-status", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    const r = await rig.governanceService.archive(id, ADMIN);
    assert.equal(r.outcome, "wrong-status");
  });

  await test("E5: reinstate() a deprecated row -> active again, deprecatedAt/By cleared", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    await rig.governanceService.deprecate(id, ADMIN);
    const r = await rig.governanceService.reinstate(id, ADMIN, "wrongful deprecation");
    assert.equal(r.outcome, "reinstated");
    assert.equal(r.knowledge?.lifecycleStatus, "active");
    assert.equal(r.knowledge?.deprecatedAt, null);
  });

  await test("E6: deprecate() a nonexistent knowledgeId -> not-found", async () => {
    const rig = newRig();
    const r = await rig.governanceService.deprecate("ghost", ADMIN);
    assert.equal(r.outcome, "not-found");
  });

  // ── Part F — publishNewVersion() ───────────────────────────────────────
  await test("F1: publishNewVersion creates version+1, supersedesId set; old row deprecated + supersededById set; audit + ingestion for the NEW id", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    const r = await rig.governanceService.publishNewVersion(id, ADMIN, {
      newAnswer: "an updated, corrected answer",
      reason: "correction",
    });
    assert.equal(r.outcome, "new-version-published");
    assert.ok(r.createdKnowledgeId);
    assert.equal(r.deprecatedKnowledgeId, id);
    const created = rig.governanceStore.knowledgeRows.find((k) => k.id === r.createdKnowledgeId)!;
    const deprecated = rig.governanceStore.knowledgeRows.find((k) => k.id === id)!;
    assert.equal(created.version, 2);
    assert.equal(created.supersedesId, id);
    assert.equal(deprecated.lifecycleStatus, "deprecated");
    assert.equal(deprecated.supersededById, created.id);
    assert.equal(rig.ingestion.calls[rig.ingestion.calls.length - 1]?.knowledgeId, created.id);
  });

  await test("F2: publishNewVersion on a nonexistent knowledgeId -> not-found", async () => {
    const rig = newRig();
    const r = await rig.governanceService.publishNewVersion("ghost", ADMIN, { newAnswer: "x", reason: "y" });
    assert.equal(r.outcome, "not-found");
  });

  await test("F3: publishNewVersion on an already-deprecated row -> not-found (not active)", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    await rig.governanceService.deprecate(id, ADMIN);
    const r = await rig.governanceService.publishNewVersion(id, ADMIN, { newAnswer: "x", reason: "y" });
    assert.equal(r.outcome, "not-found");
  });

  await test("F4: publishNewVersion by a non-admin -> unauthorized", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    const r = await rig.governanceService.publishNewVersion(id, NON_ADMIN, { newAnswer: "x", reason: "y" });
    assert.equal(r.outcome, "unauthorized");
  });

  // ── Part G — retrieval isolation ────────────────────────────────────────
  await test("G1: the approved Knowledge row satisfies the K1/K2 eligibility predicate directly", async () => {
    const rig = newRig();
    const id = await approvedKnowledgeId(rig);
    const row = rig.governanceStore.knowledgeRows.find((k) => k.id === id)!;
    assert.equal(row.lifecycleStatus, "active");
    assert.equal(row.supersededById, null);
    assert.equal(row.deletedAt, null);
    assert.ok(row.expiresAt === null || row.expiresAt > new Date());
  });

  await test("G2: the candidate itself never becomes eligible knowledge, even after approval (INV-1 unchanged)", async () => {
    const rig = newRig();
    const cand = await seedCandidate(rig);
    await rig.governanceService.approve(cand.id, ADMIN);
    const approvedCandidate = rig.candidateStore.rows.find((c) => c.id === cand.id)!;
    // an approved candidate is a CLOSED record pointing at the real
    // Knowledge row — it is never itself retrievable, at any status.
    assert.equal(approvedCandidate.status, "approved");
    assert.notEqual(approvedCandidate.status, "active", "CandidateStatus has no 'active' value — structurally cannot become retrievable knowledge");
  });

  // ── Part H — governance boundary + atomicity mechanism (structural) ────
  const governanceDir = join(ROOT, "services", "knowledge-loop", "governance");
  const governanceFiles = walk(governanceDir);

  await test("H1: governance-service.ts never imports KnowledgeService (K4.2B-D1 — re-implements, does not wrap)", () => {
    const src = stripComments(readFileSync(join(governanceDir, "governance-service.ts"), "utf8"));
    assert.doesNotMatch(src, /KnowledgeService|knowledge-service/);
  });

  await test("H2: PrismaGovernanceStore's status-guarded writes use updateMany (conditional update), not a plain .update() (K4.2B-D3, the real race-safety mechanism)", () => {
    const src = readFileSync(join(governanceDir, "prisma-adapters.ts"), "utf8");
    const guardedOps = ["approveCandidate", "rejectCandidate", "transitionKnowledge", "publishNewVersion"];
    for (const op of guardedOps) {
      const start = src.indexOf(`async ${op}(`);
      assert.ok(start >= 0, `${op} not found`);
      const nextMethodStart = src.indexOf("\n  async ", start + 10);
      const body = src.slice(start, nextMethodStart > 0 ? nextMethodStart : undefined);
      assert.match(body, /\.updateMany\(/, `${op} must use a conditional updateMany, not a plain update`);
      assert.match(body, /GovernanceConflictError/, `${op} must abort the transaction on a failed conditional update`);
    }
  });

  await test("H3: every governance-store write happens inside prisma.$transaction (atomicity, K4.2B-D1)", () => {
    const src = readFileSync(join(governanceDir, "prisma-adapters.ts"), "utf8");
    const transactionCount = (src.match(/prisma\.\$transaction\(/g) ?? []).length;
    assert.ok(transactionCount >= 4, `expected >=4 prisma.$transaction blocks (approve/reject/transition/publishNewVersion), found ${transactionCount}`);
  });

  await test("H4: no governance/** file writes prisma.knowledge./prisma.knowledgeChunk. OUTSIDE prisma-adapters.ts", () => {
    for (const f of governanceFiles) {
      if (f.endsWith("prisma-adapters.ts")) continue;
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(
        src,
        /prisma\.knowledge\.(create|update|updateMany|delete|upsert)|prisma\.knowledgeChunk\.(create|update|delete|upsert)|prisma\.auditLog\.create/,
        `${f} bypasses PrismaGovernanceStore`,
      );
    }
  });

  await test("H5: candidate-service.ts (K4.2-A) is untouched by this sprint — still never references markActive/KnowledgeService", () => {
    const src = stripComments(readFileSync(join(governanceDir, "candidate-service.ts"), "utf8"));
    assert.doesNotMatch(src, /\bmarkActive\b|\bcreateVersionOf\b|KnowledgeService/);
  });

  await test("H6: no admin route / admin UI / cron / analytics-event code exists yet (K4.2-C, not this sprint)", () => {
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

  await test("H7: no services/agent-framework/** file imports services/knowledge-loop (existing INV-1, unchanged by K4.2-B)", () => {
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
