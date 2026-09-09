// scripts/validate-automation-workflow-validation.ts
// AT24 Automation (MVP) - workflow definition + trigger validation.
//
// House style, pure/in-memory (no DB, no network). Run via
// `npm run validate:automation-workflow-validation`.
//
// Covers AUTOMATION_TEST_PLAN.md §1 "validate-automation-workflow-validation"
// and "validate-automation-trigger-validation".

import assert from "node:assert/strict";
import { validateWorkflowDefinition } from "../services/automation/workflow-validator";

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

const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();

function agentStep(id = "s1", agentType = "MARKET_INTELLIGENCE"): Record<string, unknown> {
  return { id, kind: "agent_run", action: { agentType, input: { symbol: "XAUUSD" } } };
}

function baseDef(over: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    trigger: { type: "manual", timezone: "Asia/Kolkata" },
    steps: [agentStep()],
    ...over,
  };
}

function expectOk(raw: unknown, msg: string): void {
  const r = validateWorkflowDefinition(raw);
  assert.equal(r.ok, true, `${msg} - issues: ${JSON.stringify(r.issues)}`);
}
function expectFail(raw: unknown, pathContains: string, msg: string): void {
  const r = validateWorkflowDefinition(raw);
  assert.equal(r.ok, false, `${msg} - expected failure`);
  assert.ok(
    r.issues.some((i) => i.path.includes(pathContains)),
    `${msg} - expected an issue on "${pathContains}", got ${JSON.stringify(r.issues)}`,
  );
}

async function main(): Promise<void> {
  console.log("validate-automation-workflow-validation\n");

  test("valid minimal manual definition", () => expectOk(baseDef(), "minimal"));

  test("valid full definition (all 4 step kinds)", () =>
    expectOk(
      baseDef({
        trigger: { type: "weekly", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: ["MON", "WED", "FRI"] },
        steps: [
          agentStep("s1", "MARKET_INTELLIGENCE"),
          { id: "s2", kind: "condition", condition: { left: "$.steps.s1.confidence", op: "gte", right: 0.75 } },
          agentStep("s3", "RESEARCH"),
          { id: "s4", kind: "publication_draft", action: { category: "gold-analysis", keywordsFrom: "$.steps.s3.keywords" } },
          { id: "s5", kind: "workspace_save", action: { title: "Brief", from: "$.steps.s3.result" } },
        ],
      }),
      "full",
    ));

  test("schemaVersion must be 1", () => expectFail(baseDef({ schemaVersion: 2 } as never), "$.schemaVersion", "schemaVersion"));

  test("0 steps rejected", () => expectFail(baseDef({ steps: [] }), "$.steps", "empty"));
  test("9 steps rejected", () =>
    expectFail(baseDef({ steps: Array.from({ length: 9 }, (_, i) => agentStep(`s${i}`)) as never }), "$.steps", "too many"));

  test("duplicate step ids rejected", () =>
    expectFail(baseDef({ steps: [agentStep("s1"), agentStep("s1")] as never }), "id", "dup id"));

  test("first step is condition rejected", () =>
    expectFail(
      baseDef({ steps: [{ id: "s1", kind: "condition", condition: { left: "$.trigger.type", op: "eq", right: "daily" } }] as never }),
      "$.steps[0]",
      "first condition",
    ));

  test("adjacent conditions rejected", () =>
    expectFail(
      baseDef({
        steps: [
          agentStep("s1"),
          { id: "s2", kind: "condition", condition: { left: "$.steps.s1.a", op: "gte", right: 1 } },
          { id: "s3", kind: "condition", condition: { left: "$.steps.s1.b", op: "gte", right: 1 } },
        ] as never,
      }),
      "$.steps[2]",
      "adjacent",
    ));

  test("unknown agentType rejected", () =>
    expectFail(baseDef({ steps: [agentStep("s1", "TOTALLY_FAKE")] as never }), "agentType", "bad agent"));

  test("bad publication category rejected", () =>
    expectFail(
      baseDef({ steps: [agentStep("s1"), { id: "s2", kind: "publication_draft", action: { category: "not-a-category" } }] as never }),
      "category",
      "bad category",
    ));

  test("forward step reference rejected", () =>
    expectFail(
      baseDef({
        steps: [
          { id: "s1", kind: "condition", condition: { left: "$.steps.s2.x", op: "gte", right: 1 } },
          agentStep("s2"),
        ] as never,
      }),
      "condition.left",
      "forward ref",
    ));

  test("wildcard path rejected", () =>
    expectFail(
      baseDef({
        steps: [agentStep("s1"), { id: "s2", kind: "condition", condition: { left: "$.steps.*.x", op: "gte", right: 1 } }] as never,
      }),
      "condition.left",
      "wildcard",
    ));

  test("bad condition op rejected", () =>
    expectFail(
      baseDef({
        steps: [agentStep("s1"), { id: "s2", kind: "condition", condition: { left: "$.steps.s1.x", op: "between", right: 1 } }] as never,
      }),
      "condition.op",
      "bad op",
    ));

  test("oversize definition rejected", () => {
    const big = baseDef({ steps: [agentStep("s1")] });
    (big as { metadata: unknown }).metadata = { blob: "x".repeat(20000) };
    expectFail(big, "$", "oversize");
  });

  // ── trigger validation ──
  test("daily needs a valid slot", () =>
    expectFail(baseDef({ trigger: { type: "daily", timezone: "Asia/Kolkata" } as never }), "$.trigger.slot", "daily no slot"));

  test("daily with unknown slot rejected", () =>
    expectFail(baseDef({ trigger: { type: "daily", timezone: "Asia/Kolkata", slot: "3am" } as never }), "$.trigger.slot", "bad slot"));

  test("daily with valid slot ok", () =>
    expectOk(baseDef({ trigger: { type: "daily", timezone: "Asia/Kolkata", slot: "morning_ist" } as never }), "daily ok"));

  test("weekly needs non-empty daysOfWeek", () =>
    expectFail(
      baseDef({ trigger: { type: "weekly", timezone: "Asia/Kolkata", slot: "evening_ist", daysOfWeek: [] } as never }),
      "$.trigger.daysOfWeek",
      "weekly no days",
    ));

  test("weekly with bad weekday code rejected", () =>
    expectFail(
      baseDef({ trigger: { type: "weekly", timezone: "Asia/Kolkata", slot: "evening_ist", daysOfWeek: ["FUNDAY"] } as never }),
      "$.trigger.daysOfWeek",
      "bad day",
    ));

  test("once with past runAt rejected", () =>
    expectFail(
      baseDef({ trigger: { type: "once", timezone: "Asia/Kolkata", slot: "morning_ist", runAt: "2000-01-01T00:00:00Z" } as never }),
      "$.trigger.runAt",
      "past runAt",
    ));

  test("once with future runAt ok", () =>
    expectOk(
      baseDef({ trigger: { type: "once", timezone: "Asia/Kolkata", slot: "morning_ist", runAt: FUTURE } as never }),
      "future runAt",
    ));

  test("invalid IANA timezone rejected", () =>
    expectFail(baseDef({ trigger: { type: "manual", timezone: "Mars/Olympus" } as never }), "$.trigger.timezone", "bad tz"));

  test("scheduled trigger with non-IST timezone rejected (Beta)", () =>
    expectFail(
      baseDef({ trigger: { type: "daily", timezone: "America/New_York", slot: "morning_ist" } as never }),
      "$.trigger.timezone",
      "non-IST scheduled",
    ));

  test("daysOfWeek on a daily trigger rejected", () =>
    expectFail(
      baseDef({ trigger: { type: "daily", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: ["MON"] } as never }),
      "$.trigger.daysOfWeek",
      "days on daily",
    ));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
