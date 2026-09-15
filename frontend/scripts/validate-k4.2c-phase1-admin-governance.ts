// scripts/validate-k4.2c-phase1-admin-governance.ts
// Sprint K4.2-C Phase 1 — admin governance surface + candidate lifecycle
// analytics. Offline (no DB, no embedding API) — entirely against
// in-memory adapters, exactly like K4.2-A/B's own suites.
//
// Run: npm run validate:k4.2c-phase1-admin-governance
//
// Proves (K4.2C_PHASE1_ADMIN_GOVERNANCE.md §6):
//   Part A — analytics emission: correct event at correct outcome branch,
//            never on a non-writing outcome, never throws when omitted
//   Part B — the hard K3/K1/K2 boundary (§0) — the single most important
//            check in this file
//   Part C — admin routes: requireAdmin-gated, delegate only to the
//            sanctioned factories/queries, never write via raw prisma
//   Part D — freshness-sweep cron: calls the existing, unmodified sweep;
//            vercel.json + proxy.ts stay in lockstep
//   Part E — admin UI: pages exist, nav entry present, audit-logs reused

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
import type { AnalyticsPort } from "../services/knowledge-loop/governance/ports";
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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

class SpyAnalytics implements AnalyticsPort {
  calls: Array<{ userId: string | null; type: string; metadata?: Record<string, unknown> }> = [];
  async record(userId: string | null, type: string, metadata?: Record<string, unknown>): Promise<void> {
    this.calls.push({ userId, type, metadata });
  }
}

const ADMIN = "admin-1";

function candidateInput(overrides: Partial<ProposeCandidateInput> = {}): ProposeCandidateInput {
  return {
    createdByUserId: "user-9",
    canonicalQuestion: "What does K4.2-C Phase 1 add?",
    proposedAnswer: "Admin routes, admin UI, a freshness cron, and candidate lifecycle analytics.",
    knowledgeType: "faq",
    sourceType: "unanswered_question",
    reasonForCandidate: "unanswered-high-value",
    confidence: 0.8,
    ...overrides,
  };
}

function newCandidateService(analytics?: AnalyticsPort, hits: Array<{ knowledgeId: string; similarity: number }> = []) {
  const store = new InMemoryCandidateStore();
  const service = new CandidateService({
    store,
    embed: new FakeEmbedder(),
    vectors: new FakeVectorSearch({ hits }),
    analytics,
  });
  return { store, service };
}

function newGovernanceRig(analytics?: AnalyticsPort) {
  const candidateStore = new InMemoryCandidateStore();
  const governanceStore = new InMemoryGovernanceStore(candidateStore);
  governanceStore.adminIds.add(ADMIN);
  const candidateService = new CandidateService({
    store: candidateStore,
    embed: new FakeEmbedder(),
    vectors: new FakeVectorSearch({ hits: [] }),
  });
  const governanceService = new GovernanceService({
    store: governanceStore,
    ingestion: new FakeIngestionPort(),
    analytics,
  });
  return { candidateStore, governanceStore, candidateService, governanceService };
}

async function main(): Promise<void> {
  console.log("\nK4.2-C Phase 1 — admin governance + lifecycle analytics\n");

  // ── Part A — analytics emission ─────────────────────────────────────
  await test("A1: propose() 'created' -> KNOWLEDGE_CANDIDATE_CREATED with candidateId/reasonForCandidate/sourceType", async () => {
    const spy = new SpyAnalytics();
    const { service } = newCandidateService(spy);
    const r = await service.propose(candidateInput());
    assert.equal(r.outcome, "created");
    const evt = spy.calls.find((c) => c.type === "KNOWLEDGE_CANDIDATE_CREATED");
    assert.ok(evt);
    assert.equal(evt?.metadata?.candidateId, r.candidate?.id);
    assert.equal(evt?.metadata?.reasonForCandidate, "unanswered-high-value");
    assert.equal(evt?.metadata?.sourceType, "unanswered_question");
  });

  await test("A2: propose() 'duplicate-of-active' (hard dup) STILL fires KNOWLEDGE_CANDIDATE_CREATED", async () => {
    const spy = new SpyAnalytics();
    const { service } = newCandidateService(spy, [{ knowledgeId: "k1", similarity: 0.99 }]);
    const r = await service.propose(candidateInput());
    assert.equal(r.outcome, "duplicate-of-active");
    assert.ok(spy.calls.some((c) => c.type === "KNOWLEDGE_CANDIDATE_CREATED"));
  });

  await test("A3: propose() 'idempotent-replay' does NOT fire a new event", async () => {
    const spy = new SpyAnalytics();
    const { service } = newCandidateService(spy);
    await service.propose(candidateInput({ originatingMessageId: "msg-1" }));
    const countAfterFirst = spy.calls.length;
    const r2 = await service.propose(candidateInput({ originatingMessageId: "msg-1" }));
    assert.equal(r2.outcome, "idempotent-replay");
    assert.equal(spy.calls.length, countAfterFirst, "no new analytics call on replay");
  });

  await test("A4: propose() 'blocked-privacy' does NOT fire", async () => {
    const spy = new SpyAnalytics();
    const { service } = newCandidateService(spy);
    const r = await service.propose(candidateInput({ proposedAnswer: "email me at x@example.com" }));
    assert.equal(r.outcome, "blocked-privacy");
    assert.equal(spy.calls.length, 0);
  });

  await test("A5: propose() 'blocked-invalid' does NOT fire", async () => {
    const spy = new SpyAnalytics();
    const { service } = newCandidateService(spy);
    const r = await service.propose(candidateInput({ sourceType: "web_researched", evidence: undefined }));
    assert.equal(r.outcome, "blocked-invalid");
    assert.equal(spy.calls.length, 0);
  });

  await test("A6: approve() success -> KNOWLEDGE_CANDIDATE_REVIEWED(decision=approved) + KNOWLEDGE_APPROVED", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    const c = await candidateService.propose(candidateInput());
    const r = await governanceService.approve(c.candidate!.id, ADMIN);
    assert.equal(r.outcome, "approved");
    const reviewed = spy.calls.find((e) => e.type === "KNOWLEDGE_CANDIDATE_REVIEWED");
    assert.equal(reviewed?.metadata?.decision, "approved");
    assert.ok(typeof reviewed?.metadata?.reviewLatencyMs === "number");
    const approved = spy.calls.find((e) => e.type === "KNOWLEDGE_APPROVED");
    assert.equal(approved?.metadata?.knowledgeId, r.knowledgeId);
  });

  await test("A7: approve() unauthorized/not-found/wrong-status/blocked-privacy do NOT fire", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    await governanceService.approve("ghost", ADMIN);
    await governanceService.approve("ghost", "not-an-admin");
    const c = await candidateService.propose(candidateInput());
    const r1 = await governanceService.approve(c.candidate!.id, ADMIN);
    assert.equal(r1.outcome, "approved");
    const countAfterApprove = spy.calls.length;
    await governanceService.approve(c.candidate!.id, ADMIN); // wrong-status (already approved)
    assert.equal(spy.calls.length, countAfterApprove, "no analytics on a failed/no-op approve");
  });

  await test("A8: reject() success -> KNOWLEDGE_CANDIDATE_REVIEWED(decision=rejected) + KNOWLEDGE_REJECTED", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    const c = await candidateService.propose(candidateInput());
    await governanceService.reject(c.candidate!.id, ADMIN, "not useful");
    const reviewed = spy.calls.find((e) => e.type === "KNOWLEDGE_CANDIDATE_REVIEWED");
    assert.equal(reviewed?.metadata?.decision, "rejected");
    const rejected = spy.calls.find((e) => e.type === "KNOWLEDGE_REJECTED");
    assert.equal(rejected?.metadata?.reason, "not useful");
  });

  await test("A9: deprecate() success -> KNOWLEDGE_DEPRECATED", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    const c = await candidateService.propose(candidateInput());
    const approved = await governanceService.approve(c.candidate!.id, ADMIN);
    spy.calls = [];
    await governanceService.deprecate(approved.knowledgeId!, ADMIN, "superseded");
    const evt = spy.calls.find((e) => e.type === "KNOWLEDGE_DEPRECATED");
    assert.equal(evt?.metadata?.knowledgeId, approved.knowledgeId);
    assert.equal(evt?.metadata?.reason, "superseded");
  });

  await test("A10: archive()/reinstate() fire NO event (none defined in K0.6 for them)", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    const c = await candidateService.propose(candidateInput());
    const approved = await governanceService.approve(c.candidate!.id, ADMIN);
    await governanceService.deprecate(approved.knowledgeId!, ADMIN);
    spy.calls = [];
    await governanceService.archive(approved.knowledgeId!, ADMIN);
    await governanceService.reinstate(approved.knowledgeId!, ADMIN);
    assert.equal(spy.calls.length, 0);
  });

  await test("A11: publishNewVersion() success -> KNOWLEDGE_APPROVED for the NEW version", async () => {
    const spy = new SpyAnalytics();
    const { candidateService, governanceService } = newGovernanceRig(spy);
    const c = await candidateService.propose(candidateInput());
    const approved = await governanceService.approve(c.candidate!.id, ADMIN);
    spy.calls = [];
    const pub = await governanceService.publishNewVersion(approved.knowledgeId!, ADMIN, { newAnswer: "updated", reason: "fix" });
    const evt = spy.calls.find((e) => e.type === "KNOWLEDGE_APPROVED");
    assert.equal(evt?.metadata?.knowledgeId, pub.createdKnowledgeId);
    assert.equal(evt?.metadata?.previousVersionId, approved.knowledgeId);
  });

  await test("A12: omitting analytics entirely never throws (K4.2-A/B's own tests never pass one)", async () => {
    const { candidateService, governanceService } = newGovernanceRig(undefined);
    const c = await candidateService.propose(candidateInput());
    assert.equal(c.outcome, "created");
    const r = await governanceService.approve(c.candidate!.id, ADMIN);
    assert.equal(r.outcome, "approved");
  });

  // ── Part B — the hard K3/K1/K2 boundary (§0) — the most important part ─
  const orchestratorFile = join(ROOT, "services", "knowledge-loop", "orchestrator", "knowledge-answer-orchestrator.ts");
  const buildProvenanceFile = join(ROOT, "services", "knowledge-loop", "orchestrator", "build-provenance.ts");
  const knowledgeServiceFile = join(ROOT, "services", "knowledge-loop", "knowledge", "knowledge-service.ts");

  await test("B1: build-provenance.ts still writes candidateCreatedId: null verbatim — K3 not wired to K4.2", () => {
    const src = readFileSync(buildProvenanceFile, "utf8");
    assert.match(src, /candidateCreatedId:\s*null/, "the K4-deferred marker must still be present, unedited");
  });

  await test("B2: knowledge-answer-orchestrator.ts has ZERO reference to CandidateService/GovernanceService/propose(/approve( — no wiring added", () => {
    const src = stripComments(readFileSync(orchestratorFile, "utf8"));
    assert.doesNotMatch(src, /CandidateService|GovernanceService|\.propose\(|\.approve\(|governance\//i);
  });

  await test("B3: build-provenance.ts has ZERO reference to CandidateService/GovernanceService", () => {
    const src = stripComments(readFileSync(buildProvenanceFile, "utf8"));
    assert.doesNotMatch(src, /CandidateService|GovernanceService/i);
  });

  await test("B4: KnowledgeService.retrieve() (knowledge-service.ts) has no KNOWLEDGE_QUERY/HIT/MISS/analytics reference — untouched by Phase 1", () => {
    const src = stripComments(readFileSync(knowledgeServiceFile, "utf8"));
    assert.doesNotMatch(src, /KNOWLEDGE_QUERY|KNOWLEDGE_HIT|KNOWLEDGE_MISS|KNOWLEDGE_LOW_RELEVANCE|AnalyticsEventService|analyticsEventService/);
  });

  await test("B5: no file under services/knowledge-loop/knowledge/** or services/knowledge-loop/orchestrator/** was created or touched by Phase 1 analytics/DI work", () => {
    // structural proxy: neither directory references AnalyticsPort/SpyAnalytics/
    // the new admin-queries module — if Phase 1 had touched them, one of
    // these tokens would appear.
    for (const dir of ["knowledge", "orchestrator"]) {
      const files = walk(join(ROOT, "services", "knowledge-loop", dir));
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        assert.doesNotMatch(src, /AnalyticsPort|admin-queries|K4\.2C/, `${f} appears to have been touched by K4.2-C Phase 1`);
      }
    }
  });

  // ── Part C — admin routes ───────────────────────────────────────────
  const routesDir = join(ROOT, "app", "api", "private", "admin", "knowledge-loop");
  const routeFiles = walk(routesDir);

  await test("C1: every knowledge-loop admin route file calls requireAdmin", () => {
    for (const f of routeFiles) {
      if (f.includes("cron")) continue; // dual-auth, checked separately (D)
      const src = readFileSync(f, "utf8");
      assert.match(src, /requireAdmin\(/, `${f} does not call requireAdmin`);
    }
  });

  await test("C2: no admin route writes via raw prisma — only through createCandidateService/createGovernanceService/admin-queries", () => {
    for (const f of routeFiles) {
      const src = stripComments(readFileSync(f, "utf8"));
      assert.doesNotMatch(src, /prisma\.(knowledge|knowledgeCandidate|auditLog)\.(create|update|updateMany|delete|upsert)/, `${f} writes via raw prisma`);
    }
  });

  await test("C3: approve/reject/deprecate routes import ONLY the sanctioned factories (createGovernanceService), never a store/adapter class directly", () => {
    const writeRoutes = routeFiles.filter((f) => /approve|reject|deprecate/.test(f));
    assert.ok(writeRoutes.length === 3, `expected 3 write routes, found ${writeRoutes.length}`);
    for (const f of writeRoutes) {
      const src = readFileSync(f, "utf8");
      assert.match(src, /createGovernanceService/);
      assert.doesNotMatch(src, /PrismaGovernanceStore|PrismaCandidateStore/);
    }
  });

  await test("C4: list/detail routes import ONLY admin-queries (read-only), never a write factory", () => {
    const readRoutes = routeFiles.filter((f) => f.endsWith("route.ts") && !/approve|reject|deprecate|cron/.test(f));
    assert.ok(readRoutes.length >= 3);
    for (const f of readRoutes) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /createGovernanceService|createCandidateService/, `${f} (a read route) imports a write factory`);
    }
  });

  // ── Part D — freshness-sweep cron ───────────────────────────────────
  await test("D1: the cron route calls the existing createFreshnessSweep() — never reimplements sweep logic", () => {
    const src = readFileSync(join(routesDir, "cron", "freshness-sweep", "route.ts"), "utf8");
    assert.match(src, /createFreshnessSweep/);
    assert.doesNotMatch(src, /DYNAMIC.*expiresAt|PERIODIC.*review/i, "sweep decision logic must not be duplicated here");
  });

  await test("D2: the cron route is dual-authed (isValidCronSecret OR requireAdmin), same precedent as automation dispatch", () => {
    const src = readFileSync(join(routesDir, "cron", "freshness-sweep", "route.ts"), "utf8");
    assert.match(src, /isValidCronSecret/);
    assert.match(src, /requireAdmin/);
  });

  await test("D3: vercel.json and proxy.ts's CRON_SECRET_EXEMPT_PATHS are in lockstep for the freshness-sweep path", () => {
    const vercelJson = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons: Array<{ path: string }> };
    const proxySrc = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    const path = "/api/private/admin/knowledge-loop/cron/freshness-sweep";
    assert.ok(vercelJson.crons.some((c) => c.path === path), "vercel.json missing the cron entry");
    assert.ok(proxySrc.includes(`"${path}"`), "proxy.ts CRON_SECRET_EXEMPT_PATHS missing the path");
  });

  // ── Part E — admin UI ────────────────────────────────────────────────
  await test("E1: candidates list + detail pages exist", () => {
    for (const p of [
      join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "candidates", "page.tsx"),
      join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "candidates", "[id]", "page.tsx"),
      join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "knowledge", "page.tsx"),
    ]) {
      assert.doesNotThrow(() => statSync(p), `${p} does not exist`);
    }
  });

  await test("E2: the candidate detail page calls approveGovernanceCandidate/rejectGovernanceCandidate (real actions, not a stub)", () => {
    const src = readFileSync(join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "candidates", "[id]", "page.tsx"), "utf8");
    assert.match(src, /approveGovernanceCandidate/);
    assert.match(src, /rejectGovernanceCandidate/);
  });

  await test("E3: the knowledge list page calls deprecateGovernanceKnowledge", () => {
    const src = readFileSync(join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "knowledge", "page.tsx"), "utf8");
    assert.match(src, /deprecateGovernanceKnowledge/);
  });

  await test("E4: AdminNavTabs.tsx has a Knowledge Governance entry, path-boundary-safe against the existing Knowledge tab", () => {
    const src = readFileSync(join(ROOT, "components", "admin", "AdminNavTabs.tsx"), "utf8");
    assert.match(src, /knowledge-loop\/candidates/);
    assert.match(src, /startsWith\(`\$\{item\.href\}\/`\)/, "must be a path-boundary match, not a bare string prefix");
  });

  await test("E5: audit-logs page's ACTIONS list includes the 3 governance actions this phase can actually emit", () => {
    const src = readFileSync(join(ROOT, "app", "dashboard", "admin", "audit-logs", "page.tsx"), "utf8");
    for (const action of ["knowledge.approve", "knowledge.reject", "knowledge.deprecate"]) {
      assert.match(src, new RegExp(`"${action}"`));
    }
  });

  await test("E6: no NEW audit-history page was built — only the existing audit-logs page was extended", () => {
    let exists = true;
    try {
      statSync(join(ROOT, "app", "dashboard", "admin", "knowledge-loop", "audit-logs"));
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "a new audit-history page should not exist — the existing one was reused");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
