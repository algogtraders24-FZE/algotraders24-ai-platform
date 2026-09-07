// scripts/validate-agent-supervisor.ts
// Sprint AN, step A5 - Supervisor / Orchestrator (G05... target: G04 follow-on).
//
// Run: npm run validate:agent-supervisor
//   (node --env-file so the end-to-end test can reach real market data)
//
// Proves:
//   - deterministic planning FIRST (no LLM), specialist selection by type
//   - the LLM-assist boundary: a proposer may only reorder/select tools the
//     agent is ALREADY bound to; everything else is rejected by
//     validateProposedPlan; a proposer failure falls back to deterministic
//   - the LLM never gains execution authority (structural)
//   - end to end via the real runtime: "Analyze XAUUSD ... bullish or bearish"
//     -> Supervisor -> Market Intelligence specialist -> market.intelligence
//     [REAL deterministic pipeline] -> evidence -> structured conclusion
//   - the conclusion is decision-support only: no entry/stop/target/size/signal

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeDefaultAgentDefinitionBase, type AgentDefinition } from "../types/agent-framework/index";
import {
  SupervisorService,
  parseGoal,
  selectSpecialist,
  validateProposedPlan,
  parseProposedPlan,
  type PlanProposer,
  type ProposedPlan,
} from "../services/agent-framework/supervisor/index";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-supervisor-user";
const registry = buildToolRegistry();

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

function makeDef(over: Partial<AgentDefinition> = {}): AgentDefinition {
  const now = new Date().toISOString();
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: `agt_sup_${Math.random().toString(36).slice(2, 9)}`,
    slug: "supervisor-test-agent",
    version: "1.0.0",
    name: "Supervisor Test Agent",
    description: "Synthetic agent for validate-agent-supervisor.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective: "Prove supervisor planning.",
    instructions: "Plan within bound tools; synthesise a decision-support conclusion.",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: [{ toolId: "market.snapshot" }, { toolId: "market.intelligence" }],
    permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
    autonomyLevel: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const CTX = { userId: TEST_USER, runId: "test-run" };
const FORBIDDEN_KEYS = ["entry", "entryzone", "stoploss", "stop_loss", "takeprofit", "take_profit", "target", "positionsize", "position_size", "signal", "buysignal", "sellsignal"];
const FORBIDDEN_TEXT = [/\bbuy\b/i, /\bsell\b/i, /win[- ]?rate/i, /probability of profit/i, /\d+%\s*(chance|probability)/i];

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Supervisor validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // goal interpretation
  // ----------------------------------------------------------------

  await test("parseGoal: extracts symbol; single-instrument analysis is NOT complex", () => {
    const g = parseGoal("Analyze XAUUSD and determine whether current conditions support a bullish or bearish setup.");
    assert.equal(g.symbol, "XAUUSD");
    assert.equal(g.isComplex, false, "a standard single-instrument analysis is handled deterministically");
    const s = parseGoal({ symbol: "eurusd", question: "outlook?" });
    assert.equal(s.symbol, "EURUSD");
    assert.equal(s.isComplex, false);
    assert.equal(parseGoal("what about gold").symbol, "XAUUSD");
    // genuinely multi-step goals ARE complex
    assert.equal(parseGoal("Analyze XAUUSD and then compare it against EURUSD structure and run a backtest").isComplex, true);
  });

  // ----------------------------------------------------------------
  // specialist selection
  // ----------------------------------------------------------------

  await test("specialist selection: registered types -> their specialist; others -> generic", () => {
    assert.equal(selectSpecialist("MARKET_INTELLIGENCE").key, "MARKET_INTELLIGENCE");
    assert.equal(selectSpecialist("RESEARCH").key, "RESEARCH"); // A11
    assert.equal(selectSpecialist("RISK").key, "generic"); // no specialist yet
    assert.equal(selectSpecialist("nonsense").key, "generic");
  });

  // ----------------------------------------------------------------
  // deterministic planning FIRST
  // ----------------------------------------------------------------

  await test("deterministic plan (no LLM): market-intelligence orders snapshot -> intelligence", async () => {
    const sup = new SupervisorService({ registry, llmAssist: false });
    const plan = await sup.plan(
      makeDef(),
      { question: "Analyze XAUUSD and determine whether conditions support a bullish or bearish setup", symbol: "XAUUSD" },
      CTX,
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["market.snapshot", "market.intelligence"]);
    assert.equal(plan.planMetadata?.specialist, "MARKET_INTELLIGENCE");
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
    // market.intelligence request carries the shaped goal input
    const intel = plan.requests.find((r) => r.toolId === "market.intelligence")!;
    assert.equal((intel.input as { symbol?: string }).symbol, "XAUUSD");
  });

  await test("deterministic plan: generic specialist walks bound tools in binding order", async () => {
    const sup = new SupervisorService({ registry, llmAssist: false });
    const plan = await sup.plan(
      makeDef({ type: "RISK", tools: [{ toolId: "market.intelligence" }, { toolId: "market.snapshot" }] }),
      { symbol: "XAUUSD" },
      CTX,
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["market.intelligence", "market.snapshot"]);
    assert.equal(plan.planMetadata?.specialist, "generic");
  });

  // ----------------------------------------------------------------
  // LLM-assist boundary
  // ----------------------------------------------------------------

  const fakeProposer = (steps: { toolId: string; reason?: string }[]): PlanProposer => ({
    async propose(): Promise<ProposedPlan> {
      return { steps };
    },
  });

  await test("LLM-assist: a valid proposal (reorder of bound tools) is used", async () => {
    const sup = new SupervisorService({
      registry,
      llmAssist: true,
      proposer: fakeProposer([{ toolId: "market.intelligence" }, { toolId: "market.snapshot" }]),
    });
    const plan = await sup.plan(
      makeDef(),
      { question: "Analyze XAUUSD and then compare it against recent structure to judge bullish or bearish", symbol: "XAUUSD" },
      CTX,
    );
    assert.equal(plan.planMetadata?.planningPath, "llm-assisted");
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["market.intelligence", "market.snapshot"]);
  });

  await test("LLM-assist boundary: an UNBOUND tool in the proposal is rejected -> deterministic fallback", async () => {
    const sup = new SupervisorService({
      registry,
      llmAssist: true,
      proposer: fakeProposer([{ toolId: "backtest.run" }, { toolId: "portfolio.read" }]),
    });
    const plan = await sup.plan(
      makeDef(),
      { question: "Analyze XAUUSD and then also run a strategy comparison for bullish or bearish", symbol: "XAUUSD" },
      CTX,
    );
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["market.snapshot", "market.intelligence"]);
    const rejected = plan.planMetadata?.llmRejected as { toolId: string }[];
    assert.ok(rejected.some((r) => r.toolId === "backtest.run"));
  });

  await test("LLM-assist: a proposer that throws falls back to deterministic (planning never fails)", async () => {
    const sup = new SupervisorService({
      registry,
      llmAssist: true,
      proposer: { async propose() { throw new Error("provider down"); } },
    });
    const plan = await sup.plan(
      makeDef(),
      { question: "Analyze XAUUSD and then judge bullish or bearish after comparing structure", symbol: "XAUUSD" },
      CTX,
    );
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
    assert.equal(plan.requests.length, 2);
  });

  await test("validateProposedPlan: rejects unbound / unknown / unpermitted / autonomy-floor / duplicate", () => {
    const def = makeDef({ permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] }, autonomyLevel: 1 });
    const goal = parseGoal({ symbol: "XAUUSD" });
    const bound = ["market.snapshot", "market.intelligence"];
    const v = validateProposedPlan(
      {
        steps: [
          { toolId: "market.snapshot" },        // ok
          { toolId: "market.snapshot" },        // duplicate
          { toolId: "backtest.run" },           // unbound
          { toolId: "totally.made.up" },        // unknown (also unbound)
        ],
      },
      def,
      goal,
      bound,
      registry,
    );
    assert.deepEqual(v.requests.map((r) => r.toolId), ["market.snapshot"]);
    const reasons = Object.fromEntries(v.rejected.map((r) => [r.toolId, r.reason]));
    assert.match(reasons["market.snapshot"], /duplicate/);
    assert.match(reasons["backtest.run"], /not bound/);
  });

  await test("parseProposedPlan: strips code fences + prose, tolerates garbage", () => {
    assert.deepEqual(
      parseProposedPlan('```json\n{"steps":[{"toolId":"market.snapshot","reason":"x"}]}\n```').steps.map((s) => s.toolId),
      ["market.snapshot"],
    );
    assert.deepEqual(parseProposedPlan("here is the plan: {\"steps\":[]} thanks").steps, []);
    assert.deepEqual(parseProposedPlan("not json at all").steps, []);
  });

  // ----------------------------------------------------------------
  // structural: LLM never executes
  // ----------------------------------------------------------------

  await test("structural: only plan-proposer touches lib/ai, and no supervisor file imports the executor", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "agent-framework", "supervisor");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith(".ts")) files.push(join(d, e.name));
      }
    };
    walk(dir);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const base = f.split(/[/\\]/).pop()!;
      const importLines = src.split("\n").filter((l) => /^\s*import\b|await import\(/.test(l));
      if (base !== "plan-proposer.ts") {
        assert.ok(!importLines.some((l) => l.includes("lib/ai")), `${base} must not import lib/ai (only plan-proposer may)`);
      }
      assert.ok(!importLines.some((l) => /tool-gateway|invokeTool/.test(l)), `${base} must not import the executor`);
      assert.ok(!src.includes('"use client"'), `${base} must be server-only`);
    }
    // and plan-proposer's lib/ai import is a lazy dynamic import
    const pp = readFileSync(join(dir, "plan-proposer.ts"), "utf8");
    assert.match(pp, /await import\(["']@\/lib\/ai["']\)/);
  });

  // ----------------------------------------------------------------
  // end to end via the real runtime  (owner's A5 proof)
  // ----------------------------------------------------------------

  await test("E2E: 'Analyze XAUUSD ... bullish or bearish' -> Supervisor -> MI specialist -> conclusion", async () => {
    const runtime = new AgentRuntime(); // production Supervisor + registry
    const { runId } = await runtime.startRun({
      definition: makeDef(),
      input: {
        question: "Analyze XAUUSD and determine whether current conditions support a bullish or bearish setup.",
        symbol: "XAUUSD",
      },
      userId: TEST_USER,
    });
    const final = await runtime.runToCompletion(runId);
    const trace = await agentRunRepository.getRunTrace(runId);

    const planStep = trace.steps.find((s) => s.kind === "plan")!;
    assert.equal((planStep.output as { planMetadata?: { specialist?: string } }).planMetadata?.specialist, "MARKET_INTELLIGENCE");

    assert.ok(["succeeded", "tool_error"].includes(final!.status), `status ${final!.status}`);

    if (final!.status === "succeeded") {
      const toolIds = trace.toolCalls.map((tc) => tc.toolId);
      assert.deepEqual(toolIds, ["market.snapshot", "market.intelligence"], "planned + executed in MI order");
      const out = final!.output as Record<string, unknown>;
      assert.equal(out.kind, "market-intelligence-conclusion");
      assert.ok(["bullish-leaning", "bearish-leaning", "neutral"].includes(out.bias as string), `bias ${String(out.bias)}`);
      assert.ok(typeof out.disclaimer === "string" && (out.disclaimer as string).includes("Decision support only"));
      assert.ok(Array.isArray(out.evidenceIds));

      // GOVERNANCE: not a signal - no forbidden keys, no forbidden language
      const json = JSON.stringify(out);
      for (const k of Object.keys(out)) {
        assert.ok(!FORBIDDEN_KEYS.includes(k.toLowerCase()), `output must not contain a "${k}" key`);
      }
      for (const re of FORBIDDEN_TEXT) {
        // the disclaimer legitimately says "not a trade recommendation" etc; check the non-disclaimer part
        const withoutDisclaimer = json.replace(JSON.stringify(out.disclaimer), '""');
        assert.ok(!re.test(withoutDisclaimer), `output must not contain ${re}`);
      }
      if (out.resolved === true) {
        assert.ok(out.regimeType, "a resolved conclusion names the deterministic regime");
        assert.ok(Number.isFinite(trace.evidence.length) && trace.evidence.length >= 1);
        console.log(`      -> ${out.symbol}: ${out.bias} (regime ${out.regimeType}), ${trace.evidence.length} evidence`);
      } else {
        console.log(`      -> unresolved intelligence context (${out.reason}); conclusion is neutral + honest`);
      }
    } else {
      console.log(`      -> provider unavailable: clean tool_error, trace intact`);
    }
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
