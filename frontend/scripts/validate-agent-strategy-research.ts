// scripts/validate-agent-strategy-research.ts
// Sprint AN, step A13 - the Strategy Research Agent (G13 target).
//
// House style (node:assert/strict, tsx). Run: npm run validate:agent-strategy-research
//
// A13 adds a canonical AgentDefinition + a NEW specialist (planning +
// synthesis) + a thin entrypoint. It reuses the EXISTING backtest.run
// (-> algoTestService -> at24-quant-engine) + market.intelligence +
// AgentRuntime + A6/A8/A9/A10. NO second backtest engine, NO second strategy
// engine, NO execution engine, NO new persistence model.
//
// Proves (owner G12 boundary):
//   - valid AF-v1 STRATEGY_RESEARCH definition, autonomy 1, bound to
//     backtest.run + market.intelligence only
//   - deterministic plan backtest.run -> market.intelligence, NO LLM
//   - the brief keeps hypothesis / backtestResult / marketContext /
//     conclusion SEPARATE
//   - a positive backtest is NOT auto-promoted: no entry/stop/target/size/
//     side/signal field, no buy/sell language, notATradeRecommendation:true
//   - the raw goal text ("...buy...") never leaks into a scanned field
//   - per-trade rows (BUY/SELL sides) are NOT copied into the output
//   - resultHash / assumptions are surfaced verbatim as a RESULT
//   - evidence lineage complete, A6 integrity PASS, A10 evaluation persisted
//   - failed / empty / non-positive backtests are handled deterministically
//   - real-registry E2E (best-effort): clean terminal state either way

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateAgentDefinition,
  AGENT_EVALUATION_DIMENSIONS,
} from "../types/agent-framework/index";
import { isKnownAgentType, autonomyCapForType } from "../services/agent-framework/agent-type-registry";
import { selectSpecialist, SupervisorService } from "../services/agent-framework/supervisor/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import {
  strategyResearchAgentDefinition,
  runStrategyResearchAgent,
  STRATEGY_RESEARCH_AGENT_TOOL_IDS,
} from "../services/agent-framework/agents/strategy-research-agent";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

// Per-process unique so concurrent runs of this script (or a peer session
// running it against the same shared DB) never clobber each other's runs
// via cleanup() mid-execution.
const TEST_USER = `validate-agent-strategy-research-${process.pid}-${Date.now().toString(36)}`;
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

// ------------------------------------------------------------------
// Fakes for the two bound tools (same ids). The backtest fake returns an
// AlgoTestRunView-shaped payload, including per-trade rows with BUY/SELL
// sides - the specialist MUST drop those from the output.
// ------------------------------------------------------------------

function completedView(netProfit: number, tradeCount: number) {
  return {
    testId: "at_test_fake_1",
    status: "completed",
    strategyId: "golden",
    symbol: "XAUUSD",
    timeframe: "5m",
    startTime: "2026-08-25T00:00:00.000Z",
    endTime: "2026-09-07T00:00:00.000Z",
    initialBalance: 10000,
    resultHash: "sha256:deadbeefcafe",
    metrics: {
      totalReturn: netProfit / 10000, netProfit, grossProfit: Math.max(netProfit, 0) + 100, grossLoss: -100,
      profitFactor: netProfit > 0 ? 1.8 : 0.7, winRate: 0.52, expectancy: netProfit / Math.max(tradeCount, 1),
      maxDrawdown: -420, averageTrade: netProfit / Math.max(tradeCount, 1), tradeCount, averageR: 0.3, totalFees: 35,
    },
    trades: Array.from({ length: tradeCount }, (_, i) => ({
      tradeId: `t${i}`, symbol: "XAUUSD", side: i % 2 === 0 ? "BUY" : "SELL", quantity: 1,
      entryTime: 1, entryPrice: 2600, exitTime: 2, exitPrice: 2610, pnl: 10, grossPnl: 11, fees: 1, rMultiple: 0.5,
    })),
    equityCurve: [{ timestamp: 1, balance: 10000 }, { timestamp: 2, balance: 10000 + netProfit }],
    assumptions: { spread: "20 points fixed", slippage: "0", fees: "$7 per round turn", margin: "1:100" },
  };
}

const FAILED_VIEW = {
  testId: "at_test_fake_fail",
  status: "failed",
  strategyId: "golden",
  symbol: "XAUUSD",
  timeframe: "5m",
  startTime: "2026-08-25T00:00:00.000Z",
  endTime: "2026-09-07T00:00:00.000Z",
  initialBalance: 10000,
  errorCode: "NO_HISTORICAL_DATA",
  errorMessage: "no candles for the requested window",
};

function fakeBacktest(view: unknown): ToolImplementation<Record<string, never>, unknown> {
  return {
    definition: {
      id: "backtest.run", name: "backtest.run", description: "fake", version: "1.0.0", category: "BACKTEST",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_RUN_BACKTEST"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 8 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["backtest"], provenanceProducer: "at24-quant-engine" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      const v = view as { status?: string; testId?: string; metrics?: { netProfit?: number }; resultHash?: string };
      return {
        output: view,
        evidence: [{
          type: "backtest",
          claim: v.status === "completed"
            ? `XAUUSD golden 5m backtest: net ${v.metrics?.netProfit ?? "n/a"}`
            : "XAUUSD golden backtest failed",
          source: "at24-quant-engine", sourceId: v.testId ?? "unknown", timestamp: now,
          data: { status: v.status, resultHash: v.resultHash },
          relevance: 1, confidence: v.status === "completed" ? 0.95 : 0.5,
          provenance: { producer: "at24-quant-engine", retrievedAt: now, datasetId: "XAUUSD:5m" },
        }],
      };
    },
  };
}

const RESOLVED_INTEL = {
  status: "resolved",
  envelope: { symbol: "XAUUSD", timeframe: "5m", regime: { regimeType: "ranging", confidence: 0.5 }, pipelineVersion: "test-15D.x" },
};

function fakeIntel(ctx: unknown): ToolImplementation<Record<string, never>, unknown> {
  return {
    definition: {
      id: "market.intelligence", name: "market.intelligence", description: "fake", version: "1.0.0", category: "MARKET_DATA",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_MARKET_DATA"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 4 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["regime"], provenanceProducer: "fake-pipeline" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: ctx,
        evidence: (ctx as { status?: string }).status === "resolved"
          ? [{
              type: "regime", claim: "pipeline classified the current regime as ranging", source: "intelligence-pipeline",
              sourceId: "XAUUSD:5m:regime", timestamp: now, data: { regimeType: "ranging" },
              relevance: 0.6, confidence: 0.5, provenance: { producer: "fake-pipeline", retrievedAt: now },
            }]
          : [],
      };
    },
  };
}

function fakeRegistry(view: unknown, ctx: unknown = RESOLVED_INTEL): ToolRegistry {
  return new ToolRegistry().register(fakeBacktest(view)).register(fakeIntel(ctx)).freeze();
}

function harness(registry: ToolRegistry) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  return { rt, evaluation };
}

const FORBIDDEN_KEYS = ["entry", "entryzone", "entryprice", "stop", "stoploss", "sl", "takeprofit", "tp", "target", "targets", "positionsize", "size", "lotsize", "lots", "ordertype", "side", "direction", "signal", "buysignal", "sellsignal", "tradeaction", "action", "recommendation", "order", "trade"];
const FORBIDDEN_TEXT = [/\bbuy\b/i, /\bsell\b/i, /\bgo (?:long|short)\b/i, /\benter (?:a )?(?:long|short)\b/i, /win[- ]?rate/i, /probability of profit/i, /\d+\s*%\s*(?:chance|probability|win)/i, /\bguaranteed\b/i];

/** Walk every key + string value in an object graph. */
function* walk(node: unknown, path = ""): Generator<{ path: string; key: string; value: unknown }> {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      yield { path: p, key: k, value: v };
      yield* walk(v, p);
    }
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walk(node[i], `${path}[${i}]`);
  }
}

function assertNotASignal(out: Record<string, unknown>): void {
  const disclaimerText = typeof out.disclaimer === "string" ? out.disclaimer : "";
  for (const { path, key, value } of walk(out)) {
    assert.ok(!FORBIDDEN_KEYS.includes(key.toLowerCase()), `output must not contain a trade field "${path}"`);
    if (typeof value === "string" && !["disclaimer", "note", "notes"].includes(key.toLowerCase())) {
      for (const re of FORBIDDEN_TEXT) {
        assert.ok(!re.test(value), `output string "${path}" (${JSON.stringify(value).slice(0, 80)}) matches ${re}`);
      }
    }
  }
  assert.ok(disclaimerText.includes("not a trading recommendation"), "disclaimer states it is not a recommendation");
}

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.15 - Strategy Research Agent (A13) validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. definition
  // ----------------------------------------------------------------

  await test("strategyResearchAgentDefinition(): valid AF-v1, STRATEGY_RESEARCH, autonomy 1, backtest + intelligence", () => {
    const def = strategyResearchAgentDefinition();
    const res = validateAgentDefinition(def, { isRegisteredType: isKnownAgentType, autonomyCapForType });
    assert.equal(res.valid, true, JSON.stringify(res.violations));
    assert.equal(def.type, "STRATEGY_RESEARCH");
    assert.equal(def.autonomyLevel, 1);
    assert.deepEqual(def.tools.map((t) => t.toolId), [...STRATEGY_RESEARCH_AGENT_TOOL_IDS]);
    assert.ok(def.permissionPolicy.granted.includes("CAN_RUN_BACKTEST"));
    for (const p of def.permissionPolicy.granted) {
      assert.ok(p !== "CAN_CREATE_ORDER" && p !== "CAN_EXECUTE_ORDER" && p !== "CAN_GENERATE_SIGNAL", `must not hold ${p}`);
    }
  });

  await test("bound tools ARE registered; backtest.run wraps algoTestService -> at24-quant-engine (not a rebuild)", () => {
    const reg = buildToolRegistry();
    assert.ok(reg.has("backtest.run") && reg.has("market.intelligence"));
    assert.match(reg.describe("backtest.run").wraps, /algo-test|at24-quant-engine/i);
  });

  // ----------------------------------------------------------------
  // 2. deterministic planning
  // ----------------------------------------------------------------

  await test("STRATEGY_RESEARCH -> strategyResearchSpecialist; plan backtest.run -> market.intelligence, no LLM", async () => {
    assert.equal(selectSpecialist("STRATEGY_RESEARCH").key, "STRATEGY_RESEARCH");
    const sup = new SupervisorService({ registry: fakeRegistry(completedView(300, 8)), llmAssist: false });
    const plan = await sup.plan(
      strategyResearchAgentDefinition(),
      { question: "Should I buy XAUUSD with the golden strategy?", strategyId: "golden", symbol: "XAUUSD", timeframe: "5m" },
      { userId: TEST_USER, runId: "test-run" },
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["backtest.run", "market.intelligence"]);
    assert.equal(plan.planMetadata?.specialist, "STRATEGY_RESEARCH");
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
    // the backtest request carries a bounded, tool-scoped input
    const bt = plan.requests[0].input as Record<string, unknown>;
    assert.equal(bt.strategyId, "golden");
    assert.equal(bt.symbol, "XAUUSD");
    assert.equal(bt.timeframe, "5m");
    assert.ok(typeof bt.startTime === "string" && typeof bt.endTime === "string");
    assert.ok(Date.parse(bt.endTime as string) - Date.parse(bt.startTime as string) <= 14 * 864e5, "window <= 14 days");
  });

  await test("structural: A13 added no new infra; agent file + specialist import no backtest/strategy engine, no lib/ai, no executor", () => {
    const base = join(ROOT, "services", "agent-framework");
    const dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const CORE = ["authorization", "credits", "evaluation", "integrity", "memory", "runtime", "supervisor", "tools"];
    for (const d of CORE) assert.ok(dirs.includes(d), `core module "${d}" present`);
    assert.deepEqual(dirs.filter((d) => ![...CORE, "agents", "api"].includes(d)), [], "no unexpected new infrastructure dir");
    const agentsFiles = readdirSync(join(base, "agents")).sort();
    assert.ok(["market-intelligence-agent.ts", "research-agent.ts", "strategy-research-agent.ts"].every((f) => agentsFiles.includes(f)));
    assert.ok(agentsFiles.every((f) => f.endsWith("-agent.ts")), `agents/ holds only *-agent.ts, got ${agentsFiles.join(", ")}`);
    for (const f of [
      join(base, "agents", "strategy-research-agent.ts"),
      join(base, "supervisor", "specialists", "strategy-research.specialist.ts"),
    ]) {
      const importLines = readFileSync(f, "utf8").split("\n").filter((l) => /^\s*import\b|await import\(/.test(l));
      for (const bad of ["at24-quant-engine", "algo-test", "backtest-engine", "lib/ai", "tool-gateway", "RealTimeIntelligence"]) {
        assert.ok(!importLines.some((l) => l.includes(bad)), `${f.split(/[/\\]/).pop()} must not import "${bad}"`);
      }
    }
  });

  // ----------------------------------------------------------------
  // 3. E2E fake - positive backtest
  // ----------------------------------------------------------------

  await test("E2E (positive backtest): hypothesis / backtestResult / marketContext / conclusion SEPARATE; not auto-promoted", async () => {
    const { rt, evaluation } = harness(fakeRegistry(completedView(640, 9)));
    const final = await runStrategyResearchAgent({
      userId: TEST_USER,
      goal: { question: "Should I buy XAUUSD now with the golden strategy?", strategyId: "golden", symbol: "XAUUSD", timeframe: "5m" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.deepEqual(trace.toolCalls.map((t) => t.toolId), ["backtest.run", "market.intelligence"]);

    const out = final!.output as Record<string, unknown>;
    assert.equal(out.kind, "strategy-research-brief");
    assert.equal(out.resolved, true);
    assert.equal(out.notATradeRecommendation, true);

    // 1. HYPOTHESIS is a research question, and the raw "buy" goal text did NOT leak
    assert.equal(typeof out.hypothesis, "string");
    assert.match(out.hypothesis as string, /research question|warrants further research/i);
    assert.ok(!/\bbuy\b/i.test(out.hypothesis as string), "raw goal text must not leak into the hypothesis");

    // 2. BACKTEST RESULT - verbatim metrics + hash, NO per-trade rows (which carry BUY/SELL)
    const br = out.backtestResult as Record<string, unknown>;
    assert.equal(br.status, "completed");
    assert.equal(br.resultHash, "sha256:deadbeefcafe");
    assert.equal((br.metrics as Record<string, number>).netProfit, 640);
    assert.ok(!("trades" in br) && !("equityCurve" in br), "per-trade rows must not be copied into the brief");

    // 3. MARKET CONTEXT - separate, labelled as context
    const mc = out.marketContext as Record<string, unknown>;
    assert.equal(mc.regimeType, "ranging");
    assert.match(mc.note as string, /not part of the historical backtest/i);

    // 4. CONCLUSION - bounded research interpretation, explicitly not proof / not a recommendation
    assert.equal(typeof out.conclusion, "string");
    assert.match(out.conclusion as string, /merits further research/i);
    assert.match(out.conclusion as string, /not proof|not a trading recommendation/i);
    assert.equal(out.supportsFurtherResearch, true);

    // hypothesis, backtestResult and conclusion are genuinely distinct
    assert.notEqual(out.hypothesis, out.conclusion);
    assert.equal(typeof out.backtestResult, "object");

    // GOVERNANCE: a positive backtest is NOT a signal
    assertNotASignal(out);

    // A6 integrity PASS + lineage complete
    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep && (evalStep.output as { passed?: boolean }).passed === true, "A6 integrity PASS");
    assert.ok((evalStep!.output as { lineage?: { complete?: boolean } }).lineage?.complete, "evidence lineage complete");

    // A10 evaluation persisted
    const ev = await evaluation.getForRun(final!.id);
    assert.ok(ev && ev.terminalStatus === "succeeded");
    assert.deepEqual(ev!.scores.map((s) => s.dimension).sort(), [...AGENT_EVALUATION_DIMENSIONS].sort());
    assert.equal(ev!.measurableSignals.specialist, "STRATEGY_RESEARCH");
    console.log(`      -> hypothesis/result/context/conclusion separate; supportsFurtherResearch=true; composite ${ev!.compositeScore}`);
  });

  // ----------------------------------------------------------------
  // 4. E2E fake - non-positive backtest
  // ----------------------------------------------------------------

  await test("E2E (non-positive backtest): conclusion is 'evidence against', supportsFurtherResearch:false, still A6 PASS", async () => {
    const { rt } = harness(fakeRegistry(completedView(-250, 6)));
    const final = await runStrategyResearchAgent({ userId: TEST_USER, goal: { strategyId: "golden", symbol: "XAUUSD" }, runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.resolved, true);
    assert.equal(out.supportsFurtherResearch, false);
    assert.match(out.conclusion as string, /did not produce positive net profit|evidence against/i);
    assertNotASignal(out);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.equal((trace.steps.find((s) => s.kind === "evaluation")!.output as { passed?: boolean }).passed, true);
  });

  // ----------------------------------------------------------------
  // 5. E2E fake - failed / empty backtest
  // ----------------------------------------------------------------

  await test("E2E (failed backtest): resolved:false, backtestResult.status 'unusable', hypothesis unevaluated, still A6 PASS", async () => {
    const { rt } = harness(fakeRegistry(FAILED_VIEW));
    const final = await runStrategyResearchAgent({ userId: TEST_USER, goal: { strategyId: "golden", symbol: "XAUUSD" }, runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.resolved, false);
    assert.equal((out.backtestResult as Record<string, unknown>).status, "unusable");
    assert.equal(out.supportsFurtherResearch, null);
    assert.match(out.conclusion as string, /unevaluated|no research conclusion/i);
    assertNotASignal(out);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.equal((trace.steps.find((s) => s.kind === "evaluation")!.output as { passed?: boolean }).passed, true);
  });

  // ----------------------------------------------------------------
  // 6. E2E real registry (best-effort)
  // ----------------------------------------------------------------

  await test("E2E (real registry): clean terminal state either way; plan executed; no signal language in any live output", async () => {
    const final = await runStrategyResearchAgent({
      userId: TEST_USER,
      goal: { strategyId: "golden", symbol: "XAUUSD", timeframe: "5m" },
    });
    assert.ok(["succeeded", "tool_error"].includes(final!.status), `unexpected status ${final!.status} (${final!.errorCode})`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.ok(trace.steps.find((s) => s.kind === "plan"), "a plan step was persisted");
    if (final!.status === "succeeded") {
      const out = final!.output as Record<string, unknown>;
      assert.equal(out.kind, "strategy-research-brief");
      assertNotASignal(out);
      const br = out.backtestResult as Record<string, unknown>;
      console.log(`      -> (live) backtest ${br.status}${br.resultHash ? ` hash ${br.resultHash}` : ""}; resolved=${out.resolved}, ${trace.evidence.length} evidence`);
    } else {
      console.log(`      -> (live) backtest/provider unavailable -> clean ${final!.errorCode}; trace intact`);
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
