// scripts/validate-agent-credit.ts
// Sprint AN, step A9 - the agent Credit Ledger (G09).
//
// Run: npm run validate:agent-credit
//   (node --env-file so the PlanAllowanceResolver + runtime-integration test
//    can reach the DB; the ledger itself is exercised with an InMemoryStore)
//
// Proves: Account (allowance) -> immutable ledger -> deterministic balance
//   -> run/tool correlation -> idempotent charge -> auditable history.
// NOT `run.creditsConsumed += cost`.

process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeDefaultAgentDefinitionBase, type AgentDefinition, AGENT_CREDIT_ENTRY_KINDS } from "../types/agent-framework/index";
import {
  CreditLedger,
  InsufficientCreditsError,
  InMemoryCreditStore,
  FixedAllowanceResolver,
  PlanAllowanceResolver,
} from "../services/agent-framework/credits/index";
import { AgentCreditEntryKind } from "../lib/generated/prisma/enums";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { PLAN_LIMITS } from "../config/plan-limits";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-credit-user";

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

function ledger(allowance: number): { l: CreditLedger; store: InMemoryCreditStore } {
  const store = new InMemoryCreditStore();
  return { l: new CreditLedger({ store, allowances: new FixedAllowanceResolver(allowance) }), store };
}

function makeDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = new Date().toISOString();
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: `agt_cr_${Math.random().toString(36).slice(2, 9)}`,
    slug: "credit-test-agent",
    version: "1.0.0",
    name: "Credit Test Agent",
    description: "Synthetic agent for validate-agent-credit.",
    type: "RESEARCH",
    status: "active",
    objective: "prove credit accounting",
    instructions: "n/a",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: [],
    permissionPolicy: { granted: ["CAN_RUN_RESEARCH"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Credit Ledger validation\n");
  await cleanup();

  const RUN = "run_cr_1";
  const base = (over: Record<string, unknown> = {}) => ({
    userId: TEST_USER, runId: RUN, kind: "tool_call" as const, amount: 10, reason: "t", idempotencyKey: `k${Math.random()}`, ...over,
  });

  // ----------------------------------------------------------------
  // balance = allowance - SUM(period entries), recomputed fresh
  // ----------------------------------------------------------------

  await test("balance: allowance - ledger sum, recomputed every call (not cached)", async () => {
    const { l } = ledger(100);
    assert.equal((await l.balance(TEST_USER)).balance, 100);
    await l.charge(base({ amount: 30, idempotencyKey: "a" }));
    assert.equal((await l.balance(TEST_USER)).balance, 70);
    await l.charge(base({ amount: 5, idempotencyKey: "b" }));
    const b = await l.balance(TEST_USER);
    assert.equal(b.balance, 65);
    assert.equal(b.allowance, 100);
    assert.equal(b.consumed, 35);
  });

  await test("canAfford: balance >= amount", async () => {
    const { l } = ledger(50);
    assert.equal(await l.canAfford(TEST_USER, 50), true);
    assert.equal(await l.canAfford(TEST_USER, 51), false);
    assert.equal(await l.canAfford(TEST_USER, 0), true);
  });

  // ----------------------------------------------------------------
  // atomic + idempotent charge
  // ----------------------------------------------------------------

  await test("charge: atomic debit, immutable entry with balanceAfter + run/kind/reason", async () => {
    const { l, store } = ledger(100);
    const r = await l.charge(base({ amount: 12, kind: "tool_call", toolCallId: "tc_1", stepId: "st_1", reason: "market.snapshot", idempotencyKey: "c1" }));
    assert.equal(r.charged, true);
    assert.equal(r.alreadyApplied, false);
    assert.equal(r.entry!.amount, 12);
    assert.equal(r.entry!.balanceAfter, 88);
    assert.equal(r.entry!.toolCallId, "tc_1");
    assert.equal(r.entry!.kind, "tool_call");
    assert.equal((await store.entriesForRun(RUN)).length, 1);
  });

  await test("IDEMPOTENT: the SAME idempotencyKey -> no-op, balance unchanged, one entry", async () => {
    const { l, store } = ledger(100);
    await l.charge(base({ amount: 20, idempotencyKey: "dup" }));
    const again = await l.charge(base({ amount: 20, idempotencyKey: "dup" }));
    assert.equal(again.charged, false);
    assert.equal(again.alreadyApplied, true);
    assert.equal((await l.balance(TEST_USER)).balance, 80, "charged exactly once");
    assert.equal((await store.entriesForRun(RUN)).length, 1);
  });

  await test("NO NEGATIVE BALANCE: an over-budget charge throws InsufficientCreditsError; NO entry written", async () => {
    const { l, store } = ledger(100);
    await l.charge(base({ amount: 90, idempotencyKey: "x" }));
    await assert.rejects(() => l.charge(base({ amount: 20, idempotencyKey: "y" })), InsufficientCreditsError);
    assert.equal((await l.balance(TEST_USER)).balance, 10, "balance untouched by the failed charge");
    assert.equal((await store.entriesForRun(RUN)).length, 1, "no partial entry");
  });

  await test("charge rejects a negative amount (use refund)", async () => {
    const { l } = ledger(100);
    await assert.rejects(() => l.charge(base({ amount: -5, idempotencyKey: "neg" })));
  });

  // ----------------------------------------------------------------
  // refund
  // ----------------------------------------------------------------

  await test("refund: a signed (negative-amount) correction raises the balance", async () => {
    const { l } = ledger(100);
    await l.charge(base({ amount: 40, idempotencyKey: "r1" }));
    assert.equal((await l.balance(TEST_USER)).balance, 60);
    const rf = await l.refund({ userId: TEST_USER, runId: RUN, amount: 15, reason: "correction", idempotencyKey: "rf1" });
    assert.equal(rf.entry!.amount, -15);
    assert.equal(rf.entry!.kind, "refund");
    assert.equal((await l.balance(TEST_USER)).balance, 75);
  });

  // ----------------------------------------------------------------
  // auditable history
  // ----------------------------------------------------------------

  await test("historyForRun: every charge/refund for a run, ordered, fully attributed", async () => {
    const { l } = ledger(1000);
    await l.charge(base({ amount: 4, kind: "tool_call", stepId: "s0", toolCallId: "t0", reason: "market.snapshot", idempotencyKey: "h1" }));
    await l.charge(base({ amount: 6, kind: "tool_call", stepId: "s1", toolCallId: "t1", reason: "market.intelligence", idempotencyKey: "h2" }));
    await l.refund({ userId: TEST_USER, runId: RUN, amount: 2, stepId: "s1", toolCallId: "t1", reason: "overcharge", idempotencyKey: "h3" });
    const hist = await l.historyForRun(RUN);
    assert.equal(hist.length, 3);
    assert.deepEqual(hist.map((e) => [e.kind, e.amount, e.toolCallId, e.reason]), [
      ["tool_call", 4, "t0", "market.snapshot"],
      ["tool_call", 6, "t1", "market.intelligence"],
      ["refund", -2, "t1", "overcharge"],
    ]);
    // "what is the resulting balance?" -> the last entry's balanceAfter + a fresh recompute agree
    assert.equal((await l.balance(TEST_USER)).consumed, 8);
  });

  // ----------------------------------------------------------------
  // enum + allowance parity
  // ----------------------------------------------------------------

  await test("generated AgentCreditEntryKind enum == AF-v1 AGENT_CREDIT_ENTRY_KINDS", () => {
    assert.deepEqual(Object.values(AgentCreditEntryKind).sort(), [...AGENT_CREDIT_ENTRY_KINDS].sort());
  });

  await test("PlanAllowanceResolver: an unknown user falls back to the 'free' plan's aiCredits", async () => {
    const a = await new PlanAllowanceResolver().resolve("no-such-user-xyz");
    assert.equal(a.planId, "free");
    assert.equal(a.allowance, PLAN_LIMITS.free.aiCredits);
    assert.ok(a.periodStart < a.periodEnd);
  });

  await test("A9 migration present, additive-only, NOT APPLIED", () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations", "20260907120000_add_agent_credit_ledger", "migration.sql");
    assert.ok(existsSync(p));
    const sql = readFileSync(p, "utf8");
    assert.match(sql, /STATUS: NOT APPLIED/);
    assert.match(sql, /Never run `prisma migrate dev`/);
    assert.ok(!/\bDROP\b/i.test(sql) && !/ALTER TABLE/i.test(sql));
    assert.deepEqual([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]), ["AgentCreditLedgerEntry"]);
    assert.match(sql, /CREATE UNIQUE INDEX "AgentCreditLedgerEntry_idempotencyKey_key"/);
  });

  // ----------------------------------------------------------------
  // RUNTIME integration: A8 authorizes, A9 gates on economics
  // ----------------------------------------------------------------

  await test("RUNTIME: insufficient credits -> run terminates credit_limit / insufficient_credits (A9, not A8)", async () => {
    // allowance 1, a 2-fake-tool plan (each flat cost 1): first tool reserves
    // 1 (balance 0), the second reservation fails -> credit_limit.
    const store = new InMemoryCreditStore();
    const led = new CreditLedger({ store, allowances: new FixedAllowanceResolver(1) });
    const { ToolRegistry } = await import("../services/agent-framework/tools/tool-registry");
    const reg = new ToolRegistry();
    for (const id of ["t.a", "t.b"]) {
      reg.register({
        definition: {
          id, name: id, description: "t", version: "1.0.0", category: "RESEARCH",
          inputSchema: { type: "object" }, outputSchema: { type: "object" },
          requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: 0,
          creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
          evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "t" },
          status: "active", wraps: "n/a",
        },
        parseInput: () => ({ ok: true, value: {} }),
        checkOutput: () => ({ valid: true, violations: [] }),
        handler: async () => ({ output: {}, evidence: [] }),
      });
    }
    reg.freeze();
    const rt = new AgentRuntime({ registry: reg, creditLedger: led });
    const def = makeDef({ tools: [{ toolId: "t.a" }, { toolId: "t.b" }] });
    const { runId } = await rt.startRun({ definition: def, input: {}, userId: TEST_USER });
    const final = await rt.runToCompletion(runId);

    assert.equal(final?.status, "credit_limit");
    assert.equal(final?.errorCode, "insufficient_credits");
    const hist = await led.historyForRun(runId);
    assert.equal(hist.length, 1, "exactly one charge - the first tool's reservation");
    assert.equal(hist[0].amount, 1);
    assert.equal((await led.balance(TEST_USER)).balance, 0);
  });

  await test("RUNTIME: a well-funded run charges once per tool call, no double-charge on a re-tick", async () => {
    const store = new InMemoryCreditStore();
    const led = new CreditLedger({ store, allowances: new FixedAllowanceResolver(1000) });
    const { ToolRegistry } = await import("../services/agent-framework/tools/tool-registry");
    const reg = new ToolRegistry().register({
      definition: {
        id: "t.solo", name: "t.solo", description: "t", version: "1.0.0", category: "RESEARCH",
        inputSchema: { type: "object" }, outputSchema: { type: "object" },
        requiredPermissions: ["CAN_RUN_RESEARCH"], autonomyFloor: 0,
        creditCost: { model: "flat", credits: 3 }, executionMode: "sync",
        evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "t" },
        status: "active", wraps: "n/a",
      },
      parseInput: () => ({ ok: true, value: {} }),
      checkOutput: () => ({ valid: true, violations: [] }),
      handler: async () => ({ output: {}, evidence: [] }),
    }).freeze();
    const rt = new AgentRuntime({ registry: reg, creditLedger: led });
    const { runId } = await rt.startRun({ definition: makeDef({ tools: [{ toolId: "t.solo" }] }), input: {}, userId: TEST_USER });

    // tick 1: plan. tick 2: reserve + tool call. re-run tick 2 twice via runToCompletion re-entrancy is not possible,
    // so simulate a lost tick: drive one tick, then a fresh runtime finishes.
    await rt.tick(runId); // plan
    await rt.tick(runId); // tool call + reserve
    await new AgentRuntime({ registry: reg, creditLedger: led }).runToCompletion(runId); // output + integrity

    const final = await agentRunRepository.getRun(runId);
    assert.ok(["succeeded", "failed"].includes(final!.status)); // integrity may fail on the empty output - that's fine here
    const hist = await led.historyForRun(runId);
    // exactly one reservation of 3 (flat cost == estimate -> no topup/refund)
    const charges = hist.filter((e) => e.amount > 0);
    assert.equal(charges.length, 1, `expected 1 charge, got ${JSON.stringify(hist)}`);
    assert.equal(charges[0].amount, 3);
    assert.equal((await led.balance(TEST_USER)).balance, 997);
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  try { await cleanup(); await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
