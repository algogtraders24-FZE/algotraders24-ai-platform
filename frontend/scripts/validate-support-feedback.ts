// scripts/validate-support-feedback.ts
// AT24 Copilot Phase 4: thumbs feedback + quick-reply chips.
// Run: npm run validate:support-feedback   (real DB for the service tests; nothing outside AgentRun rows)
process.env.AGENT_CREDIT_INMEMORY = "1";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { runSupportAgent } from "../services/agent-framework/agents/support-agent";
import { recordSupportFeedback, isFeedbackValue, FeedbackNotAllowedError } from "../services/support/feedback";
import { COPILOT_QUICK_REPLIES } from "../components/support/QuickReplies";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";

const USER_A = `validate-support-feedback-a-${process.pid}-${Date.now().toString(36)}`;
const USER_B = `validate-support-feedback-b-${process.pid}-${Date.now().toString(36)}`;
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL - ${name}\n    ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

function fakeKb(): ToolImplementation<Record<string, never>, { hits: unknown[]; available: boolean }> {
  return {
    definition: {
      id: "support.knowledge_search", name: "support.knowledge_search", description: "fake", version: "1.0.0",
      category: "SUPPORT", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_SUPPORT"], autonomyFloor: 0, creditCost: { model: "flat", credits: 1 },
      executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["research_document"], provenanceProducer: "fake-support" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => ({ output: { hits: [], available: true }, evidence: [] }),
  };
}

async function supportRun(userId: string) {
  const registry = new ToolRegistry().register(fakeKb()).freeze();
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  const final = await runSupportAgent({ userId, goal: { question: "feedback fixture question" }, runtime: rt });
  assert.equal(final?.status, "succeeded");
  return final!;
}

async function main(): Promise<void> {
  console.log("\nAT24 Copilot Phase 4 - feedback and quick replies\n");
  await agentRunRepository._deleteRunsForUser(USER_A);
  await agentRunRepository._deleteRunsForUser(USER_B);

  await test("value check: only 'up' and 'down' are accepted", () => {
    assert.equal(isFeedbackValue("up"), true);
    assert.equal(isFeedbackValue("down"), true);
    for (const v of ["", "UP", "like", 1, null, undefined, {}]) assert.equal(isFeedbackValue(v), false);
  });

  await test("feedback: the owner can rate a SUPPORT answer; it is stored on the run and the run's other metadata survives", async () => {
    const run = await supportRun(USER_A);
    const before = (await agentRunRepository.getRunForUser(run.id, USER_A))!.metadata as Record<string, unknown>;
    const fb = await recordSupportFeedback(USER_A, run.id, "up");
    assert.equal(fb?.value, "up");
    const after = (await agentRunRepository.getRunForUser(run.id, USER_A))!.metadata as Record<string, unknown>;
    assert.equal((after.feedback as { value: string }).value, "up");
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `metadata.${key} must be preserved`);
  });

  await test("feedback: the rating can be changed (last one wins)", async () => {
    const run = await supportRun(USER_A);
    await recordSupportFeedback(USER_A, run.id, "up");
    await recordSupportFeedback(USER_A, run.id, "down");
    const m = (await agentRunRepository.getRunForUser(run.id, USER_A))!.metadata as { feedback?: { value: string } };
    assert.equal(m.feedback?.value, "down");
  });

  await test("isolation: another user cannot rate someone else's answer (null, nothing written)", async () => {
    const run = await supportRun(USER_A);
    const res = await recordSupportFeedback(USER_B, run.id, "down");
    assert.equal(res, null);
    const m = (await agentRunRepository.getRunForUser(run.id, USER_A))!.metadata as { feedback?: unknown };
    assert.equal(m.feedback, undefined);
  });

  await test("an unknown run id returns null", async () => {
    assert.equal(await recordSupportFeedback(USER_A, "does-not-exist", "up"), null);
  });

  await test("only SUPPORT runs can be rated", async () => {
    const run = await supportRun(USER_A);
    const row = (await agentRunRepository.getRunForUser(run.id, USER_A))!;
    const meta = (row.metadata ?? {}) as Record<string, unknown> & { definition?: Record<string, unknown> };
    await agentRunRepository.patchRun(run.id, { metadata: { ...meta, definition: { ...(meta.definition ?? {}), type: "RESEARCH" } } });
    await assert.rejects(() => recordSupportFeedback(USER_A, run.id, "up"), FeedbackNotAllowedError);
  });

  await test("route: authenticates first, takes userId from the session, validates runId and value", () => {
    const src = readFileSync(join(ROOT, "app", "api", "private", "support", "feedback", "route.ts"), "utf8");
    assert.ok(src.indexOf("getUserOrNull()") > -1 && src.indexOf("getUserOrNull()") < src.indexOf("req.json()"));
    assert.match(src, /sessionUser\.profile\.id/);
    assert.match(src, /isFeedbackValue\(body\.value\)/);
    assert.doesNotMatch(src, /body[^;\n]*userId/i);
  });

  await test("quick replies: five chips, each with a label and a real question, including a way to reach a person", () => {
    assert.equal(COPILOT_QUICK_REPLIES.length, 5);
    for (const c of COPILOT_QUICK_REPLIES) assert.ok(c.label.length > 0 && c.question.length > 10);
    assert.ok(COPILOT_QUICK_REPLIES.some((c) => /person/i.test(c.label)));
  });

  await test("wiring: thumbs and chips appear in both the page and the widget", () => {
    for (const f of [join("app", "dashboard", "support", "page.tsx"), join("components", "support", "SupportWidget.tsx")]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.match(src, /<AnswerFeedback/, `${f} must render AnswerFeedback`);
      assert.match(src, /<QuickReplies/, `${f} must render QuickReplies`);
    }
  });

  await agentRunRepository._deleteRunsForUser(USER_A);
  await agentRunRepository._deleteRunsForUser(USER_B);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await agentRunRepository._deleteRunsForUser(USER_A);
    await agentRunRepository._deleteRunsForUser(USER_B);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
