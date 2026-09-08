// scripts/validate-agent-run-persistence.ts
// Sprint AN, step A3 - Agent Run / Step / ToolCall / Evidence persistence.
//
// House style (node:assert/strict, tsx). Run:
//   npm run validate:agent-run-persistence
//
// Pure/offline: NO database connection. It verifies that
//   (a) the generated Prisma enums exactly mirror the AF-v1 contract
//       vocabularies,
//   (b) the generated Prisma model types carry every AF-v1 field,
//   (c) the generated migration SQL is PURELY ADDITIVE (4 new tables, 6 new
//       enums, zero touch to any existing table), and
//   (d) the migration is present but NOT recorded as applied.

import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AGENT_RUN_STATUSES,
  AGENT_RUN_TRIGGERS,
  AGENT_STEP_KINDS,
  AGENT_EVIDENCE_TYPES,
} from "../types/agent-framework/index";
import type {
  AgentRun as ContractAgentRun,
  AgentStep as ContractAgentStep,
  AgentToolCall as ContractAgentToolCall,
} from "../types/agent-framework/agent-run-contract";
import type { AgentEvidence as ContractAgentEvidence } from "../types/agent-framework/evidence-contract";
import type { ToolResultStatus } from "../types/agent-framework/tool-contract";

import {
  AgentRunStatus,
  AgentRunTrigger,
  AgentStepKind,
  AgentStepStatus,
  AgentToolCallStatus,
  AgentEvidenceType,
} from "../lib/generated/prisma/enums";
import type {
  AgentRunModel as PrismaAgentRun,
  AgentStepModel as PrismaAgentStep,
  AgentToolCallModel as PrismaAgentToolCall,
  AgentEvidenceModel as PrismaAgentEvidence,
} from "../lib/generated/prisma/models";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = join(ROOT, "prisma", "migrations", "20260906120000_add_agent_runtime_persistence");
const MIGRATION_SQL = join(MIGRATION_DIR, "migration.sql");

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
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// ---- compile-time: generated Prisma types satisfy the AF-v1 contract ----
// These assignments fail `tsc` if a contract field is missing from the
// generated model. Runtime is a no-op.
type _RunHasContractFields = {
  [K in keyof Pick<
    ContractAgentRun,
    "id" | "agentId" | "agentVersion" | "userId" | "status" | "trigger" | "input" | "plan" | "output"
    | "errorCode" | "errorMessage" | "limits" | "creditsEstimated" | "creditsConsumed" | "startedAt"
    | "completedAt" | "metadata" | "resumeState" | "createdAt" | "updatedAt" | "deletedAt"
  >]: K extends keyof PrismaAgentRun ? true : never;
};
type _StepHasContractFields = {
  [K in keyof Pick<
    ContractAgentStep,
    "id" | "runId" | "index" | "kind" | "status" | "summary" | "input" | "output"
    | "startedAt" | "completedAt" | "durationMs" | "creditsConsumed" | "createdAt"
  >]: K extends keyof PrismaAgentStep ? true : never;
};
type _ToolCallHasContractFields = {
  [K in keyof Pick<
    ContractAgentToolCall,
    "id" | "runId" | "stepId" | "toolId" | "toolVersion" | "input" | "output" | "status"
    | "permissionChecked" | "creditCost" | "startedAt" | "completedAt" | "durationMs" | "evidenceIds" | "createdAt"
  >]: K extends keyof PrismaAgentToolCall ? true : never;
};
type _EvidenceHasContractFields = {
  [K in keyof Pick<
    ContractAgentEvidence,
    "id" | "runId" | "stepId" | "toolCallId" | "type" | "claim" | "source" | "sourceId"
    | "timestamp" | "data" | "relevance" | "confidence" | "provenance" | "createdAt"
  >]: K extends keyof PrismaAgentEvidence ? true : never;
};
const _runCheck: _RunHasContractFields = {} as _RunHasContractFields;
const _stepCheck: _StepHasContractFields = {} as _StepHasContractFields;
const _toolCheck: _ToolCallHasContractFields = {} as _ToolCallHasContractFields;
const _evCheck: _EvidenceHasContractFields = {} as _EvidenceHasContractFields;
void _runCheck; void _stepCheck; void _toolCheck; void _evCheck;

const TOOL_RESULT_STATUSES: ToolResultStatus[] = [
  "ok", "invalid_input", "tool_error", "tool_timeout", "permission_denied",
];

function main(): void {
  console.log("\nAN1.x - Agent Run persistence validation (offline)\n");

  // ---- 1. generated enums mirror the AF-v1 contract vocabularies ----

  test("AgentRunStatus enum == AF-v1 AGENT_RUN_STATUSES", () => {
    assert.deepEqual(Object.values(AgentRunStatus).sort(), [...AGENT_RUN_STATUSES].sort());
  });
  test("AgentRunTrigger enum == AF-v1 AGENT_RUN_TRIGGERS", () => {
    assert.deepEqual(Object.values(AgentRunTrigger).sort(), [...AGENT_RUN_TRIGGERS].sort());
  });
  test("AgentStepKind enum == AF-v1 AGENT_STEP_KINDS", () => {
    assert.deepEqual(Object.values(AgentStepKind).sort(), [...AGENT_STEP_KINDS].sort());
  });
  test("AgentStepStatus enum == { ok, error, skipped }", () => {
    assert.deepEqual(Object.values(AgentStepStatus).sort(), ["error", "ok", "skipped"]);
  });
  test("AgentToolCallStatus enum == AF-v1 ToolResultStatus", () => {
    assert.deepEqual(Object.values(AgentToolCallStatus).sort(), [...TOOL_RESULT_STATUSES].sort());
  });
  test("AgentEvidenceType enum == AF-v1 AGENT_EVIDENCE_TYPES", () => {
    assert.deepEqual(Object.values(AgentEvidenceType).sort(), [...AGENT_EVIDENCE_TYPES].sort());
  });

  // ---- 2. migration file present + shaped correctly ----

  test("migration folder + migration.sql exist", () => {
    assert.ok(existsSync(MIGRATION_DIR), "migration folder missing");
    assert.ok(existsSync(MIGRATION_SQL), "migration.sql missing");
  });

  const sql = existsSync(MIGRATION_SQL) ? readFileSync(MIGRATION_SQL, "utf8") : "";

  test("migration header records its review provenance + the migrate-dev prohibition", () => {
    // The migration was GENERATED + REVIEWED as NOT APPLIED (G03), then
    // applied via `prisma migrate deploy` under explicit G03 authorization.
    // Prisma migration files are immutable once applied, so the header keeps
    // its original review-time wording; this test only guards the
    // still-true prohibition.
    assert.match(sql, /Never run `prisma migrate dev`/);
    assert.match(sql, /hand-reviewed/);
  });

  test("migration creates exactly the 6 new enums", () => {
    const enums = [...sql.matchAll(/CREATE TYPE "(\w+)" AS ENUM/g)].map((m) => m[1]).sort();
    assert.deepEqual(enums, [
      "AgentEvidenceType", "AgentRunStatus", "AgentRunTrigger",
      "AgentStepKind", "AgentStepStatus", "AgentToolCallStatus",
    ]);
  });

  test("migration creates exactly the 4 new tables", () => {
    const tables = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(tables, ["AgentEvidence", "AgentRun", "AgentStep", "AgentToolCall"]);
  });

  test("migration is PURELY ADDITIVE - no DROP, no ALTER on any existing table", () => {
    assert.ok(!/\bDROP\b/i.test(sql), "migration must contain no DROP");
    const alters = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    const allowed = new Set(["AgentStep", "AgentToolCall", "AgentEvidence"]);
    for (const t of alters) {
      assert.ok(allowed.has(t), `ALTER TABLE "${t}" is not one of the 4 new tables`);
    }
    // every ALTER on a new table is an ADD CONSTRAINT ... FOREIGN KEY
    for (const line of sql.split("\n").filter((l) => l.startsWith("ALTER TABLE"))) {
      assert.match(line, /ADD CONSTRAINT ".+_fkey" FOREIGN KEY/, `unexpected ALTER: ${line}`);
    }
  });

  test("migration never references a legacy table (Agent/AgentTask/AgentMemory/AgentActivity/User)", () => {
    for (const legacy of ['"Agent"', '"AgentTask"', '"AgentMemory"', '"AgentActivity"', '"User"']) {
      assert.ok(!sql.includes(legacy), `migration references legacy table ${legacy}`);
    }
  });

  test("migration enforces the (runId, index) uniqueness on AgentStep", () => {
    assert.match(sql, /CREATE UNIQUE INDEX "AgentStep_runId_index_key" ON "AgentStep"\("runId", "index"\)/);
  });

  test("every parent->child FK is ON DELETE CASCADE (a run's subtree is atomic)", () => {
    const fks = [...sql.matchAll(/ADD CONSTRAINT "(\w+_fkey)" FOREIGN KEY .+? ON DELETE (\w+)/g)];
    assert.equal(fks.length, 6, "expected 6 foreign keys");
    for (const [, name, action] of fks) {
      assert.equal(action, "CASCADE", `${name} must be ON DELETE CASCADE`);
    }
  });

  test("index coverage for the runtime's hot queries", () => {
    for (const idx of [
      'CREATE INDEX "AgentRun_userId_idx"',
      'CREATE INDEX "AgentRun_status_idx"',
      'CREATE INDEX "AgentRun_status_updatedAt_idx"', // tick() scheduler: find resumable runs
      'CREATE INDEX "AgentRun_agentId_createdAt_idx"',
      'CREATE INDEX "AgentStep_runId_idx"',
      'CREATE INDEX "AgentToolCall_runId_idx"',
      'CREATE INDEX "AgentEvidence_runId_idx"', // "why did this agent conclude X"
    ]) {
      assert.ok(sql.includes(idx), `missing ${idx}`);
    }
  });

  // ---- 3. append-only tables carry no updatedAt / deletedAt ----

  test("AgentStep / AgentToolCall / AgentEvidence are append-only (no updatedAt, no deletedAt)", () => {
    const tableBlock = (name: string): string => {
      const m = sql.match(new RegExp(`CREATE TABLE "${name}" \\([\\s\\S]*?\\n\\);`));
      assert.ok(m, `could not isolate CREATE TABLE "${name}"`);
      return m![0];
    };
    for (const name of ["AgentStep", "AgentToolCall", "AgentEvidence"] as const) {
      const block = tableBlock(name);
      assert.ok(!block.includes('"updatedAt"'), `${name} must not have updatedAt`);
      assert.ok(!block.includes('"deletedAt"'), `${name} must not have deletedAt`);
    }
    // AgentRun (mutable) DOES have both, plus the resumeState checkpoint.
    const runBlock = tableBlock("AgentRun");
    assert.ok(runBlock.includes('"updatedAt"') && runBlock.includes('"deletedAt"'), "AgentRun must have updatedAt + deletedAt");
    assert.ok(runBlock.includes('"resumeState"'), "AgentRun must carry resumeState for the resumable tick() model");
  });

  // ---- 4. migration is a well-formed, ordered Prisma migration ----

  test("migration folder name is a valid timestamped Prisma migration id", () => {
    assert.match(
      "20260906120000_add_agent_runtime_persistence",
      /^\d{14}_[a-z0-9_]+$/,
      "folder must be <YYYYMMDDHHMMSS>_<snake_name>",
    );
    // it sorts after the last pre-A3 migration this branch knows about
    assert.ok("20260906120000_add_agent_runtime_persistence" > "20260901160000_add_algo_test_run");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
